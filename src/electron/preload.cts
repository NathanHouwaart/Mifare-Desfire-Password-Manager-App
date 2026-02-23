const electron = require('electron');

electron.contextBridge.exposeInMainWorld("electron", {
    greet: (name: string) => ipcInvoke("greet", name),
    add: (a: number, b: number) => ipcInvoke("add", a, b),
    connect: (port: string) => ipcInvoke("connect", port),
} satisfies Window["electron"]);


function ipcInvoke<Key extends keyof IPCHandlers>(
    key: Key,
    ...args: EventInvokeArgs[Key]
): Promise<EventPayloadMapping[Key]> {
    return electron.ipcRenderer.invoke(key, ...args);
}

function ipcOn<Key extends keyof EventPayloadMapping>(
    key: Key,
    callback: (payload: EventPayloadMapping[Key]) => void
) {
    const cb = (_ : Electron.IpcRendererEvent, payload: any) => callback(payload);
    electron.ipcRenderer.on(key, cb)
    return () => electron.ipcRenderer.off(key, cb); // Return unsubscribe function
}
