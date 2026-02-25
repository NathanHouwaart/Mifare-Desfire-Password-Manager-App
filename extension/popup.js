/**
 * popup.js
 *
 * Runs inside popup.html when the user clicks the extension icon.
 *
 * Flow:
 *   1. Get current tab hostname
 *   2. Ask background for matching entries
 *   3. Check if any frame on the page contains a login password field
 *   4. Render entries and enable Fill when possible
 */

'use strict';

const bodyEl = document.getElementById('body');
const domainEl = document.getElementById('domain-label');

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) {
    renderError('Could not read current tab');
    return;
  }
  loadPopupForTab(tab);
});

function loadPopupForTab(tab) {
  if (!tab?.url || typeof tab.id !== 'number') {
    renderError('Could not read current tab');
    return;
  }

  let hostname = '';
  try {
    hostname = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {
    renderError('Not a valid web page');
    return;
  }

  domainEl.textContent = hostname;

  // Run both requests in parallel: matching entries + form detection.
  let entriesResp = null;
  let formState = { hasLoginForm: true, verified: false };
  let pending = 2;

  function onBothReady() {
    pending -= 1;
    if (pending > 0) return;

    if (!entriesResp || !entriesResp.ok) {
      const msg = entriesResp?.error ?? 'Could not connect to SecurePass.';
      const hint = msg.includes('not running')
        ? 'Open the SecurePass desktop app first.'
        : null;
      renderError(msg, hint);
      return;
    }

    if ((entriesResp.entries ?? []).length === 0) {
      renderNoMatch(hostname);
      return;
    }

    renderEntryList(entriesResp.entries, tab.id, hostname, formState);
  }

  chrome.runtime.sendMessage(
    { action: 'list_for_domain', domain: hostname },
    (resp) => {
      entriesResp = resp;
      onBothReady();
    }
  );

  detectLoginFormInTab(tab.id, (state) => {
    formState = state;
    onBothReady();
  });
}

/**
 * Detect a password field in any frame of the tab.
 * This avoids false negatives on pages that render login forms in iframes.
 */
function detectLoginFormInTab(tabId, done) {
  if (typeof tabId !== 'number') {
    done({ hasLoginForm: false, verified: true });
    return;
  }

  if (!chrome.scripting?.executeScript) {
    fallbackToContentCheck(tabId, done);
    return;
  }

  chrome.scripting.executeScript(
    {
      target: { tabId, allFrames: true },
      func: () => {
        function isVisible(input) {
          const style = window.getComputedStyle(input);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = input.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        const fields = document.querySelectorAll(
          'input[type="password"]:not([disabled]):not([aria-hidden="true"])'
        );

        return Array.from(fields).some((field) => isVisible(field));
      },
    },
    (results) => {
      if (!chrome.runtime.lastError && Array.isArray(results)) {
        const hasLoginForm = results.some((item) => item?.result === true);
        done({ hasLoginForm, verified: true });
        return;
      }

      fallbackToContentCheck(tabId, done);
    }
  );
}

function fallbackToContentCheck(tabId, done) {
  chrome.tabs.sendMessage(tabId, { action: 'check_login_form' }, (resp) => {
    if (!chrome.runtime.lastError && typeof resp?.hasLoginForm === 'boolean') {
      done({ hasLoginForm: resp.hasLoginForm, verified: true });
      return;
    }

    // Unknown detection state. Keep Fill enabled instead of hard-blocking.
    done({ hasLoginForm: true, verified: false });
  });
}

// Renderers

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

function renderEntryList(entries, tabId, domain, formState) {
  const list = document.createElement('div');
  list.className = 'entry-list';

  const hasConfirmedNoForm = formState.verified && !formState.hasLoginForm;
  const canFill = !hasConfirmedNoForm;

  if (hasConfirmedNoForm) {
    const notice = document.createElement('div');
    notice.className = 'no-form-notice';
    notice.textContent = 'No login form detected on this page.';
    list.appendChild(notice);
  }

  for (const entry of entries) {
    const initial = (entry.label || '?')[0];
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `
      <div class="entry-avatar">${escHtml(initial)}</div>
      <div class="entry-info">
        <div class="entry-label">${escHtml(entry.label)}</div>
        <div class="entry-url">${escHtml(entry.url)}</div>
      </div>
      <button class="fill-btn" ${canFill ? '' : 'disabled title="No login form on this page"'}>Fill</button>`;

    if (canFill) {
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
      if (!tab) {
        renderError('Could not read current tab');
        return;
      }
      loadPopupForTab(tab);
    });
  });
}

// Fill action

function handleFill(entry, tabId, domain) {
  renderTapping(entry.label);

  chrome.runtime.sendMessage(
    { action: 'fill_entry', entryId: entry.id, tabId, domain },
    (resp) => {
      if (!resp || !resp.ok) {
        renderError(resp?.error ?? 'Fill failed');
      } else {
        window.close();
      }
    }
  );
}

// Utility

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
