const electron = require('electron');

electron.contextBridge.exposeInMainWorld("electron", {
    greet: (name: string) => ipcInvoke("greet", name),
    add: (a: number, b: number) => ipcInvoke("add", a, b),
    connect: (port: string) => ipcInvoke("connect", port),
    disconnect: () => ipcInvoke("disconnect"),
    listComPorts: () => ipcInvoke("listComPorts"),
    onNfcLog: (callback: (entry: NfcLogEntry) => void) => ipcOn('nfc-log', callback),
    onSelfTestProgress: (callback: (result: SelfTestResultDto) => void) => ipcOn('nfc:selfTestProgress', callback),
    saveFile: (filename: string, content: string) => ipcInvoke("saveFile", filename, content),
    getFirmwareVersion: () => ipcInvoke("getFirmwareVersion"),
    runSelfTests: () => ipcInvoke("runSelfTests"),
    getCardVersion: () => ipcInvoke("getCardVersion"),

    // Card operations
    'card:peekUid':       () => ipcInvoke('card:peekUid'),
    'card:isInitialised': () => ipcInvoke('card:isInitialised'),
    'card:probe':         () => ipcInvoke('card:probe'),
    'card:init':          () => ipcInvoke('card:init'),
    'card:freeMemory':    () => ipcInvoke('card:freeMemory'),
    'card:format':        () => ipcInvoke('card:format'),
    'card:getAids':       () => ipcInvoke('card:getAids'),

    // Vault operations
    'vault:listEntries':  (opts?: VaultListOptsDto) => ipcInvoke('vault:listEntries', opts),
    'vault:getEntry':     (id: string) => ipcInvoke('vault:getEntry', id),
    'vault:createEntry':  (params: EntryCreateDto) => ipcInvoke('vault:createEntry', params),
    'vault:updateEntry':  (id: string, params: EntryUpdateDto) => ipcInvoke('vault:updateEntry', id, params),
    'vault:deleteEntry':  (id: string) => ipcInvoke('vault:deleteEntry', id),
    'vault:export':       () => ipcInvoke('vault:export'),
    'vault:import':       () => ipcInvoke('vault:import'),

    // Cancel any in-progress card-wait operation
    'nfc:cancel': () => ipcInvoke('nfc:cancel'),

    // Clear the system clipboard via the main process (no focus restriction)
    'clipboard:clear': () => ipcInvoke('clipboard:clear'),
    // Read the system clipboard via the main process (no focus restriction)
    'clipboard:read':  () => ipcInvoke('clipboard:read'),

    // Browser extension helpers
    'extension:open-folder':          () => ipcInvoke('extension:open-folder'),
    'extension:reload-registration':  () => ipcInvoke('extension:reload-registration'),

    // Sync helpers
    'sync:getStatus':   () => ipcInvoke('sync:getStatus'),
    'sync:setConfig':   (config: SyncConfigDto) => ipcInvoke('sync:setConfig', config),
    'sync:clearConfig': () => ipcInvoke('sync:clearConfig'),
    'sync:bootstrap':   (payload: SyncBootstrapDto) => ipcInvoke('sync:bootstrap', payload),
    'sync:login':       (payload: SyncLoginDto) => ipcInvoke('sync:login', payload),
    'sync:logout':      () => ipcInvoke('sync:logout'),
    'sync:push':        () => ipcInvoke('sync:push'),
    'sync:pull':        () => ipcInvoke('sync:pull'),
    'sync:syncNow':     () => ipcInvoke('sync:syncNow'),
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
