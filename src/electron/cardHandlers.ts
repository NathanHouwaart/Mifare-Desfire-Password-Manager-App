/**
 * cardHandlers.ts
 *
 * IPC handlers for DESFire card operations.
 * Registered from main.ts after nfcBinding is created.
 *
 * card:peekUid        — lightweight UID probe, null when no card
 * card:isInitialised  — true if vault AID 505700 exists on card
 * card:init           — full 11-step secure init (derives keys from active root secret + UID)
 * card:freeMemory     — free EEPROM bytes on the PICC
 * card:format         - FormatPICC only (card reset)
 * card:getAids        — list of AIDs on the card
 *
 * Must only run in the main process.
 */

import { ipcMain } from 'electron';
import crypto from 'node:crypto';
import { NfcCppBinding } from './bindings.js';
import { getCryptoRootSecret } from './main.js';
import { deriveCardKey, zeroizeBuffer } from './keyDerivation.js';
import { beginCardWait } from './nfcCancel.js';

const VAULT_AID: [number, number, number] = [0x50, 0x57, 0x00];
const PROBE_INTERVAL_MS = 200;
const PROBE_TIMEOUT_MS  = 15_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Polls peekCardUid until a card is present, the timeout expires, or the
 * AbortSignal fires (user pressed Cancel).
 */
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

/** Convert a colon-separated UID hex string from the binding into a Buffer. */
function uidToBuffer(uidHex: string): Buffer {
  return Buffer.from(uidHex.replace(/:/g, ''), 'hex');
}

function isTransientCompatibilityError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('no card') ||
    text.includes('card not found') ||
    text.includes('card timeout') ||
    text.includes('timed out') ||
    text.includes('tap cancelled')
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerCardHandlers(
  nfcBinding: NfcCppBinding,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
): void {

  // ── card:peekUid ────────────────────────────────────────────────────────────
  ipcMain.handle('card:peekUid', (): Promise<string | null> => {
    return nfcBinding.peekCardUid();
  });

  // ── card:isInitialised ──────────────────────────────────────────────────────
  ipcMain.handle('card:isInitialised', (): Promise<boolean> => {
    return nfcBinding.isCardInitialised();
  });
  // ── card:probe ──────────────────────────────────────────────────────────
  ipcMain.handle('card:probe', async (): Promise<{
    uid: string | null;
    isInitialised: boolean;
    isCompatibleWithCurrentVault: boolean | null;
    compatibilityError?: string;
  }> => {
    const probe = await nfcBinding.probeCard();
    if (probe.uid === null || !probe.isInitialised) {
      return {
        ...probe,
        isCompatibleWithCurrentVault: null,
      };
    }

    const rootSecret = getCryptoRootSecret();
    const uidBuf = uidToBuffer(probe.uid);
    const readKey = deriveCardKey(rootSecret, uidBuf, 0x02);
    let cardSecret: Buffer | null = null;

    try {
      const secret = await nfcBinding.readCardSecret(Array.from(readKey));
      cardSecret = Buffer.from(secret);
      return {
        ...probe,
        isCompatibleWithCurrentVault: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isTransientCompatibilityError(message)) {
        return {
          ...probe,
          isCompatibleWithCurrentVault: null,
          compatibilityError: 'Could not verify compatibility. Keep the card on the reader and probe again.',
        };
      }
      return {
        ...probe,
        isCompatibleWithCurrentVault: false,
        compatibilityError: message,
      };
    } finally {
      if (cardSecret) zeroizeBuffer(cardSecret);
      zeroizeBuffer(readKey);
      zeroizeBuffer(rootSecret);
    }
  });
  // ── card:init ───────────────────────────────────────────────────────────────
  ipcMain.handle('card:init', async (): Promise<boolean> => {
    const signal = beginCardWait();
    log('info', 'card:init — waiting for card tap...');
    const uidHex = await waitForCard(nfcBinding, signal);
    log('info', `card:init — card detected (${uidHex}), deriving keys...`);

    const rootSecret = getCryptoRootSecret();
    const uidBuf        = uidToBuffer(uidHex);

    const appMasterKey = deriveCardKey(rootSecret, uidBuf, 0x01);
    const readKey      = deriveCardKey(rootSecret, uidBuf, 0x02);
    const cardSecret   = crypto.randomBytes(16);

    try {
      const result = await nfcBinding.initCard({
        aid:          Array.from(VAULT_AID),
        appMasterKey: Array.from(appMasterKey),
        readKey:      Array.from(readKey),
        cardSecret:   Array.from(cardSecret),
      });
      log('info', 'card:init — card initialised successfully.');
      return result;
    } finally {
      zeroizeBuffer(appMasterKey);
      zeroizeBuffer(readKey);
      zeroizeBuffer(cardSecret);
      zeroizeBuffer(rootSecret);
    }
  });

  // ── card:freeMemory ─────────────────────────────────────────────────────────
  ipcMain.handle('card:freeMemory', (): Promise<number> => {
    return nfcBinding.cardFreeMemory();
  });

  // ── card:format ─────────────────────────────────────────────────────────────
  ipcMain.handle('card:format', async (): Promise<boolean> => {
    log('warn', 'card:format - FormatPICC requested; card data will be destroyed.');
    const result = await nfcBinding.formatCard();
    if (result) {
      log('warn', 'card:format - card formatted to factory state (vault database unchanged).');
    }
    return result;
  });

  // ── card:getAids ────────────────────────────────────────────────────────────
  ipcMain.handle('card:getAids', (): Promise<string[]> => {
    return nfcBinding.getCardApplicationIds();
  });
}

