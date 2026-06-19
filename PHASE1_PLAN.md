# Phase 1 — Native Capture + Preview Frame Delivery

## Goal
Replace Chromium's `desktopCapturer` with Rust-native capture.
Frames flow: GPU (WGC/DXGI) → Rust → data pipe → Electron main → renderer canvas.

## Capture API Choice: Windows Graphics Capture (WGC)
- Covers both monitors AND windows (DXGI Desktop Duplication is monitor-only)
- Same API Chromium uses internally — proven on target hardware
- Handles DWM compositing, HDR tone-mapping, cursor inclusion
- Min requirement: Windows 10 1809 (acceptable for gaming audience)
- Available via the `windows` crate with WinRT feature flags

## Architecture

```
Rust core
  sources.rs  ← EnumWindows + EnumDisplayMonitors → Vec<CaptureSource>
  capture.rs  ← WGC session, FrameArrived handler, BGRA→pipe writer

Electron main.ts
  data pipe reader  ← FrameHeader(8B) + VideoFrame payload
                    ← [u32 width][u32 height][BGRA bytes]
  → BrowserWindow.webContents.send("onPreviewFrame", { width, height, buffer })

Renderer (React)
  useEffect → ipcRenderer.on("onPreviewFrame") → ImageData → canvas
```

## Binary Frame Layout (VideoPreview)

```
[ FrameHeader: 8 bytes ]
  u32 LE  frame_type = 1 (VideoPreview)
  u32 LE  payload_len = 8 + width * height * 4

[ VideoPreviewPayload ]
  u32 LE  width
  u32 LE  height
  [u8]    BGRA pixel data  (width * height * 4 bytes)
```

---

## Block 1 — IPC Protocol (`sonicplank-ipc`)

- [ ] Add `Command::GetSources`
- [ ] Add `Command::StartCapture { source_id: String }`
- [ ] Add `Command::StopCapture`
- [ ] Add `CaptureSource { id: String, name: String, kind: CaptureSourceKind }` struct
- [ ] Add `CaptureSourceKind` enum: `Monitor`, `Window`
- [ ] Add `Event::Sources { items: Vec<CaptureSource> }`
- [ ] Add `Event::CaptureStarted { source_id: String }`
- [ ] Add `Event::CaptureStopped`
- [ ] Update `encode_frame_header` docs with VideoPreview payload layout
- [ ] Add tests for new variants
- [ ] `cargo test -p sonicplank-ipc` — all green

---

## Block 2 — Workspace + Dependencies (`src-native/Cargo.toml`)

- [ ] Add `windows` crate to workspace dependencies with features:
      ```toml
      [workspace.dependencies.windows]
      version = "0.61"
      features = [
        "Graphics_Capture",
        "Graphics_DirectX",
        "Graphics_DirectX_Direct3D11",
        "Win32_Foundation",
        "Win32_Graphics_Direct3D",
        "Win32_Graphics_Direct3D11",
        "Win32_Graphics_Dxgi",
        "Win32_Graphics_Dxgi_Common",
        "Win32_System_Com",
        "Win32_System_WinRT_Direct3D11",
        "Win32_UI_WindowsAndMessaging",
      ]
      ```
- [ ] Add `windows` to `sonicplank-core` Cargo.toml dependencies
- [ ] `cargo build -p sonicplank-core` — clean (verifies SDK linkage)

---

## Block 3 — Source Enumeration (`src-native/crates/core/src/sources.rs`)

- [ ] `pub fn enumerate() -> Vec<CaptureSource>`
      - `EnumDisplayMonitors` → monitor sources (id = "monitor:<index>")
      - `EnumWindows` → filter visible, named, non-tool windows
        (GetWindowText, IsWindowVisible, GetWindowLongW WS_EX_TOOLWINDOW check)
      - For each candidate: `GraphicsCaptureItem::TryCreateFromWindowId` to
        verify WGC supports it; skip failures silently
- [ ] `pub fn capture_item_for_id(id: &str) -> windows::core::Result<GraphicsCaptureItem>`
      - Parse "monitor:<N>" → HMONITOR → `CreateForMonitor`
      - Parse "window:<hwnd_hex>" → HWND → `CreateForWindow`
