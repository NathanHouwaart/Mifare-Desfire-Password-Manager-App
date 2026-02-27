import { useEffect, useState, type ReactNode, type ComponentType } from 'react';
import { Paintbrush, Shield, Clipboard, Cpu, HardDrive, SlidersHorizontal, Search, X, Loader2, Globe, Cloud, RefreshCw } from 'lucide-react';

const PIN_HASH_KEY = 'app-pin-hash';

interface SettingsPageProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  terminalEnabled: boolean;
  onToggleTerminalEnabled: () => void;
}

// ── Primitives ──────────────────────────────────────────────────────────────

const Section = ({
  title, icon: Icon, children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) => (
  <div className="bg-card border border-edge rounded-2xl overflow-hidden">
    <div className="flex items-center gap-2.5 px-5 py-4 border-b border-edge">
      <Icon className="w-[17px] h-[17px] text-accent" />
      <h2 className="text-[13px] font-semibold text-dim uppercase tracking-widest">{title}</h2>
    </div>
    <div className="divide-y divide-edge">{children}</div>
  </div>
);

const Switch = ({ on }: { on: boolean }) => (
  <div className={`w-[52px] h-7 rounded-full flex items-center px-0.5 transition-colors duration-200 shrink-0
                   ${on ? 'bg-accent-solid' : 'bg-edge2'}`}>
    <div className={`w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200
                     ${on ? 'translate-x-6' : 'translate-x-0'}`} />
  </div>
);

const ToggleRow = ({
  label, description, value, onChange,
}: {
  label: string; description?: string; value: boolean; onChange: () => void;
}) => (
  <div
    role="switch"
    aria-checked={value}
    tabIndex={0}
    onClick={onChange}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(); } }}
    className="flex items-center justify-between px-5 py-4 cursor-pointer gap-4
               hover:bg-input active:bg-input select-none transition-colors duration-100
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset
               focus-visible:ring-accent-edge"
  >
    <div className="flex-1 min-w-0">
      <p className="text-[16px] font-medium text-hi">{label}</p>
      {description && <p className="text-[14px] text-lo mt-0.5 leading-snug">{description}</p>}
    </div>
    <Switch on={value} />
  </div>
);

const SelectRow = ({
  label, description, value, options, onChange,
}: {
  label: string; description?: string; value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) => (
  <div className="flex items-center justify-between px-5 py-4 gap-4">
    <div className="flex-1 min-w-0">
      <p className="text-[16px] font-medium text-hi">{label}</p>
      {description && <p className="text-[14px] text-lo mt-0.5 leading-snug">{description}</p>}
    </div>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-input border border-edge text-hi text-[15px] rounded-xl shrink-0
                 px-3 py-2.5 outline-none focus:border-accent-edge
                 appearance-none cursor-pointer transition-all duration-150"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const ButtonRow = ({
  label, description, buttonLabel, variant = 'default', onClick, busy, feedback,
}: {
  label: string; description?: string; buttonLabel: string;
  variant?: 'default' | 'danger'; onClick: () => void;
  busy?: boolean;
  feedback?: { type: 'ok' | 'err'; message: string } | null;
}) => (
  <div className="px-5 py-4 flex flex-col gap-1.5">
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[16px] font-medium text-hi">{label}</p>
        {description && <p className="text-[14px] text-lo mt-0.5 leading-snug">{description}</p>}
      </div>
      <button
        onClick={onClick}
        disabled={busy}
        className={`shrink-0 px-4 py-2.5 rounded-xl text-[15px] font-medium border flex items-center gap-2
                    active:scale-95 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed
                    ${variant === 'danger'
                      ? 'text-err border-err-edge bg-err-soft hover:opacity-90'
                      : 'text-accent border-accent-edge bg-accent-soft hover:opacity-90'}`}
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {buttonLabel}
      </button>
    </div>
    {feedback && (
      <p className={`text-[13px] ml-0.5 ${
        feedback.type === 'ok' ? 'text-ok' : 'text-err'
      }`}>{feedback.message}</p>
    )}
  </div>
);

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between px-5 py-4">
    <p className="text-[16px] font-medium text-hi">{label}</p>
    <p className="text-[15px] text-lo">{value}</p>
  </div>
);

