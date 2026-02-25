/**
 * vaultHandlers.ts
 *
 * IPC handlers for vault (encrypted password store) operations.
 * Registered from main.ts after nfcBinding is created.
 *
 * Card-gated handlers (vault:getEntry, vault:createEntry, vault:updateEntry)
 * wait for a card tap, read the 16-byte card_secret via an authenticated DESFire
 * ReadData, derive a per-entry AES-256 key, then encrypt/decrypt in the main
 * process. The card_secret and all derived keys are zeroized after use.
 *
 * Must only run in the main process.
 */

import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { NfcCppBinding } from './bindings.js';
import { getMachineSecret } from './main.js';
import {
  deriveCardKey,
  deriveEntryKey,
  encryptEntry,
  decryptEntry,
  zeroizeBuffer,
  EntryPayload,
} from './keyDerivation.js';
import {
  listEntries,
  getEntryRow,
  insertEntry,
  updateEntry,
  deleteEntry,
  getAllEntryRows,
  insertEntryRaw,
  EntryRow,
} from './vault.js';
import { beginCardWait } from './nfcCancel.js';

const PROBE_INTERVAL_MS = 200;
const PROBE_TIMEOUT_MS  = 15_000;

// ── Private helpers ───────────────────────────────────────────────────────────

/** Polls until a card is present, the timeout expires, or the AbortSignal fires. */
async function waitForCard(
  nfcBinding: NfcCppBinding,
  signal:     AbortSignal,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted)
      throw Object.assign(new Error('Card tap cancelled'), { code: 'CANCELLED' });
    const uid = await nfcBinding.peekCardUid();
    if (uid !== null) return uid;
    await new Promise(resolve => setTimeout(resolve, PROBE_INTERVAL_MS));
  }
  throw Object.assign(
    new Error('Card tap timed out — please tap your card and try again'),
    { code: 'CARD_TIMEOUT' }
  );
}

/** Convert colon-separated UID hex string from the C++ binding to a Buffer. */
function uidToBuffer(uidHex: string): Buffer {
  return Buffer.from(uidHex.replace(/:/g, ''), 'hex');
}

/**
 * Core card-gated key derivation flow:
 *   1. Wait for card tap  →  get UID
 *   2. Derive read key from machineSecret + UID
 *   3. Read 16-byte card_secret from File 00 (authenticated via read key)
 *   4. Derive per-entry AES-256 key from cardSecret + machineSecret + entryId
 *   5. Call fn(entryKey) — synchronous crypto only
 *   6. Zeroize all sensitive buffers
 *
 * entryId must be the stable UUID for the entry (pre-generated for creates).
 */
