# Electron C++ Template

A clean, modern, and highly reusable template for building Electron applications with native C++ addons.

## Features
- **Electron & Vite**: Fast frontend tooling with React 19 and Tailwind CSS v4.
- **Native C++ Addons**: Pre-configured with `cmake-js` and `node-addon-api` (N-API).
- **Clean Architecture**: Pure C++ logic is strictly separated from V8/N-API bindings.
- **End-to-End Type Safety**: Fully typed IPC bridge between React and the Electron main process.
- **Cross-Platform CI/CD**: GitHub Actions workflow included for building on Windows, Mac, and Linux.

## Prerequisites
To compile the native C++ addon, your system needs:
- **Node.js** (v20.19+ or v22.12+ recommended)
- **Python 3**
- **CMake**
- **C++ Compiler**:
  - *Windows*: Visual Studio with Desktop development with C++ workload.
  - *Mac*: Xcode Command Line Tools (`xcode-select --install`).
  - *Linux*: GCC/G++ and Make (`sudo apt install build-essential`).

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Build the C++ Addon**:
   ```bash
   npm run build:addon
   ```
3. **Start the Development Server**:
   ```bash
   npm run dev
   ```

## Project Structure
- `native/MyLibrary/src` & `inc`: Your pure C++ logic. Unaware of Node.js.
- `native/MyLibrary/bindings`: The N-API wrappers that expose your C++ to JavaScript.
- `src/electron`: Electron main process and preload scripts.
- `src/ui`: React frontend.
- `src/types`: Shared TypeScript definitions for IPC.

## How to Rename the Addon
If you want to change the name from `myaddon` to something else:
1. Update `project(myaddon ...)` in `CMakeLists.txt`.
2. Update `NODE_API_MODULE(myaddon, Init)` in `native/RegisterModules.cc`.
3. Update the paths in `src/electron/bindings.ts` and `src/types/myaddon.d.ts`.
