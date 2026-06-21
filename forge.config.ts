import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import fs from "node:fs";
import path from "node:path";

// Native binary produced by `cargo build --release`. Must be listed in
// extraResource so it lands outside the asar archive (native binaries
// cannot be executed from within asar). Accessed at runtime via
// process.resourcesPath + "/sonicplank-core[.exe]".
const nativeBinaryExt = process.platform === "win32" ? ".exe" : "";
const nativeBinaryPath = `./src-native/target/release/sonicplank-core${nativeBinaryExt}`;

const extraResource = [nativeBinaryPath, "./src/img/icon.ico", "./src/img/icon.png"];

if (process.platform === "win32") {
  try {
    const cargoConfig = fs.readFileSync(path.join(__dirname, "src-native", ".cargo", "config.toml"), "utf-8");
    const match = cargoConfig.match(/FFMPEG_DIR\s*=\s*{\s*value\s*=\s*"([^"]+)"/);
    if (match && match[1]) {
      // JSON.parse to handle escaped backslashes in the TOML string
      const ffmpegDir = JSON.parse(`"${match[1]}"`);
      const binDir = path.join(ffmpegDir, "bin");
      if (fs.existsSync(binDir)) {
        const dlls = fs.readdirSync(binDir).filter(f => f.endsWith(".dll"));
        for (const dll of dlls) {
          extraResource.push(path.join(binDir, dll));
        }
      }
    }
  } catch (err) {
    console.warn("Failed to find or parse FFMPEG_DIR for packaging DLLs:", err);
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Path without extension — Forge appends .ico on Windows, .icns on macOS,
    // .png on Linux. Place src/img/icon.ico alongside icon.png for Windows builds.
    icon: "./src/img/icon",
    // Copies the Rust binary, icons, and FFmpeg DLLs into <app>/resources/ at package time.
    // The binary and DLLs are NOT inside the asar so Electron can spawn it.
    extraResource,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      // Installer icon (Windows only). Requires an .ico file at this path.
      setupIcon: "./src/img/icon.ico",
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "./src/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "./src/preload.ts",
          config: "./vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "./vite.renderer.config.mts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    }),
  ],
};

export default config;