async function withEntryKey<T>(
  nfcBinding: NfcCppBinding,
  entryId:    string,
  fn:         (entryKey: Buffer) => T
): Promise<T> {
  const signal        = beginCardWait();
  const machineSecret = getMachineSecret();
  const uidHex        = await waitForCard(nfcBinding, signal);
  const uidBuf        = uidToBuffer(uidHex);

  // Derive and use read key ephemerally
  const readKey = deriveCardKey(machineSecret, uidBuf, 0x02);
  let cardSecretBuf: Buffer;
  try {
    const raw = await nfcBinding.readCardSecret(Array.from(readKey));
    cardSecretBuf = Buffer.from(raw);
  } finally {
    zeroizeBuffer(readKey);
  }

  // Derive per-entry key then invoke the crypto function
  const entryKey = deriveEntryKey(cardSecretBuf, machineSecret, entryId);
  zeroizeBuffer(cardSecretBuf);
  try {
    return fn(entryKey);
  } finally {
    zeroizeBuffer(entryKey);
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerVaultHandlers(
  nfcBinding: NfcCppBinding,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
): void {

  // ── vault:listEntries ───────────────────────────────────────────────────────
  // Metadata-only query — no card tap required.
  ipcMain.handle(
    'vault:listEntries',
    (_ev: IpcMainInvokeEvent, opts?: VaultListOptsDto): EntryListItemDto[] => {
      return listEntries({
        offset: opts?.offset,
        limit:  opts?.limit,
        query:  opts?.search,
      }) as EntryListItemDto[];
    }
  );

  // ── vault:getEntry ──────────────────────────────────────────────────────────
  ipcMain.handle(
    'vault:getEntry',
    async (_ev: IpcMainInvokeEvent, id: string): Promise<EntryPayloadDto> => {
      const row = getEntryRow(id);
      if (!row) {
        throw Object.assign(new Error(`Entry ${id} not found`), { code: 'NOT_FOUND' });
      }
      log('info', `vault:getEntry — tap card to decrypt "${row.label}"...`);
      return withEntryKey(nfcBinding, id, (entryKey): EntryPayloadDto => {
        const payload = decryptEntry(entryKey, row.ciphertext, row.iv, row.authTag);
        return {
          id:          row.id,
          label:       row.label,
          url:         row.url,
          category:    row.category,
          username:    payload.username,
          password:    payload.password,
          totpSecret:  payload.totpSecret,
          notes:       payload.notes,
          createdAt:   row.createdAt,
          updatedAt:   row.updatedAt,
        };
      });
    }
  );

  // ── vault:createEntry ───────────────────────────────────────────────────────
  // Pre-generate the UUID so it can be used as the HKDF salt before the row
  // is written — this makes each entry's key independent from the start.
  ipcMain.handle(
    'vault:createEntry',
    async (_ev: IpcMainInvokeEvent, params: EntryCreateDto): Promise<EntryListItemDto> => {
      const newId = crypto.randomUUID();
      log('info', `vault:createEntry — tap card to encrypt "${params.label}"...`);
      return withEntryKey(nfcBinding, newId, (entryKey): EntryListItemDto => {
        const blob = encryptEntry(entryKey, {
          username:   params.username,
          password:   params.password,
          totpSecret: params.totpSecret,
          notes:      params.notes,
        } as EntryPayload);
        return insertEntry(newId, {
          label:      params.label,
          url:        params.url ?? '',
          category:   params.category ?? '',
          ciphertext: blob.ciphertext,
          iv:         blob.iv,
          authTag:    blob.authTag,
        }) as EntryListItemDto;
      });
    }
  );

  // ── vault:updateEntry ───────────────────────────────────────────────────────
  ipcMain.handle(
    'vault:updateEntry',
    async (
      _ev: IpcMainInvokeEvent,
      id: string,
      params: EntryUpdateDto
    ): Promise<EntryListItemDto> => {
      if (!getEntryRow(id)) {
        throw Object.assign(new Error(`Entry ${id} not found`), { code: 'NOT_FOUND' });
      }
      log('info', `vault:updateEntry — tap card to re-encrypt "${params.label}"...`);
      return withEntryKey(nfcBinding, id, (entryKey): EntryListItemDto => {
        const blob = encryptEntry(entryKey, {
          username:   params.username,
          password:   params.password,
          totpSecret: params.totpSecret,
          notes:      params.notes,
        } as EntryPayload);
        const updated = updateEntry(id, {
          label:      params.label,
          url:        params.url ?? '',
          category:   params.category ?? '',
          ciphertext: blob.ciphertext,
          iv:         blob.iv,
          authTag:    blob.authTag,
        });
        if (!updated) {
          throw Object.assign(new Error(`Entry ${id} disappeared during update`), { code: 'RACE_CONDITION' });
        }
        return updated as EntryListItemDto;
      });
    }
  );

  // ── vault:deleteEntry ───────────────────────────────────────────────────────
  // No card tap required — the entry key is irrecoverable once deleted.
  ipcMain.handle(
    'vault:deleteEntry',
    (_ev: IpcMainInvokeEvent, id: string): boolean => {
      const deleted = deleteEntry(id);
      if (deleted) log('info', `vault:deleteEntry — entry ${id} deleted.`);
      return deleted;
    }
  );

  // ── vault:export ────────────────────────────────────────────────────────────
  // Dumps all encrypted rows to a JSON file chosen by the user.
  // No card tap needed — the blobs are already encrypted at rest.
  ipcMain.handle('vault:export', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title:       'Export Vault Backup',
      defaultPath: `vault-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: 'JSON Backup', extensions: ['json'] },
        { name: 'All Files',   extensions: ['*']    },
      ],
    });
    if (canceled || !filePath) return { success: false };

    const rows = getAllEntryRows();
    const payload = {
      version:    1,
      appVersion: '0.1.0',
      exportedAt: Date.now(),
      note:       'Restore requires the same device and the same NFC card.',
      entries:    rows.map(r => ({
        id:         r.id,
        label:      r.label,
        url:        r.url,
        category:   r.category,
        createdAt:  r.createdAt,
        updatedAt:  r.updatedAt,
        ciphertext: r.ciphertext.toString('base64'),
        iv:         r.iv.toString('base64'),
        authTag:    r.authTag.toString('base64'),
      })),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    const n = rows.length;
    log('info', `vault:export — exported ${n} entr${n === 1 ? 'y' : 'ies'} to ${filePath}`);
    return { success: true, path: filePath, count: n };
  });

  // ── vault:import ────────────────────────────────────────────────────────────
  // Reads a JSON backup, validates it, and bulk-inserts missing entries.
  // Entries whose IDs already exist in the vault are skipped (safe merge).
  ipcMain.handle('vault:import', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title:      'Import Vault Backup',
      filters: [
        { name: 'JSON Backup', extensions: ['json'] },
        { name: 'All Files',   extensions: ['*']    },
      ],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { success: false };

    let raw: string;
    try   { raw = fs.readFileSync(filePaths[0], 'utf-8'); }
    catch (e) {
      return { success: false, error: 'Could not read file: ' + (e instanceof Error ? e.message : String(e)) };
    }

    let parsed: unknown;
    try   { parsed = JSON.parse(raw); }
    catch { return { success: false, error: 'File is not valid JSON.' }; }

    const obj = parsed as Record<string, unknown>;
    if (!obj || !Array.isArray(obj.entries)) {
      return { success: false, error: 'Invalid backup — missing entries array.' };
    }
    if (typeof obj.version === 'number' && obj.version !== 1) {
      return { success: false, error: `Unsupported backup version: ${obj.version}.` };
    }

    let imported = 0;
    let skipped  = 0;
    for (const e of obj.entries as unknown[]) {
      if (!e || typeof e !== 'object') { skipped++; continue; }
      const entry = e as Record<string, unknown>;
      try {
        const row: EntryRow = {
          id:         String(entry.id        ?? ''),
          label:      String(entry.label     ?? ''),
          url:        String(entry.url       ?? ''),
          category:   String(entry.category  ?? ''),
          createdAt:  Number(entry.createdAt ?? 0),
          updatedAt:  Number(entry.updatedAt ?? 0),
          ciphertext: Buffer.from(String(entry.ciphertext ?? ''), 'base64'),
          iv:         Buffer.from(String(entry.iv         ?? ''), 'base64'),
          authTag:    Buffer.from(String(entry.authTag    ?? ''), 'base64'),
        };
        if (!row.id || !row.label || row.ciphertext.length === 0) { skipped++; continue; }
        insertEntryRaw(row) ? imported++ : skipped++;
      } catch { skipped++; }
    }
    log('info', `vault:import — imported ${imported}, skipped ${skipped}`);
    return { success: true, imported, skipped };
  });
}
