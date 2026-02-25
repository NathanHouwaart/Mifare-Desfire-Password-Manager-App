#!/usr/bin/env node
/**
 * native-host/host.js
 *
 * Native Messaging host for the SecurePass browser extension.
 * Registered with Chrome / Firefox via a JSON manifest in the OS,
 * so the browser can launch it as a subprocess.
 *
 * Protocol (browser ↔ host):
 *   Browser → host : 4-byte LE length + UTF-8 JSON
 *   Host → browser : 4-byte LE length + UTF-8 JSON
 *
 * Protocol (host ↔ Electron app):
 *   Newline-delimited JSON over the named pipe \\.\pipe\securepass-bridge
 */

'use strict';

const fs   = require('fs');
const net  = require('net');

const PIPE_PATH       = '\\\\.\\pipe\\securepass-bridge';
const REQUEST_TIMEOUT = 30_000;

// ─── Read one native message from stdin (synchronous) ─────────────────────
// fs.readSync on fd 0 is the only reliable approach for native messaging;
// async streams mis-buffer the 4-byte header across chunks.

function readExact(n) {
  const buf = Buffer.alloc(n);
  let offset = 0;
  while (offset < n) {
    const got = fs.readSync(0, buf, offset, n - offset, null);
    if (got === 0) process.exit(0); // stdin closed — browser disconnected
    offset += got;
  }
  return buf;
}

function readNativeMessage() {
  const len = readExact(4).readUInt32LE(0);
  return JSON.parse(readExact(len).toString('utf8'));
}

// ─── Write one native message to stdout ──────────────────────────────────────

function writeNativeMessage(obj) {
  const json = JSON.stringify(obj);
  const len  = Buffer.byteLength(json, 'utf8');
  const buf  = Buffer.alloc(4 + len);
  buf.writeUInt32LE(len, 0);
  buf.write(json, 4, 'utf8');
  process.stdout.write(buf);
}

// ─── Forward one request to the Electron app over the named pipe ─────────────

function forwardToBridge(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Bridge request timed out'));
    }, REQUEST_TIMEOUT);

    const socket = net.createConnection(PIPE_PATH, () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.setEncoding('utf8');
    let buf = '';

    socket.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;

      clearTimeout(timer);
      socket.destroy();

      try {
        resolve(JSON.parse(buf.slice(0, nl)));
      } catch (e) {
        reject(new Error('Bad JSON from bridge: ' + e.message));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      // Common case: app not running
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error('SecurePass app is not running. Please open it first.'));
      } else {
        reject(err);
      }
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  let request;
  try {
    request = readNativeMessage();
  } catch (err) {
    writeNativeMessage({ error: 'Failed to read message: ' + err.message });
    process.exit(1);
  }

  try {
    const id    = request.id ?? 'req';
    const reply = await forwardToBridge({ id, ...request });
    writeNativeMessage(reply);
  } catch (err) {
    writeNativeMessage({ error: err.message });
  }
  process.exit(0);
})();
