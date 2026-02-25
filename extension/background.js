/**
 * background.js  —  service worker (MV3)
 *
 * Handles:
 *   "list_for_domain"   – popup asks for matching vault entries (no card tap)
 *   "fill_entry"        – popup asks to decrypt + fill a specific entry
 *                         (card tap is required in the Electron app)
 *   "form_detected"     – content script tells us a login form is on the page
 */

'use strict';

const HOST_NAME = 'com.securepass.bridge';

// ─── Helper: send one message through the native host and get the response ───
function sendToNativeHost(message) {
  return new Promise((resolve, reject) => {
    // sendNativeMessage is a single-shot request/response — perfect for our use
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response) {
        reject(new Error('Empty response from native host'));
      } else if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── Message listener (from popup and from content scripts) ──────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Popup: list matching entries for the current domain ──────────────────
  if (msg.action === 'list_for_domain') {
    sendToNativeHost({
      id:     crypto.randomUUID(),
      action: 'list_for_domain',
      domain: msg.domain,
    })
      .then(resp  => sendResponse({ ok: true,  entries: resp.entries ?? [] }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  // ── Popup: decrypt a specific entry and autofill the active tab ──────────
  if (msg.action === 'fill_entry') {
    const { entryId, tabId, domain } = msg;
    sendToNativeHost({
      id:      crypto.randomUUID(),
      action:  'get_credentials',
      entryId,
      domain,
    })
      .then(resp => {
        // Forward credentials to the content script in the tab
        return chrome.tabs.sendMessage(tabId, {
          action:   'fill',
          username: resp.username,
          password: resp.password,
        });
      })
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  // ── Content script: tells us a login form is present ─────────────────────
  if (msg.action === 'form_detected') {
    // Update the badge so the user knows SecurePass can fill this page
    if (sender.tab?.id) {
      chrome.action.setBadgeText({ text: '🔑', tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: sender.tab.id });
    }
  }
});

// Clear badge when navigating away
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