// ── Page ──────────────────────────────────────────────────────────────────

export const SettingsPage = ({ theme, onToggleTheme, terminalEnabled, onToggleTerminalEnabled }: SettingsPageProps) => {
  const ls    = (k: string, d: string)  => localStorage.getItem(k) ?? d;
  const lsBool= (k: string, d: boolean) =>
    localStorage.getItem(k) !== null ? localStorage.getItem(k) === 'true' : d;

  const [requirePinWake, setRequirePinWake] = useState(() => lsBool('setting-pin-wake',       false));
  const [autoLock,       setAutoLock]       = useState(() => ls   ('setting-autolock',         '5'));
  const [revealDuration, setRevealDuration] = useState(() => ls   ('setting-reveal-duration',  '5'));
  const [autoClear,      setAutoClear]      = useState(() => lsBool('setting-autoclear',       false));
  const [autoClearDelay, setAutoClearDelay] = useState(() => ls   ('setting-autoclear-delay',  '30'));
  const [autoConnect,    setAutoConnect]    = useState(() => lsBool('setting-autoconnect',     true));
  const [connTimeout,    setConnTimeout]    = useState(() => ls   ('setting-conn-timeout',     '10'));
  const [retryAttempts,  setRetryAttempts]  = useState(() => ls   ('setting-retries',          '3'));

  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [importFeedback, setImportFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [extRegBusy,  setExtRegBusy]  = useState(false);
  const [extRegFeedback, setExtRegFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [extFolderBusy, setExtFolderBusy] = useState(false);
  const [extFolderFeedback, setExtFolderFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);

  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);
  const [syncBaseUrl, setSyncBaseUrl] = useState('');
  const [syncUsername, setSyncUsername] = useState('');
  const [syncDeviceName, setSyncDeviceName] = useState('');
  const [syncPassword, setSyncPassword] = useState('');
  const [syncBootstrapToken, setSyncBootstrapToken] = useState('');
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [syncConfigBusy, setSyncConfigBusy] = useState(false);
  const [syncAuthBusy, setSyncAuthBusy] = useState(false);
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const [syncLogoutBusy, setSyncLogoutBusy] = useState(false);
  const [syncClearBusy, setSyncClearBusy] = useState(false);
  const [syncHydrated, setSyncHydrated] = useState(false);

  const tog = (key: string, cur: boolean, set: (v: boolean) => void) => {
    const next = !cur; set(next); localStorage.setItem(key, String(next));
  };
  const sel = (key: string, val: string, set: (v: string) => void) => {
    set(val); localStorage.setItem(key, val);
  };

  const handleChangePIN = () => {
    localStorage.removeItem(PIN_HASH_KEY);
    alert('PIN cleared. You will be asked to set a new PIN when you next lock the vault.');
  };

  const handleExport = async () => {
    setExportBusy(true); setExportFeedback(null);
    try {
      const res = await window.electron['vault:export']();
      if (res.success) {
        setExportFeedback({ type: 'ok', message: `Exported ${res.count} entr${res.count === 1 ? 'y' : 'ies'} successfully.` });
      } else {
        if (res.error) setExportFeedback({ type: 'err', message: res.error });
      }
    } catch (e) {
      setExportFeedback({ type: 'err', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExportBusy(false);
      setTimeout(() => setExportFeedback(null), 5000);
    }
  };

  const handleImport = async () => {
    setImportBusy(true); setImportFeedback(null);
    try {
      const res = await window.electron['vault:import']();
      if (res.success) {
        setImportFeedback({ type: 'ok', message: `Imported ${res.imported} entr${res.imported === 1 ? 'y' : 'ies'}, skipped ${res.skipped} duplicate${res.skipped === 1 ? '' : 's'}.` });
      } else {
        if (res.error) setImportFeedback({ type: 'err', message: res.error });
      }
    } catch (e) {
      setImportFeedback({ type: 'err', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setImportBusy(false);
      setTimeout(() => setImportFeedback(null), 6000);
    }
  };

  const handleClearData = () => {
    if (!window.confirm('Permanently delete all vault data? This cannot be undone.')) return;
    const savedTheme = localStorage.getItem('app-theme');
    localStorage.clear();
    if (savedTheme) localStorage.setItem('app-theme', savedTheme);
    alert('All vault data cleared.');
  };

  const handleReloadRegistration = async () => {
    setExtRegBusy(true); setExtRegFeedback(null);
    try {
      const res = await window.electron['extension:reload-registration']();
      setExtRegFeedback(res.ok
        ? { type: 'ok',  message: 'Native host re-registered successfully.' }
        : { type: 'err', message: res.error ?? 'Registration failed.' });
    } catch (e) {
      setExtRegFeedback({ type: 'err', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExtRegBusy(false);
      setTimeout(() => setExtRegFeedback(null), 5000);
    }
  };

  const handleOpenExtensionFolder = async () => {
    setExtFolderBusy(true); setExtFolderFeedback(null);
    try {
      const res = await window.electron['extension:open-folder']();
      setExtFolderFeedback(res.ok
        ? { type: 'ok', message: res.path ? `Opened: ${res.path}` : 'Extension folder opened.' }
        : { type: 'err', message: res.error ?? 'Failed to open extension folder.' });
    } catch (e) {
      setExtFolderFeedback({ type: 'err', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExtFolderBusy(false);
      setTimeout(() => setExtFolderFeedback(null), 7000);
    }
  };

  // ── Settings search ─────────────────────────────────────────────
  const syncFeedbackFor = (type: 'ok' | 'err', message: string, timeoutMs = 6000) => {
    setSyncFeedback({ type, message });
    window.setTimeout(() => setSyncFeedback(null), timeoutMs);
  };

  const refreshSyncStatus = async (hydrateInputs = false) => {
    try {
      const status = await window.electron['sync:getStatus']();
      setSyncStatus(status);
      if (hydrateInputs || !syncHydrated) {
        setSyncBaseUrl(status.baseUrl ?? '');
        setSyncUsername(status.username ?? '');
        setSyncDeviceName(status.deviceName ?? '');
        setSyncHydrated(true);
      }
    } catch (e) {
      setSyncStatus(null);
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refreshSyncStatus(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveSyncConfig = async () => {
    if (!syncBaseUrl.trim() || !syncUsername.trim()) {
      syncFeedbackFor('err', 'Sync URL and username are required.');
      return;
    }
    setSyncConfigBusy(true);
    setSyncFeedback(null);
    try {
      const status = await window.electron['sync:setConfig']({
        baseUrl: syncBaseUrl.trim(),
        username: syncUsername.trim(),
        deviceName: syncDeviceName.trim() || undefined,
      });
      setSyncStatus(status);
      setSyncBaseUrl(status.baseUrl ?? '');
      setSyncUsername(status.username ?? '');
      setSyncDeviceName(status.deviceName ?? '');
      syncFeedbackFor('ok', 'Sync config saved.');
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncConfigBusy(false);
    }
  };

  const handleSyncBootstrap = async () => {
    if (!syncPassword.trim()) {
      syncFeedbackFor('err', 'Sync password is required.');
      return;
    }
    if (!syncBootstrapToken.trim()) {
      syncFeedbackFor('err', 'Bootstrap token is required.');
      return;
    }
    setSyncAuthBusy(true);
    setSyncFeedback(null);
    try {
      const status = await window.electron['sync:bootstrap']({
        password: syncPassword,
        bootstrapToken: syncBootstrapToken.trim(),
      });
      setSyncStatus(status);
      setSyncPassword('');
      syncFeedbackFor('ok', `Account bootstrapped for ${status.username}.`);
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncAuthBusy(false);
    }
  };

  const handleSyncLogin = async () => {
    if (!syncPassword.trim()) {
      syncFeedbackFor('err', 'Sync password is required.');
      return;
    }
    setSyncAuthBusy(true);
    setSyncFeedback(null);
    try {
      const status = await window.electron['sync:login']({ password: syncPassword });
      setSyncStatus(status);
      setSyncPassword('');
      syncFeedbackFor('ok', `Logged in as ${status.username}.`);
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncAuthBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncNowBusy(true);
    setSyncFeedback(null);
    try {
      const result = await window.electron['sync:syncNow']();
      await refreshSyncStatus();
      syncFeedbackFor(
        'ok',
        `Sync complete. Push ${result.push.sent}/${result.push.applied}, pull ${result.pull.received}/${result.pull.applied}, deleted ${result.pull.deleted}.`
      );
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncNowBusy(false);
    }
  };

  const handleSyncLogout = async () => {
    setSyncLogoutBusy(true);
    setSyncFeedback(null);
    try {
      const status = await window.electron['sync:logout']();
      setSyncStatus(status);
      syncFeedbackFor('ok', 'Sync session logged out.');
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncLogoutBusy(false);
    }
  };

  const handleSyncClearConfig = async () => {
    if (!window.confirm('Remove sync config and local sync session for this device?')) return;
    setSyncClearBusy(true);
    setSyncFeedback(null);
    try {
      const status = await window.electron['sync:clearConfig']();
      setSyncStatus(status);
      setSyncBaseUrl('');
      setSyncUsername('');
      setSyncDeviceName('');
      setSyncPassword('');
      setSyncBootstrapToken('');
      syncFeedbackFor('ok', 'Sync config and session removed.');
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncClearBusy(false);
    }
  };

  const [settingsSearch, setSettingsSearch] = useState('');
  const q = settingsSearch.trim().toLowerCase();
  const show = (...texts: string[]) => !q || texts.some(t => t.toLowerCase().includes(q));

  const showSec = {
    appearance: show('Light Mode', 'Switch between dark and light theme'),
    security:   show('Require PIN on Wake', 'Re-lock vault when the app regains focus')
             || show('Auto-lock After', 'Automatically lock after this period of inactivity')
             || show('Change PIN', 'Clear current PIN and set a new one on next lock'),
    clipboard:  show('Password Reveal Duration', 'How long a password stays visible after clicking Show')
             || show('Auto-clear Clipboard', 'Remove copied password from clipboard automatically')
             || show('Clear After'),
    nfc:        show('Show Output Panel', 'Display the NFC log terminal at the bottom of the window')
             || show('Auto-connect on Startup', 'Connect to the last-used COM port automatically')
             || show('Connection Timeout', 'Abort the connection attempt after this duration')
             || show('Retry Attempts', 'Number of times to retry a failed connection'),
    sync:       show('Sync Status', 'Background sync every 2 minutes when logged in')
             || show('Sync URL', 'Username', 'Device Name')
             || show('Save Config', 'Bootstrap', 'Login', 'Sync Now', 'Logout', 'Reset Sync'),
    data:       show('Export Vault', 'Save an encrypted backup of your passwords')
             || show('Import Vault', 'Restore passwords from an encrypted backup')
             || show('App Version', '0.1.0') || show('Stack', 'Electron React C++')
             || show('Clear All Data', 'Permanently delete all passwords and reset the vault'),
    extension:  show('Browser Extension', 'Autofill passwords in Chrome and Firefox')
             || show('Reload Registration', 'Re-register the native messaging host')
             || show('Open Extension Folder', 'Load the extension in Chrome or Firefox'),
  };
  const noResults = q.length > 0 && !Object.values(showSec).some(Boolean);
  const formatSyncTime = (timestamp?: number) =>
    timestamp ? new Date(timestamp).toLocaleString() : 'Never';

  return (
    <div className="px-6 py-6 max-w-2xl w-full mx-auto">

      {/* Page header */}
      <div className="flex items-start gap-4 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent-edge
                        flex items-center justify-center shrink-0 mt-0.5">
          <SlidersHorizontal className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-hi leading-tight">Settings</h1>
          <p className="text-[14px] text-lo mt-0.5">App preferences and configuration</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dim pointer-events-none" />
        <input
          type="text"
          placeholder="Search settings…"
          value={settingsSearch}
          onChange={e => setSettingsSearch(e.target.value)}
          className="w-full bg-card border border-edge text-hi
                     placeholder-[var(--color-dim)] text-[16px]
                     pl-10 pr-9 py-2.5 rounded-xl outline-none
                     focus:border-accent-edge focus:ring-1 focus:ring-accent-soft
                     transition-all duration-150"
        />
        {settingsSearch && (
          <button
            onClick={() => setSettingsSearch('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-hi
                       transition-colors duration-100"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* No-results state */}
      {noResults && (
        <div className="flex flex-col items-center gap-3 py-16 text-center select-none">
          <div className="w-12 h-12 rounded-2xl bg-card border border-edge flex items-center justify-center">
            <Search className="w-5 h-5 text-dim" />
          </div>
          <p className="text-[16px] text-lo">No settings found</p>
          <p className="text-[14px] text-dim">Try a different search term</p>
        </div>
      )}

      <div className="flex flex-col gap-4">

        {/* Appearance */}
        {showSec.appearance && (
          <Section title="Appearance" icon={Paintbrush}>
            {show('Light Mode', 'Switch between dark and light theme') && (
              <ToggleRow
                label="Light Mode"
                description="Switch between dark and light theme"
                value={theme === 'light'}
                onChange={onToggleTheme}
              />
            )}
          </Section>
        )}

        {/* Security */}
        {showSec.security && (
          <Section title="Security" icon={Shield}>
            {show('Require PIN on Wake', 'Re-lock vault when the app regains focus') && (
              <ToggleRow
                label="Require PIN on Wake"
                description="Re-lock vault when the app regains focus"
                value={requirePinWake}
                onChange={() => tog('setting-pin-wake', requirePinWake, setRequirePinWake)}
              />
            )}
            {show('Auto-lock After', 'Automatically lock after this period of inactivity') && (
              <SelectRow
                label="Auto-lock After"
                description="Automatically lock after this period of inactivity"
                value={autoLock}
                options={[
                  { value: '1',     label: '1 minute'   },
                  { value: '5',     label: '5 minutes'  },
                  { value: '15',    label: '15 minutes' },
                  { value: '30',    label: '30 minutes' },
                  { value: 'never', label: 'Never'      },
                ]}
                onChange={v => sel('setting-autolock', v, setAutoLock)}
              />
            )}
            {show('Change PIN', 'Clear current PIN and set a new one on next lock') && (
              <ButtonRow
                label="Change PIN"
                description="Clear current PIN and set a new one on next lock"
                buttonLabel="Change"
                onClick={handleChangePIN}
              />
            )}
          </Section>
        )}

        {/* Clipboard */}
        {showSec.clipboard && (
          <Section title="Clipboard" icon={Clipboard}>
            {show('Password Reveal Duration', 'How long a password stays visible after clicking Show') && (
              <SelectRow
                label="Password Reveal Duration"
                description="How long a password stays visible after clicking Show"
                value={revealDuration}
                options={[
                  { value: '3',  label: '3 seconds'  },
                  { value: '5',  label: '5 seconds'  },
                  { value: '10', label: '10 seconds' },
                  { value: '30', label: '30 seconds' },
                  { value: '0',  label: 'Until hidden manually' },
                ]}
                onChange={v => sel('setting-reveal-duration', v, setRevealDuration)}
              />
            )}
            {show('Auto-clear Clipboard', 'Remove copied password from clipboard automatically') && (
              <ToggleRow
                label="Auto-clear Clipboard"
                description="Remove copied password from clipboard automatically"
                value={autoClear}
                onChange={() => tog('setting-autoclear', autoClear, setAutoClear)}
              />
            )}
            {autoClear && show('Clear After') && (
              <SelectRow
                label="Clear After"
                value={autoClearDelay}
                options={[
                  { value: '15',  label: '15 seconds' },
                  { value: '30',  label: '30 seconds' },
                  { value: '60',  label: '1 minute'   },
                  { value: '120', label: '2 minutes'  },
                ]}
                onChange={v => sel('setting-autoclear-delay', v, setAutoClearDelay)}
              />
            )}
          </Section>
        )}

        {/* NFC Reader */}
        {showSec.nfc && (
          <Section title="NFC Reader" icon={Cpu}>
            {show('Show Output Panel', 'Display the NFC log terminal at the bottom of the window') && (
              <ToggleRow
                label="Show Output Panel"
                description="Display the NFC log terminal at the bottom of the window"
                value={terminalEnabled}
                onChange={onToggleTerminalEnabled}
              />
            )}
            {show('Auto-connect on Startup', 'Connect to the last-used COM port automatically') && (
              <ToggleRow
                label="Auto-connect on Startup"
                description="Connect to the last-used COM port automatically"
                value={autoConnect}
                onChange={() => tog('setting-autoconnect', autoConnect, setAutoConnect)}
              />
            )}
            {show('Connection Timeout', 'Abort the connection attempt after this duration') && (
              <SelectRow
                label="Connection Timeout"
                description="Abort the connection attempt after this duration"
                value={connTimeout}
                options={[
                  { value: '5',  label: '5 seconds'  },
                  { value: '10', label: '10 seconds' },
                  { value: '30', label: '30 seconds' },
                  { value: '60', label: '1 minute'   },
                ]}
                onChange={v => sel('setting-conn-timeout', v, setConnTimeout)}
              />
            )}
            {show('Retry Attempts', 'Number of times to retry a failed connection') && (
              <SelectRow
                label="Retry Attempts"
                description="Number of times to retry a failed connection"
                value={retryAttempts}
                options={[
                  { value: '1',  label: '1 attempt'   },
                  { value: '3',  label: '3 attempts'  },
                  { value: '5',  label: '5 attempts'  },
                  { value: '10', label: '10 attempts' },
                ]}
                onChange={v => sel('setting-retries', v, setRetryAttempts)}
              />
            )}
          </Section>
        )}

        {/* Browser Extension */}
        {showSec.extension && (
          <Section title="Browser Extension" icon={Globe}>
            {show('Browser Extension', 'Autofill passwords in Chrome and Firefox') && (
              <div className="px-5 py-4">
                <p className="text-[14px] text-lo leading-relaxed">
                  The SecurePass extension autofills passwords in Chrome and Firefox using your NFC card.
                  After installing the app, load the extension manually once, then it will always stay registered.
                </p>
                <ol className="mt-3 space-y-1.5 text-[13px] text-dim list-decimal list-inside leading-relaxed">
                  <li>Click <strong className="text-lo">Open Extension Folder</strong> below</li>
                  <li>In Chrome: go to <code className="text-accent">chrome://extensions</code> → enable <em>Developer mode</em> → <em>Load unpacked</em> → select the folder</li>
                  <li>In Firefox: go to <code className="text-accent">about:debugging</code> → <em>This Firefox</em> → <em>Load Temporary Add-on</em> → select <code className="text-accent">manifest.json</code></li>
                  <li>The native host is registered automatically every time SecurePass starts</li>
                </ol>
              </div>
            )}
            {show('Open Extension Folder', 'Load the extension in Chrome or Firefox') && (
              <ButtonRow
                label="Open Extension Folder"
                description="Opens the bundled extension in File Explorer so you can load it in your browser"
                buttonLabel={extFolderBusy ? 'Opening…' : 'Open Folder'}
                busy={extFolderBusy}
                feedback={extFolderFeedback}
                onClick={handleOpenExtensionFolder}
              />
            )}
            {show('Reload Registration', 'Re-register the native messaging host') && (
              <ButtonRow
                label="Reload Registration"
                description="Re-registers the native messaging host with Chrome and Firefox — run this if the extension stops connecting"
                buttonLabel={extRegBusy ? 'Registering…' : 'Reload'}
                busy={extRegBusy}
                feedback={extRegFeedback}
                onClick={handleReloadRegistration}
              />
            )}
          </Section>
        )}

        {/* Sync */}
        {showSec.sync && (
          <Section title="Sync" icon={Cloud}>
            {show('Sync Status', 'Background sync every 2 minutes when logged in') && (
              <div className="px-5 py-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[12px] px-2 py-1 rounded-lg border ${
                    syncStatus?.configured
                      ? 'text-ok border-ok-edge bg-ok-soft'
                      : 'text-dim border-edge bg-input'
                  }`}>
                    {syncStatus?.configured ? 'Configured' : 'Not Configured'}
                  </span>
                  <span className={`text-[12px] px-2 py-1 rounded-lg border ${
                    syncStatus?.loggedIn
                      ? 'text-ok border-ok-edge bg-ok-soft'
                      : 'text-dim border-edge bg-input'
                  }`}>
                    {syncStatus?.loggedIn ? 'Logged In' : 'Logged Out'}
                  </span>
                  <span className="text-[12px] px-2 py-1 rounded-lg border text-dim border-edge bg-input">
                    Cursor: {syncStatus?.cursor ?? 0}
                  </span>
                </div>
                <p className="text-[13px] text-lo">
                  Background sync runs every 2 minutes while logged in.
                </p>
                <p className="text-[13px] text-lo">
                  Last successful sync: {formatSyncTime(syncStatus?.lastSyncAt)}
                </p>
                <p className="text-[13px] text-lo">
                  Last sync attempt: {formatSyncTime(syncStatus?.lastSyncAttemptAt)}
                </p>
                {syncStatus?.lastSyncError && (
                  <p className="text-[13px] text-err">
                    Last sync error: {syncStatus.lastSyncError}
                  </p>
                )}
              </div>
            )}

            {show('Sync URL', 'Username', 'Device Name', 'Save Config') && (
              <div className="px-5 py-4 flex flex-col gap-3">
                <p className="text-[16px] font-medium text-hi">Sync Configuration</p>
                <div className="grid grid-cols-1 gap-2.5">
                  <input
                    type="text"
                    value={syncBaseUrl}
                    onChange={(e) => setSyncBaseUrl(e.target.value)}
                    placeholder="Sync URL (for example: https://100.x.x.x:8787)"
                    className="bg-input border border-edge text-hi text-[15px] rounded-xl px-3 py-2.5 outline-none focus:border-accent-edge"
                  />
                  <input
                    type="text"
                    value={syncUsername}
                    onChange={(e) => setSyncUsername(e.target.value)}
                    placeholder="Username"
                    className="bg-input border border-edge text-hi text-[15px] rounded-xl px-3 py-2.5 outline-none focus:border-accent-edge"
                  />
                  <input
                    type="text"
                    value={syncDeviceName}
                    onChange={(e) => setSyncDeviceName(e.target.value)}
                    placeholder="Device Name (optional)"
                    className="bg-input border border-edge text-hi text-[15px] rounded-xl px-3 py-2.5 outline-none focus:border-accent-edge"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleSaveSyncConfig}
                    disabled={syncConfigBusy}
                    className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncConfigBusy ? 'Saving...' : 'Save Config'}
                  </button>
                </div>
              </div>
            )}

            {show('Bootstrap', 'Login') && (
              <div className="px-5 py-4 flex flex-col gap-3">
                <p className="text-[16px] font-medium text-hi">Authentication</p>
                <input
                  type="password"
                  value={syncPassword}
                  onChange={(e) => setSyncPassword(e.target.value)}
                  placeholder="Sync Password"
                  className="bg-input border border-edge text-hi text-[15px] rounded-xl px-3 py-2.5 outline-none focus:border-accent-edge"
                />
                <input
                  type="password"
                  value={syncBootstrapToken}
                  onChange={(e) => setSyncBootstrapToken(e.target.value)}
                  placeholder="Bootstrap Token (first setup only)"
                  className="bg-input border border-edge text-hi text-[15px] rounded-xl px-3 py-2.5 outline-none focus:border-accent-edge"
                />
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={handleSyncBootstrap}
                    disabled={syncAuthBusy}
                    className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncAuthBusy ? 'Working...' : 'Bootstrap'}
                  </button>
                  <button
                    onClick={handleSyncLogin}
                    disabled={syncAuthBusy}
                    className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncAuthBusy ? 'Working...' : 'Login'}
                  </button>
                </div>
              </div>
            )}

            {show('Sync Now', 'Logout', 'Reset Sync') && (
              <div className="px-5 py-4 flex flex-col gap-2.5">
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={handleSyncNow}
                    disabled={syncNowBusy || !syncStatus?.configured || !syncStatus?.loggedIn}
                    className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncNowBusy ? 'animate-spin' : ''}`} />
                    {syncNowBusy ? 'Syncing...' : 'Sync Now'}
                  </button>
                  <button
                    onClick={handleSyncLogout}
                    disabled={syncLogoutBusy || !syncStatus?.loggedIn}
                    className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncLogoutBusy ? 'Logging out...' : 'Logout'}
                  </button>
                  <button
                    onClick={handleSyncClearConfig}
                    disabled={syncClearBusy}
                    className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-err border-err-edge bg-err-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncClearBusy ? 'Resetting...' : 'Reset Sync'}
                  </button>
                </div>
                {syncFeedback && (
                  <p className={`text-[13px] ${syncFeedback.type === 'ok' ? 'text-ok' : 'text-err'}`}>
                    {syncFeedback.message}
                  </p>
                )}
              </div>
            )}
          </Section>
        )}

        {/* Data */}
        {showSec.data && (
          <Section title="Data" icon={HardDrive}>
            {show('Export Vault', 'Save an encrypted backup of your passwords') && (
              <ButtonRow
                label="Export Vault"
                description="Save an encrypted backup of your passwords"
                buttonLabel={exportBusy ? 'Exporting…' : 'Export'}
                busy={exportBusy}
                feedback={exportFeedback}
                onClick={handleExport}
              />
            )}
            {show('Import Vault', 'Restore passwords from an encrypted backup') && (
              <ButtonRow
                label="Import Vault"
                description="Restore passwords from an encrypted backup"
                buttonLabel={importBusy ? 'Importing…' : 'Import'}
                busy={importBusy}
                feedback={importFeedback}
                onClick={handleImport}
              />
            )}
            {show('App Version', '0.1.0') && <InfoRow label="App Version" value="0.1.0" />}
            {show('Stack', 'Electron React C++') && <InfoRow label="Stack" value="Electron + React + C++" />}
            {show('Clear All Data', 'Permanently delete all passwords and reset the vault') && (
              <ButtonRow
                label="Clear All Data"
                description="Permanently delete all passwords and reset the vault"
                buttonLabel="Clear Data"
                variant="danger"
                onClick={handleClearData}
              />
            )}
          </Section>
        )}

      </div>
    </div>
  );
};
