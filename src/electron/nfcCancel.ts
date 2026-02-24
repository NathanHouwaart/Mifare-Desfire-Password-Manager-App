/**
 * nfcCancel.ts
 *
 * Shared abort-controller for card-wait polling loops.
 * Both cardHandlers and vaultHandlers import beginCardWait() to get a fresh
 * AbortSignal before entering their polling loop. The renderer calls nfc:cancel
 * which calls cancelCardWait() to abort the current operation immediately.
 */

let _current: AbortController | null = null;

/**
 * Start a new card-wait operation.
 * Aborts any previous pending operation and returns a fresh AbortSignal.
 */
export function beginCardWait(): AbortSignal {
  if (_current) _current.abort();
  _current = new AbortController();
  return _current.signal;
}

/**
 * Abort the current card-wait operation, if any.
 * Called by the nfc:cancel IPC handler.
 */
export function cancelCardWait(): void {
  if (_current) {
    _current.abort();
    _current = null;
  }
}
