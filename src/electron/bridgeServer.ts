/**
 * bridgeServer.ts
 *
 * Named-pipe IPC server that allows the native messaging host (native-host/host.js)
 * to request vault operations from the already-running Electron app.
 *
 * Protocol: newline-delimited JSON over \\.\pipe\securepass-bridge
 *
 * Inbound messages (from host.js):
 *   { id, action: "list_for_domain", domain: string }
 *   { id, action: "get_credentials", entryId: string, domain: string }
 *   { id, action: "ping" }
 *
 * Outbound replies always carry the same `id` as the request:
 *   { id, entries: EntryHint[] }                  ← list_for_domain
 *   { id, username: string, password: string }     ← get_credentials (success)
 *   { id, error: string }                          ← any failure
 *   { id, pong: true }                             ← ping
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { NfcCppBinding } from './bindings.js';
import { getMachineSecret } from './main.js';
import { deriveCardKey, deriveEntryKey, decryptEntry, zeroizeBuffer } from './keyDerivation.js';
import { listEntries, getEntryRow } from './vault.js';
import { beginCardWait } from './nfcCancel.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BRIDGE_NAME      = 'securepass-bridge';
const PROBE_INTERVAL   = 200;   // ms
const PROBE_TIMEOUT    = 15_000; // ms

function getBridgeEndpoint(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\${BRIDGE_NAME}`;
  const runtimeDir =
    process.env.XDG_RUNTIME_DIR ??
    process.env.TMPDIR ??
    process.env.TMP ??
    '/tmp';
  return path.join(runtimeDir, `${BRIDGE_NAME}.sock`);
}

const BRIDGE_ENDPOINT = getBridgeEndpoint();

function cleanupUnixSocket(
  endpoint: string,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
) {
  if (process.platform === 'win32') return;
  try {
    if (fs.existsSync(endpoint)) fs.unlinkSync(endpoint);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('warn', `[bridge] could not clean up socket ${endpoint}: ${msg}`);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface BridgeRequest {
  id:       string;
  action:   'ping' | 'list_for_domain' | 'get_credentials';
  domain?:  string;
  entryId?: string;
}

interface EntryHint {
  id:    string;
  label: string;
  url:   string;
}

// ─── Domain matching ──────────────────────────────────────────────────────────

/**
 * Returns true when the entry's stored URL matches the requested browser domain.
 * Strips leading "www." before comparing so "www.github.com" hits a "github.com"
 * entry and vice-versa.
 */
function matchesDomain(entryUrl: string, requestedDomain: string): boolean {
  const strip = (s: string) => s.replace(/^www\./, '').toLowerCase();
  try {
    const entryHost = strip(new URL(entryUrl).hostname);
    return entryHost === strip(requestedDomain) || entryHost.endsWith('.' + strip(requestedDomain));
  } catch {
    // Not a valid URL — fall back to substring match
    return entryUrl.toLowerCase().includes(strip(requestedDomain));
  }
}

// ─── Card-gated decryption ────────────────────────────────────────────────────

