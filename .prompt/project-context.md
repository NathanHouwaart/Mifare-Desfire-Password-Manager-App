# Project Context for AI Assistants

This repository is an Electron + React + C++ (N-API) template. When assisting with this codebase, please adhere to the following architectural patterns and rules.

## 1. Architecture & Folder Structure
- **`native/`**: The root directory for all C++ code. This is the designated place to drop in C++ libraries, either as raw source code or git submodules. Every library added here needs corresponding N-API bindings to be accessible from Node.js.
- **`native/MyLibrary/src` & `inc`**: Pure C++ logic. **DO NOT** include any Node.js, V8, or N-API headers here. This code must remain platform-agnostic and usable outside of Node.js.
- **`native/MyLibrary/bindings`**: N-API wrappers using `node-addon-api`. This is where the pure C++ logic is exposed to JavaScript.
- **`src/electron`**: Electron main process (`main.ts`), preload script (`preload.cts`), and native addon bindings loader (`bindings.ts`).
- **`src/ui`**: React frontend built with Vite and Tailwind CSS v4.
- **`src/types`**: Shared TypeScript definitions.

## 2. IPC (Inter-Process Communication)
- We use a strictly typed end-to-end IPC pattern.
- **DO NOT** use `ipcRenderer.send` or `ipcMain.on` with magic strings.
- To add a new IPC channel:
  1. Define the signature in `IPCHandlers` inside `types.d.ts`.
  2. Implement the handler in `src/electron/main.ts` using `ipcMain.handle`.
  3. Call it from the frontend using `window.electron.<methodName>`.

## 3. Native Addon (`myaddon.node`)
- Built using `cmake-js`.
- The CMake configuration is in `CMakeLists.txt`.
- TypeScript definitions for the addon are in `src/types/myaddon.d.ts`.
- The addon is loaded safely in `src/electron/bindings.ts`.

## 4. Security Best Practices
- The Electron `BrowserWindow` is configured with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- **DO NOT** suggest enabling `nodeIntegration` in the renderer. All Node.js and native addon interactions must happen in the main process and be exposed via the preload script.

## 5. Build & Dev Commands
- `npm run dev`: Starts the Vite dev server and the Electron app concurrently.
- `npm run build:addon`: Compiles the C++ addon.
- `npm run build`: Builds both the Electron main process and the React frontend.
- `npm test`: Runs Vitest tests (including native addon tests).
- `npm run lint`: Runs ESLint.
