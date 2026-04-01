const electron = require('electron');

electron.contextBridge.exposeInMainWorld("electron", {
    greet: (name: string) => ipcInvoke("greet", name),
    add: (a: number, b: number) => ipcInvoke("add", a, b),
    connect: (port: string) => ipcInvoke("connect", port),
    disconnect: () => ipcInvoke("disconnect"),
    'nfc:getConnectionState': () => ipcInvoke('nfc:getConnectionState'),
    listComPorts: () => ipcInvoke("listComPorts"),
    onNfcLog: (callback: (entry: NfcLogEntry) => void) => ipcOn('nfc-log', callback),
    onSelfTestProgress: (callback: (result: SelfTestResultDto) => void) => ipcOn('nfc:selfTestProgress', callback),
    onNfcConnectionChange: (callback: (state: NfcConnectionStateDto) => void) => ipcOn('nfc:connectionChanged', callback),
    onSyncInvite: (callback: (payload: SyncInvitePayloadDto) => void) => ipcOn('securepass:syncInvite', callback),
    onSyncApplied: (callback: (payload: SyncAppliedEventDto) => void) => ipcOn('sync:applied', callback),
    onUpdateStatusChanged: (callback: (payload: AppUpdateStatusDto) => void) => ipcOn('update:statusChanged', callback),
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
    'app:lock': () => ipcInvoke('app:lock'),
    'app:getVersion': () => ipcInvoke('app:getVersion'),
    'app:relaunch': () => ipcInvoke('app:relaunch'),
    'update:getStatus': () => ipcInvoke('update:getStatus'),
    'update:checkNow': () => ipcInvoke('update:checkNow'),
    'update:installNow': () => ipcInvoke('update:installNow'),
    'update:getPreferences': () => ipcInvoke('update:getPreferences'),
    'update:setPreferences': (payload: AppUpdatePreferencesDto) => ipcInvoke('update:setPreferences', payload),

    // App-lock PIN operations (main-process managed)
    'pin:has':    () => ipcInvoke('pin:has'),
    'pin:set':    (pin: string) => ipcInvoke('pin:set', pin),
    'pin:verify': (pin: string) => ipcInvoke('pin:verify', pin),
    'pin:change': (currentPin: string, newPin: string) => ipcInvoke('pin:change', currentPin, newPin),
    'pin:recovery:capabilities': () => ipcInvoke('pin:recovery:capabilities'),
    'pin:recovery:start': (payload: PinRecoveryStartDto) => ipcInvoke('pin:recovery:start', payload),
    'pin:recovery:destructiveReset': () => ipcInvoke('pin:recovery:destructiveReset'),
    'pin:recovery:complete': (payload: PinRecoveryCompleteDto) => ipcInvoke('pin:recovery:complete', payload),

    // Clear the system clipboard via the main process (no focus restriction)
    'clipboard:clear': () => ipcInvoke('clipboard:clear'),
    // Read the system clipboard via the main process (no focus restriction)
    'clipboard:read':  () => ipcInvoke('clipboard:read'),

    // Browser extension helpers
    'extension:open-folder':          () => ipcInvoke('extension:open-folder'),
    'extension:reload-registration':  () => ipcInvoke('extension:reload-registration'),

    // Sync helpers
    'sync:getStatus':   () => ipcInvoke('sync:getStatus'),
    'sync:validateServer': (payload: SyncValidateServerDto) => ipcInvoke('sync:validateServer', payload),
    'sync:consumeInvite': () => ipcInvoke('sync:consumeInvite'),
    'sync:setConfig':   (config: SyncConfigDto) => ipcInvoke('sync:setConfig', config),
    'sync:checkUsername': () => ipcInvoke('sync:checkUsername'),
    'sync:getAuthMe':   () => ipcInvoke('sync:getAuthMe'),
    'sync:createInvite': (payload: SyncCreateInviteDto) => ipcInvoke('sync:createInvite', payload),
    'sync:listInvites': () => ipcInvoke('sync:listInvites'),
    'sync:revokeInvite': (payload: { id: string }) => ipcInvoke('sync:revokeInvite', payload),
    'sync:clearConfig': () => ipcInvoke('sync:clearConfig'),
    'sync:bootstrap':   (payload: SyncBootstrapDto) => ipcInvoke('sync:bootstrap', payload),
    'sync:register':    (payload: SyncRegisterDto) => ipcInvoke('sync:register', payload),
    'sync:login':       (payload: SyncLoginDto) => ipcInvoke('sync:login', payload),
    'sync:mfaStatus':   () => ipcInvoke('sync:mfaStatus'),
    'sync:mfaSetup':    () => ipcInvoke('sync:mfaSetup'),
    'sync:mfaEnable':   (payload: SyncMfaCodeDto) => ipcInvoke('sync:mfaEnable', payload),
    'sync:mfaDisable':  (payload: SyncMfaCodeDto) => ipcInvoke('sync:mfaDisable', payload),
    'sync:logout':      () => ipcInvoke('sync:logout'),
    'sync:switchUser':  () => ipcInvoke('sync:switchUser'),
    'sync:getDevices':  () => ipcInvoke('sync:getDevices'),
    'sync:updateCurrentDeviceName': (payload: SyncUpdateDeviceDto) => ipcInvoke('sync:updateCurrentDeviceName', payload),
    'sync:push':        () => ipcInvoke('sync:push'),
    'sync:pull':        () => ipcInvoke('sync:pull'),
    'sync:syncNow':     () => ipcInvoke('sync:syncNow'),
    'sync:getVaultKeyEnvelope': () => ipcInvoke('sync:getVaultKeyEnvelope'),
    'sync:getVaultKeyStatus':   () => ipcInvoke('sync:getVaultKeyStatus'),
    'sync:prepareVaultKey':     (payload: SyncVaultKeyPasswordDto) => ipcInvoke('sync:prepareVaultKey', payload),
    // Deprecated compatibility channels
    'sync:initVaultKey':        (payload: SyncVaultKeyPassphraseDto) => ipcInvoke('sync:initVaultKey', payload),
    'sync:unlockVaultKey':      (payload: SyncVaultKeyPassphraseDto) => ipcInvoke('sync:unlockVaultKey', payload),
    'sync:lockVaultKey':        () => ipcInvoke('sync:lockVaultKey'),
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
