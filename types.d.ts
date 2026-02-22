type RendererEvents = Record<string, never>;

// 1) canonical single source: define your IPC handlers here
type IPCHandlers = {
  greet: (name: string) => Promise<string>;
  add: (a: number, b: number) => Promise<number>;
};

// 2) helpers derived from IPCHandlers
type EventInvokeArgs = { [K in keyof IPCHandlers]: Parameters<IPCHandlers[K]> };
type EventPayloadMapping = { [K in keyof IPCHandlers]: Awaited<ReturnType<IPCHandlers[K]>> } & RendererEvents;

// 3) derive the exact shape to expose on window.electron
type ExposedElectronAPI = {
  [K in keyof IPCHandlers]: (...args: EventInvokeArgs[K]) => ReturnType<IPCHandlers[K]>;
} & {
};

// 4) augment global Window so you only maintain IPCHandlers
interface Window {
  electron: ExposedElectronAPI;
}
