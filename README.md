# SonicPlank Maker

SonicPlank Maker is a desktop application designed for building, editing, and packaging interactive scenes for **SonicPlank**. 

Built as a cross-platform Electron application powered by React 19, TypeScript, Vite, and Tailwind CSS 4, SonicPlank Maker provides a suite of visual tools to manage audio assets, compose multi-track arrangements, and create modular node-based scene logic.

---

## Key Features

### 1. Visual Flow Editor
- **Node-Based Scene Graph**: Powered by `@xyflow/react` (formerly React Flow) to construct complex logic and exit structures for SonicPlank scenes.
- **Dynamic Port Connections**: Easily route data and signal flows through intuitive drag-and-drop connections.

### 2. Multi-Track Timeline Editor
- **Multi-Track Arrangement**: Lay out, drag, and trim audio clips across multiple parallel tracks.
- **High-Fidelity Wavesurfer Visuals**: Renders high-performance waveforms for precision editing.
- **Latency Compensation**: Supports sub-millisecond offset settings (including negative values) to keep the visual playhead aligned perfectly with physical audio hardware outputs.

### 3. Smart Audio Library
- **Drag & Drop Importing**: Import files directly onto the library panel.
- **Auto-Calculated Metadata**: Incorporates an `AudioContext.decodeAudioData` fallback parser to calculate sample-accurate durations for files lacking header metadata.
- **Playlist & Shortcut Parser**: Drop `.url`, `.pls`, `.m3u`, `.m3u8`, `.asx`, and `.xspf` stream links to auto-fill stream dialog parameters.
- **Detailed Asset Dialog**: Modify title, artist, and custom album art configurations before assets are added to the library.

### 4. Interactive Visualizer
- **Seamless Waveform Visualizations**: Driven by the custom `waviz` package.
- **Optimized Sound Routing**: Includes deep browser-level context caching workarounds to prevent Chrome `InvalidStateError` audio-node crashes during unmount/remount operations.

---

## Technology Stack

- **Shell**: [Electron (v42)](https://www.electronjs.org/)
- **Build System**: [Vite (v6)](https://vitejs.dev/) with [Electron Forge](https://www.electronforge.io/)
- **Core Library**: [React (v19)](https://react.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS (v4)](https://tailwindcss.com/)
- **Routing**: [TanStack Router](https://tanstack.com/router)
- **State Management**: [Jotai](https://jotai.org/) & [Zustand](https://zustand-demo.pmnd.rs/)
- **Waveform Engine**: [Wavesurfer.js (v7)](https://wavesurfer-js.org/)
- **Flow Engine**: [XYFlow React](https://xyflow.com/docs/react)

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [pnpm](https://pnpm.io/) package manager (recommended)

### Installation
Clone the repository and install the project dependencies:
```bash
pnpm install
```

### Development
Launch the Electron application in hot-reloading development mode:
```bash
pnpm start
```

### Packaging & Distribution
To package or build installers for the application targeting your current operating system platform:

```bash
# Package the application binaries
pnpm package

# Build ready-to-distribute installers (e.g. Squirrel.Windows exe, deb, rpm)
pnpm make
```

---

## License

This project is licensed under the **MIT License** - see the `package.json` file for details.