- [ ] Unit test: `enumerate()` returns at least one source on a real machine
      (marked `#[ignore]` so CI doesn't require a display)

---

## Block 4 — WGC Capture Session (`src-native/crates/core/src/capture.rs`)

- [ ] `pub struct CaptureSession` — owns D3D11 device, frame pool, session
- [ ] `CaptureSession::new(item: GraphicsCaptureItem, pipe_writer: Arc<Mutex<PipeWriter>>) -> Result<Self>`
      - `D3D11CreateDevice` (hardware driver)
      - Wrap device as `IDirect3DDevice` via `CreateDirect3D11DeviceFromDXGIDevice`
      - `Direct3D11CaptureFramePool::Create` (BGRA8, 2 frames, item size)
      - Register `FrameArrived` handler → `on_frame_arrived`
      - `pool.CreateCaptureSession(item)` → `session.StartCapture()`
- [ ] `on_frame_arrived`: acquire frame, copy texture to staging (CPU-readable),
      map texture, write `FrameHeader + [width][height][BGRA]` to pipe_writer
- [ ] `CaptureSession::stop(&self)` — `session.Close()`, `pool.Close()`
- [ ] Module-level `start(source_id, pipe_writer)` / `stop()` with `Mutex<Option<CaptureSession>>`
- [ ] Unit test: `#[ignore]` smoke test — starts capture on primary monitor,
      receives at least 1 frame within 2 s, stops cleanly

---

## Block 5 — Wire into `main.rs`

- [ ] Import `sources`, `capture` modules
- [ ] In `run_stdin_commands`: handle `GetSources` → `sources::enumerate()` →
      write `Event::Sources` to stdout
- [ ] Handle `StartCapture { source_id }`:
      - `capture::start(source_id, Arc<pipe_writer>)` where `pipe_writer` is the
        write half of the data pipe (passed in from `run_data_pipe`)
      - Write `Event::CaptureStarted` on success, `Event::Error` on failure
- [ ] Handle `StopCapture` → `capture::stop()` → `Event::CaptureStopped`
- [ ] Thread the pipe writer through `run_data_pipe` into the capture module
      (use `Arc<Mutex<tokio::io::WriteHalf<NamedPipeServer>>>`)
- [ ] `cargo build` — clean, no warnings

---

## Block 6 — Electron Data Pipe Reader (`src/main.ts`)

- [ ] Replace the stub `socket.on("data")` handler with a real frame parser:
      - Maintain a `pipeBuffer: Buffer` across data events
      - On each `data` event: append to buffer
      - Loop: if buffer.length >= 8, parse FrameHeader; if buffer.length >=
        8 + payload_len, extract frame, emit, slice buffer
- [ ] On VideoPreview frame: parse `width` (u32 LE at offset 0),
      `height` (u32 LE at offset 4), `pixels` (remaining bytes)
- [ ] `BrowserWindow.getAllWindows().forEach(win => win.webContents.send("onPreviewFrame",
      { width, height, buffer: pixels }))`
- [ ] Expose `getPreviewSources` and `startPreviewCapture(sourceId)` IPC handlers
      that write GetSources / StartCapture to `coreProcess.stdin`
- [ ] Update `preload.ts` to expose the new channels

---

## Block 7 — Renderer Preview (`src/`)

- [ ] New hook `useNativePreview()`:
      - `ipcRenderer.on("onPreviewFrame", handler)` in useEffect
      - `handler`: create `ImageData(new Uint8ClampedArray(buffer), width, height)`,
        call `ctx.putImageData(...)` on an offscreen canvas
      - Returns `{ canvasRef, isCapturing }`
- [ ] Wire into the existing preview panel (replace or supplement
      `desktopCapturer`-based path)
- [ ] Expose `window.api.getPreviewSources()` and `window.api.startPreviewCapture(id)`
      in the renderer

---

## Block 8 — Verification

- [ ] `cargo test --manifest-path src-native/Cargo.toml` — all green
- [ ] `npm start` — observe console:
      - `[Core] Auth received`
      - `[Core] Data pipe authenticated`
- [ ] From renderer DevTools: call `window.api.getPreviewSources()` → see monitor list
- [ ] Call `window.api.startPreviewCapture(id)` → preview canvas shows live frames
- [ ] Call `window.api.stopPreviewCapture()` → frames stop

---

## Notes

- WGC `FrameArrived` fires on a WinRT thread pool thread — the pipe write must
  be synchronous (no async/await inside the callback). Use a `std::sync::Mutex`
  around a `std::io::Write` impl backed by the raw pipe handle, separate from
  the tokio async write half used for IPC frames.
- Frame rate: WGC delivers at display refresh rate (60/120/144 Hz). For preview,
  throttle to 30fps with a timestamp gate inside `on_frame_arrived`.
- BGRA → canvas: `putImageData` expects RGBA. Either swap channels in Rust before
  writing (cheapest), or use a canvas filter on the renderer side.
- Blocks 1–2 are prerequisites for all later blocks.
- Blocks 3–5 are Rust-only; 6–7 are Electron-only; they can overlap once Block 5
  is done.

---

## Status

- [x] Block 1 complete — IPC protocol extended, 27 tests passing
- [x] Block 2 complete — `windows` crate in workspace, D3D11/WGC linkage verified
- [x] Block 3 complete — sources.rs: monitor + window enumeration via WGC interop
- [x] Block 4 complete — capture.rs: WGC session, FrameArrived throttled to 30fps, BGRA→pipe
- [x] Block 5 complete — main.rs wired: GetSources/StartCapture/StopCapture dispatched, 35/35 tests
- [x] Block 6 complete — Electron frame parser, stdout event loop, 3 IPC handlers, preload updated
- [x] Block 7 complete — useNativePreview hook: sources/start/stop + canvas BGRA→RGBA display
- [x] Block 8 — end-to-end smoke test passed: Auth/Ready/Hello/CaptureStarted/CaptureStopped confirmed in live logs