async function waitForCard(nfcBinding: NfcCppBinding, signal: AbortSignal): Promise<string> {
  const deadline = Date.now() + PROBE_TIMEOUT;
  while (Date.now() < deadline) {
    if (signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    const uid = await nfcBinding.peekCardUid();
    if (uid !== null) return uid;
    await new Promise(r => setTimeout(r, PROBE_INTERVAL));
  }
  throw Object.assign(new Error('Card tap timed out'), { code: 'CARD_TIMEOUT' });
}

function uidToBuffer(uidHex: string): Buffer {
  return Buffer.from(uidHex.replace(/:/g, ''), 'hex');
}

async function decryptEntryById(
  nfcBinding: NfcCppBinding,
  entryId:    string,
  log:        (level: 'info' | 'warn' | 'error', msg: string) => void
): Promise<{ username: string; password: string }> {
  const row = getEntryRow(entryId);
  if (!row) throw Object.assign(new Error(`Entry ${entryId} not found`), { code: 'NOT_FOUND' });

  log('info', `[bridge] tap card to decrypt "${row.label}"…`);

  const signal        = beginCardWait();
  const machineSecret = getMachineSecret();
  const uidHex        = await waitForCard(nfcBinding, signal);
  const uidBuf        = uidToBuffer(uidHex);

  const readKey = deriveCardKey(machineSecret, uidBuf, 0x02);
  let cardSecretBuf: Buffer;
  try {
    const raw = await nfcBinding.readCardSecret(Array.from(readKey));
    cardSecretBuf = Buffer.from(raw);
  } finally {
    zeroizeBuffer(readKey);
  }

  const entryKey = deriveEntryKey(cardSecretBuf, machineSecret, entryId);
  zeroizeBuffer(cardSecretBuf);

  try {
    const payload = decryptEntry(entryKey, row.ciphertext, row.iv, row.authTag);
    return { username: payload.username, password: payload.password };
  } finally {
    zeroizeBuffer(entryKey);
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

export function startBridgeServer(
  nfcBinding: NfcCppBinding,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
): net.Server {
  cleanupUnixSocket(BRIDGE_ENDPOINT, log);

  const server = net.createServer((socket) => {
    log('info', '[bridge] extension host connected');

    let buf = '';

    socket.setEncoding('utf8');

    socket.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';   // keep any incomplete trailing fragment

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let req: BridgeRequest;
        try {
          req = JSON.parse(trimmed);
        } catch {
          socket.write(JSON.stringify({ error: 'Invalid JSON' }) + '\n');
          continue;
        }

        handleRequest(req, nfcBinding, log).then((reply) => {
          if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n');
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (!socket.destroyed) socket.write(JSON.stringify({ id: req.id, error: msg }) + '\n');
        });
      }
    });

    socket.on('close', () => log('info', '[bridge] extension host disconnected'));
    socket.on('error', (err) => log('warn', `[bridge] socket error: ${err.message}`));
  });

  server.listen(BRIDGE_ENDPOINT, () => {
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(BRIDGE_ENDPOINT, 0o600);
      } catch { /* best-effort */ }
    }
    log('info', `[bridge] listening on ${BRIDGE_ENDPOINT}`);
  });

  server.on('error', (err) => {
    log('error', `[bridge] server error: ${err.message}`);
  });

  server.on('close', () => {
    cleanupUnixSocket(BRIDGE_ENDPOINT, log);
  });

  const cleanupOnExit = () => cleanupUnixSocket(BRIDGE_ENDPOINT, log);
  process.once('exit', cleanupOnExit);
  process.once('SIGINT', cleanupOnExit);
  process.once('SIGTERM', cleanupOnExit);

  return server;
}

// ─── Request dispatcher ───────────────────────────────────────────────────────

async function handleRequest(
  req:        BridgeRequest,
  nfcBinding: NfcCppBinding,
  log:        (level: 'info' | 'warn' | 'error', msg: string) => void
): Promise<Record<string, unknown>> {
  const { id, action } = req;

  if (action === 'ping') {
    return { id, pong: true };
  }

  if (action === 'list_for_domain') {
    if (!req.domain) return { id, error: 'Missing domain' };
    const all  = listEntries({ limit: 500 });
    const hits: EntryHint[] = all
      .filter(e => matchesDomain(e.url, req.domain!))
      .map(e => ({ id: e.id, label: e.label, url: e.url }));
    log('info', `[bridge] list_for_domain "${req.domain}" → ${hits.length} match(es)`);
    return { id, entries: hits };
  }

  if (action === 'get_credentials') {
    if (!req.entryId) return { id, error: 'Missing entryId' };
    const creds = await decryptEntryById(nfcBinding, req.entryId, log);
    log('info', `[bridge] credentials delivered for entry ${req.entryId}`);
    return { id, ...creds };
  }

  return { id, error: `Unknown action: ${action}` };
}
