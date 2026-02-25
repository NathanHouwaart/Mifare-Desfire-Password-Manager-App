/**
 * content.js  —  injected into every page
 *
 * 1. Detects password fields and notifies the background (badge update).
 * 2. Responds to { action: "check_login_form" } with { hasLoginForm: bool }.
 * 3. Listens for { action: "fill", username, password } and fills the
 *    closest username field to the password field — scoped inside its
 *    <form> (or nearest fieldset/div ancestor) to avoid hitting a
 *    search box or other unrelated input.
 */

'use strict';

// ─── Utilities ────────────────────────────────────────────────────────────────

function getPasswordField() {
  return document.querySelector('input[type="password"]:not([disabled]):not([aria-hidden="true"])');
}

/**
 * Given a password field, find the most likely username input.
 * Strategy: look inside the closest <form> first, then walk up to a
 * common ancestor (max 5 levels) to avoid escaping into unrelated
 * parts of the page.
 */
function findUsernameField(passwordField) {
  const selectors = [
    'input[type="email"]',
    'input[type="text"][autocomplete*="user"]',
    'input[type="text"][autocomplete*="email"]',
    'input[name*="user"]',
    'input[name*="email"]',
    'input[name*="login"]',
    'input[id*="user"]',
    'input[id*="email"]',
    'input[id*="login"]',
    'input[type="text"]',
  ];

  // Step 1: search within the enclosing <form>
  const form = passwordField.closest('form');
  const scope = form ?? passwordField.parentElement;

  for (const sel of selectors) {
    const el = scope?.querySelector(sel);
    if (el && el !== passwordField) return el;
  }

  // Step 2: walk up max 5 ancestors looking for a preceding input
  let ancestor = passwordField.parentElement;
  for (let i = 0; i < 5 && ancestor; i++) {
    for (const sel of selectors) {
      const el = ancestor.querySelector(sel);
      if (el && el !== passwordField) return el;
    }
    ancestor = ancestor.parentElement;
  }

  return null;
}

// ─── Detect login form ────────────────────────────────────────────────────────

function detectLoginForm() {
  if (!getPasswordField()) return;
  chrome.runtime.sendMessage({ action: 'form_detected' });
}

detectLoginForm();
const observer = new MutationObserver(() => detectLoginForm());
observer.observe(document.body, { childList: true, subtree: true });

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // Popup asks: is there a login form on this exact page?
  if (msg.action === 'check_login_form') {
    sendResponse({ hasLoginForm: !!getPasswordField() });
    return;
  }

  // Background forwards decrypted credentials to fill
  if (msg.action === 'fill') {
    const passwordField = getPasswordField();
    if (!passwordField) {
      console.warn('[SecurePass] No password field found on this page');
      return;
    }

    const usernameField = findUsernameField(passwordField);
    fillField(usernameField, msg.username);
    fillField(passwordField, msg.password);
  }
});

// ─── Fill helper ──────────────────────────────────────────────────────────────

function fillField(el, value) {
  if (!el || value == null) return;

  const nativeSet = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  if (nativeSet) nativeSet.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.focus();
}
