# Native Module Architecture

This document outlines the architectural pattern for the C++ native modules in this project. It is based on the principles of **Clean Architecture** (Ports and Adapters), specifically tailored for Node-API (`node-addon-api`) projects.

## The Problem with the Old Structure
Previously, the project used a flat structure (e.g., `native/bindings/NfcCpp/`) that mixed:
1. **External C++ Libraries** (the actual `NfcCpp` source code).
2. **Application Business Logic** (e.g., `NfcCppApp.cc` which initializes the hardware).
3. **Node.js Bindings** (e.g., `NfcCppBinding.cc` which uses `Napi::`).

This mixing makes the codebase hard to scale, hard to test (since business logic is tied to the V8 engine), and confusing when updating external libraries.

## The Proposed Layered Structure (Ports and Adapters)

To solve this, the `native/` directory is split into distinct zones. **Crucially, external C++ libraries are treated as black boxes and their internal folder structures are never modified.**

```text
native/
|-- libs/                      <-- 1. EXTERNAL LIBRARIES (Untouched)
|   |-- MyLibrary/             <-- (Left exactly as it is: inc/, src/, etc.)
|   `-- NfcCpp/                <-- (Left exactly as it is: Src/, external/, etc.)
|
|-- core/                      <-- 2. APPLICATION LOGIC (Pure C++)
|   |-- domain/                <-- Entities, Value Objects, Domain Errors
|   |   `-- DesfireKey.h
|   |-- ports/                 <-- Interfaces (The "Ports")
|   |   `-- INfcReader.h       <-- Abstract interface for NFC hardware
|   `-- services/              <-- Use Cases (The "Application")
|       `-- PasswordManager.cc <-- Orchestrates domain logic using ports
|
|-- adapters/                  <-- 3. INFRASTRUCTURE (Concrete Implementations)
|   `-- hardware/              <-- Implements ports using libs/
|       `-- Pn532Adapter.cc    <-- Implements INfcReader using NfcCpp lib
|
`-- bindings/                  <-- 4. NODE.JS ADAPTERS (Napi:: Glue)
    |-- node/
    |   |-- NfcCppBinding.cc   <-- Wraps core services
    |   |-- converters.cc      <-- Maps C++ DTOs <-> JS Objects
    |   `-- errors.cc          <-- Maps C++ Domain Errors -> JS Errors
    `-- RegisterModules.cc     <-- Node.js entry point
```

## Architectural Rules & Enforcement

### 1. Strict Dependency Direction (Enforced via CMake)
Dependencies must point **inward** toward the `core/`.
* **`core/`**: Depends on NOTHING (except standard C++ libraries). It defines the `ports/` (interfaces).
* **`adapters/`**: Depends on `core/` (to implement `ports/`) and `libs/` (to do the actual hardware work).
* **`bindings/`**: Depends on `core/` (to call services) and `adapters/` (to inject concrete hardware implementations into the services).
* **CMake Enforcement**: `CMakeLists.txt` must define separate targets (`core_lib`, `hardware_adapter`, `node_addon`) and strictly enforce `target_link_libraries` to prevent circular dependencies.

### 2. Asynchronous Execution & Thread Safety Contract
**Rule: Hardware and I/O operations must never block the Node.js event loop.**
* All calls from `bindings/` to `core/` that involve NFC communication or cryptography must be executed asynchronously.
* The `bindings/` layer must use `Napi::AsyncWorker` to offload the work to a background thread and return a JavaScript `Promise` to the caller.
* **Concurrency Policy**: The NFC hardware is a shared, single-access resource. The `adapters/hardware/` layer must implement a thread-safe locking mechanism (e.g., `std::mutex` or a command queue) to serialize concurrent requests from JavaScript. If multiple JS calls attempt to access the NFC reader simultaneously, they must be queued or safely rejected.

### 3. Error Boundary
* **`core/`**: Must exclusively use `std::expected` (or a custom `Result<T, Error>` type) to represent domain-specific errors (e.g., `CardNotFound`, `AuthenticationFailed`). **C++ Exceptions are strictly forbidden** in the core domain logic to ensure predictable control flow and performance.
* **`bindings/errors.cc`**: A centralized location that unwraps the `std::expected` results from the core and translates them into standard Node.js `Napi::Error` or `Napi::TypeError` objects before returning to JavaScript.

### 4. Testing Strategy
* **Core Unit Tests (C++)**: The `core/` logic is tested using Google Test. Because it relies on `ports/` (interfaces), we can inject mock NFC readers to test password management logic without physical hardware or Node.js.
* **Integration Tests (JS)**: The `tests/` folder contains Vitest/Jest tests that load the compiled `.node` addon and verify the full pipeline (JS -> N-API -> C++ -> Mock Hardware).
