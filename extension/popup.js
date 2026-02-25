/**
 * popup.js
 *
 * Runs inside popup.html when the user clicks the extension icon.
 *
 * Flow:
 *   1. Get current tab's hostname
 *   2. Ask background to list matching vault entries (no card tap)
 *   3. Render the list
 *   4. When user clicks "Fill":
 *        - Ask background to decrypt + send to content script (card tap required)
 *        - Show "Tap card…" state while waiting
 *        - Close popup on success
 */

'use strict';

const bodyEl   = document.getElementById('body');
const domainEl = document.getElementById('domain-label');

// ─── Bootstrap ────────────────────────────────────────────────────────────────

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab?.url) return renderError('Could not read current tab');

  let hostname = '';
  try {
    hostname = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {
    return renderError('Not a valid web page');
  }

  domainEl.textContent = hostname;

  // Run both requests in parallel: vault entries + login form check
  let entriesResp  = null;
  let hasLoginForm = false;
  let pending      = 2;

  function onBothReady() {
    if (--pending > 0) return;

    if (!entriesResp || !entriesResp.ok) {
      const msg = entriesResp?.error ?? 'Could not connect to SecurePass.';
      const hint = msg.includes('not running')
        ? 'Open the SecurePass desktop app first.'
        : null;
      return renderError(msg, hint);
    }
    if (entriesResp.entries.length === 0) return renderNoMatch(hostname);
    renderEntryList(entriesResp.entries, tab.id, hostname, hasLoginForm);
  }

  chrome.runtime.sendMessage(
    { action: 'list_for_domain', domain: hostname },
    (resp) => { entriesResp = resp; onBothReady(); }
  );

  // Ask content script on the active tab if there's a password field visible
  chrome.tabs.sendMessage(tab.id, { action: 'check_login_form' }, (resp) => {
    if (chrome.runtime.lastError) { /* content script not injected yet — treat as no form */ }
    hasLoginForm = resp?.hasLoginForm ?? false;
    onBothReady();
  });
});

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderError(msg, hint) {
  bodyEl.innerHTML = `
    <div class="status error">
      ${escHtml(msg)}
      ${hint ? `<span class="status-hint">${escHtml(hint)}</span>` : ''}
    </div>`;
}

function renderNoMatch(domain) {
  bodyEl.innerHTML = `
    <div class="no-match">
      No saved credentials for<br>
      <strong style="color:#8888a0">${escHtml(domain)}</strong>
    </div>`;
}

function renderEntryList(entries, tabId, domain, hasLoginForm) {
  const list = document.createElement('div');
  list.className = 'entry-list';

  if (!hasLoginForm) {
    const notice = document.createElement('div');
    notice.className = 'no-form-notice';
    notice.textContent = 'No login form detected on this page.';
    list.appendChild(notice);
  }

  for (const entry of entries) {
    const initial = (entry.label || '?')[0];
    const card  = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `
      <div class="entry-avatar">${escHtml(initial)}</div>
      <div class="entry-info">
        <div class="entry-label">${escHtml(entry.label)}</div>
        <div class="entry-url">${escHtml(entry.url)}</div>
      </div>
      <button class="fill-btn" ${hasLoginForm ? '' : 'disabled title="No login form on this page"'}>Fill</button>`;

    if (hasLoginForm) {
      card.querySelector('.fill-btn').addEventListener('click', () => {
        handleFill(entry, tabId, domain);
      });
    }

    list.appendChild(card);
  }

  bodyEl.innerHTML = '';
  bodyEl.appendChild(list);
}

function renderTapping(label) {
  bodyEl.innerHTML = `
    <div class="tap-screen">
      <div class="tap-rings">
        <span class="tap-ring"></span>
        <span class="tap-ring delay"></span>
        <div class="tap-icon-circle">
          <!-- NFC card + arcs icon -->
          <svg viewBox="0 0 24 24">
            <rect x="2" y="5" width="20" height="14" rx="2"/>
            <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none"/>
            <path d="M9.5 8.5a4 4 0 0 1 5 0"/>
            <path d="M7 6.5a7 7 0 0 1 10 0"/>
          </svg>
        </div>
      </div>
      <div class="tap-text">
        <div class="tap-title">Tap Your Card</div>
        <div class="tap-subtitle">Hold your NFC card near the reader</div>
        <div class="tap-entry">${escHtml(label)}</div>
      </div>
      <div class="tap-bar"><div class="tap-bar-fill"></div></div>
      <button class="tap-cancel" id="tap-cancel-btn">
        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Cancel
      </button>
    </div>`;

  document.getElementById('tap-cancel-btn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      let hostname = '';
      try { hostname = new URL(tab?.url ?? '').hostname.replace(/^www\./, ''); } catch {}

      let entriesResp  = null;
      let hasLoginForm = false;
      let pending      = 2;

      function onReady() {
        if (--pending > 0) return;
        if (!entriesResp?.ok || entriesResp.entries.length === 0) renderNoMatch(hostname);
        else renderEntryList(entriesResp.entries, tab.id, hostname, hasLoginForm);
      }

      chrome.runtime.sendMessage(
        { action: 'list_for_domain', domain: hostname },
        (resp) => { entriesResp = resp; onReady(); }
      );
      chrome.tabs.sendMessage(tab.id, { action: 'check_login_form' }, (resp) => {
        if (chrome.runtime.lastError) {}
        hasLoginForm = resp?.hasLoginForm ?? false;
        onReady();
      });
    });
  });
}

// ─── Fill action ──────────────────────────────────────────────────────────────

function handleFill(entry, tabId, domain) {
  renderTapping(entry.label);

  chrome.runtime.sendMessage(
    { action: 'fill_entry', entryId: entry.id, tabId, domain },
    (resp) => {
      if (!resp || !resp.ok) {
        renderError(resp?.error ?? 'Fill failed');
      } else {
        // Success — close the popup
        window.close();
      }
    }
  );
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
