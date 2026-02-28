import { useEffect, useState, type ReactNode, type ComponentType } from 'react';
import QRCode from 'qrcode';
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
  const [pinFeedback, setPinFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [importFeedback, setImportFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [extRegBusy,  setExtRegBusy]  = useState(false);
  const [extRegFeedback, setExtRegFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [extFolderBusy, setExtFolderBusy] = useState(false);
  const [extFolderFeedback, setExtFolderFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);

  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);
  const [syncMode, setSyncMode] = useState<'local' | 'synced'>(
    () => (localStorage.getItem('setting-sync-mode') as 'local' | 'synced') ?? 'local'
  );
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const [vaultKeyStatus, setVaultKeyStatus] = useState<SyncVaultKeyStatusDto | null>(null);
  const [mfaStatus, setMfaStatus] = useState<SyncMfaStatusDto | null>(null);
  const [mfaSetup, setMfaSetup] = useState<SyncMfaSetupDto | null>(null);
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

  const tog = (key: string, cur: boolean, set: (v: boolean) => void) => {
    const next = !cur; set(next); localStorage.setItem(key, String(next));
  };
  const sel = (key: string, val: string, set: (v: string) => void) => {
    set(val); localStorage.setItem(key, val);
  };

  const handleChangePIN = () => {
    localStorage.removeItem(PIN_HASH_KEY);
    setPinFeedback({ type: 'ok', message: "PIN reset. You'll set a new one when you next lock the vault." });
    window.setTimeout(() => setPinFeedback(null), 5000);
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

  const refreshSyncStatus = async (): Promise<SyncStatusDto | null> => {
    try {
      const status = await window.electron['sync:getStatus']();
      setSyncStatus(status);
      return status;
    } catch (e) {
      setSyncStatus(null);
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const refreshVaultKeyStatus = async () => {
    try {
      const status = await window.electron['sync:getVaultKeyStatus']();
      setVaultKeyStatus(status);
    } catch {
      setVaultKeyStatus(null);
    }
  };

  const refreshMfaStatus = async (statusOverride?: SyncStatusDto | null) => {
    const status = statusOverride ?? syncStatus;
    if (!status?.loggedIn) {
      setMfaStatus(null);
      setMfaSetup(null);
      setMfaQrDataUrl(null);
      setMfaCode('');
      return;
    }

    try {
      const nextStatus = await window.electron['sync:mfaStatus']();
      setMfaStatus(nextStatus);
    } catch {
      setMfaStatus(null);
    }
  };

  useEffect(() => {
    const url = mfaSetup?.otpauthUrl;
    if (!url) {
      setMfaQrDataUrl(null);
      return;
    }

    void QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((dataUrl) => setMfaQrDataUrl(dataUrl))
      .catch(() => setMfaQrDataUrl(null));
  }, [mfaSetup]);

  useEffect(() => {
    const init = async () => {
      const status = await refreshSyncStatus();
      await refreshVaultKeyStatus();
      await refreshMfaStatus(status);
    };
    void init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onSyncModeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: 'local' | 'synced' }>).detail;
      const mode = detail?.mode;
      if (mode !== 'local' && mode !== 'synced') return;
      setSyncMode(mode);
      if (mode === 'local') {
        setSyncStatus(null);
        setVaultKeyStatus(null);
        setMfaStatus(null);
        setMfaSetup(null);
        setMfaQrDataUrl(null);
        setMfaCode('');
      } else {
        void (async () => {
          const status = await refreshSyncStatus();
          await refreshVaultKeyStatus();
          await refreshMfaStatus(status);
        })();
      }
    };
    const onSyncDataChanged = () => {
      void (async () => {
        const status = await refreshSyncStatus();
        await refreshVaultKeyStatus();
        await refreshMfaStatus(status);
      })();
    };
    window.addEventListener('securepass:sync-mode-changed', onSyncModeChanged);
    window.addEventListener('securepass:vault-sync-applied', onSyncDataChanged);
    return () => {
      window.removeEventListener('securepass:sync-mode-changed', onSyncModeChanged);
      window.removeEventListener('securepass:vault-sync-applied', onSyncDataChanged);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      window.dispatchEvent(new Event('securepass:vault-sync-applied'));
      await refreshVaultKeyStatus();
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSyncNowBusy(false);
    }
  };

  const handleMfaSetup = async () => {
    if (!syncStatus?.loggedIn) {
      syncFeedbackFor('err', 'Sign in to sync before setting up 2FA.');
      return;
    }

    setMfaBusy(true);
    setSyncFeedback(null);
    try {
      const setup = await window.electron['sync:mfaSetup']();
      setMfaSetup(setup);
      syncFeedbackFor('ok', 'Scan the QR code and enter a 6-digit authenticator code to enable 2FA.');
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setMfaBusy(false);
    }
  };

  const handleMfaEnable = async () => {
    if (!mfaCode.trim()) {
      syncFeedbackFor('err', 'Enter a 6-digit authenticator code.');
      return;
    }

    setMfaBusy(true);
    setSyncFeedback(null);
    try {
      await window.electron['sync:mfaEnable']({ code: mfaCode.trim() });
      setMfaCode('');
      setMfaSetup(null);
      await refreshMfaStatus();
      syncFeedbackFor('ok', '2FA enabled for this account.');
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setMfaBusy(false);
    }
  };

  const handleMfaDisable = async () => {
    if (!mfaCode.trim()) {
      syncFeedbackFor('err', 'Enter your current 6-digit authenticator code to disable 2FA.');
      return;
    }

    setMfaBusy(true);
    setSyncFeedback(null);
    try {
      await window.electron['sync:mfaDisable']({ code: mfaCode.trim() });
      setMfaCode('');
      setMfaSetup(null);
      await refreshMfaStatus();
      syncFeedbackFor('ok', '2FA disabled for this account.');
    } catch (e) {
      syncFeedbackFor('err', e instanceof Error ? e.message : String(e));
    } finally {
      setMfaBusy(false);
    }
  };

  const handleOpenSyncWizard = () => {
    window.dispatchEvent(new CustomEvent('securepass:open-sync-wizard', {
      detail: syncMode === 'synced' ? { mode: 'synced' as const } : {},
    }));
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
    sync:       show('Backup & Sync', 'Background sync every 2 minutes when logged in')
             || show('Mode', 'Open Sync Settings', 'Sync Now', 'Last successful sync', 'Last sync error', '2FA', 'Authenticator'),
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
  const syncStep = syncMode === 'local'
    ? 'local'
    : !syncStatus?.configured
      ? 'configure'
      : !syncStatus.loggedIn
        ? 'auth'
        : !vaultKeyStatus?.hasRemoteEnvelope || !vaultKeyStatus?.hasLocalUnlockedKey
          ? 'finish-setup'
            : 'ready';

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
                feedback={pinFeedback}
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

        {/* Backup & Sync */}
        {showSec.sync && (
          <Section title="Backup & Sync" icon={Cloud}>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-[16px] font-medium text-hi">Mode</p>
              <span className={`self-start text-[12px] px-2 py-1 rounded-lg border ${
                syncMode === 'local'
                  ? 'text-ok border-ok-edge bg-ok-soft'
                  : 'text-accent border-accent-edge bg-accent-soft'
              }`}>
                {syncMode === 'local' ? 'This Device Only' : 'Backed Up & Synced'}
              </span>
              <p className="text-[13px] text-lo">
                {syncMode === 'local'
                  ? 'Passwords stay on this device only.'
                  : 'Passwords stay on this device and are backed up for your other devices.'}
              </p>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-[16px] font-medium text-hi">Sync Settings</p>
              <p className="text-[13px] text-lo">
                {syncMode === 'local'
                  ? 'Enable backup and account setup from the guided sync modal.'
                  : (
                    <>
                      {syncStep === 'configure' && 'Sync is enabled but not configured. Open Sync Settings to connect your server and account.'}
                      {syncStep === 'auth' && 'Server is configured. Open Sync Settings to sign in or create your synced account.'}
                      {syncStep === 'finish-setup' && 'Account is signed in. Open Sync Settings to finish secure sync setup with your account password.'}
                      {syncStep === 'ready' && 'This device is fully synced and ready.'}
                    </>
                  )}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleOpenSyncWizard}
                  className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100"
                >
                  Open Sync Settings
                </button>
                {syncMode === 'synced' && (
                  <button
                    onClick={handleSyncNow}
                    disabled={syncNowBusy || !syncStatus?.configured || !syncStatus?.loggedIn}
                    className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncNowBusy ? 'animate-spin' : ''}`} />
                    {syncNowBusy ? 'Syncing...' : 'Sync Now'}
                  </button>
                )}
              </div>
            </div>

            {syncMode === 'synced' && (
              <div className="px-5 py-4 flex flex-col gap-3">
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
                </div>
                <p className="text-[13px] text-lo">Last successful sync: {formatSyncTime(syncStatus?.lastSyncAt)}</p>
                <p className="text-[13px] text-lo">Last sync attempt: {formatSyncTime(syncStatus?.lastSyncAttemptAt)}</p>
                {syncStatus?.lastSyncError && (
                  <p className="text-[13px] text-err">Last sync error: {syncStatus.lastSyncError}</p>
                )}
              </div>
            )}

            {syncMode === 'synced' && syncStatus?.loggedIn && (
              <div className="px-5 py-4 flex flex-col gap-3">
                <p className="text-[16px] font-medium text-hi">Authenticator (2FA)</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[12px] px-2 py-1 rounded-lg border ${
                    mfaStatus?.mfaEnabled
                      ? 'text-ok border-ok-edge bg-ok-soft'
                      : 'text-dim border-edge bg-input'
                  }`}>
                    {mfaStatus?.mfaEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                  {mfaStatus?.pendingEnrollment && (
                    <span className="text-[12px] px-2 py-1 rounded-lg border text-warn border-warn-edge bg-warn-soft">
                      Setup Pending
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-lo">
                  2FA is optional but strongly recommended for sync accounts.
                </p>

                {!mfaStatus?.mfaEnabled && !mfaSetup && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={handleMfaSetup}
                      disabled={mfaBusy}
                      className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {mfaBusy ? 'Preparing...' : 'Set up 2FA'}
                    </button>
                  </div>
                )}

                {mfaSetup && (
                  <div className="rounded-xl border border-edge bg-input p-3 space-y-3">
                    <p className="text-[13px] text-lo">
                      Scan this QR code in your authenticator app, then enter a 6-digit code to enable.
                    </p>
                    {mfaQrDataUrl ? (
                      <img
                        src={mfaQrDataUrl}
                        alt="Authenticator QR code"
                        className="w-40 h-40 rounded-lg border border-edge bg-white p-2"
                      />
                    ) : (
                      <p className="text-[12px] text-dim">Generating QR code...</p>
                    )}
                    <p className="text-[12px] text-dim break-all">Manual code: {mfaSetup.secret}</p>
                    <div className="flex gap-2 flex-wrap">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={mfaCode}
                        onChange={(event) => setMfaCode(event.target.value)}
                        placeholder="6-digit code"
                        className="bg-card border border-edge text-hi text-[14px] rounded-xl px-3.5 py-2.5 outline-none focus:border-accent-edge transition-colors"
                      />
                      <button
                        onClick={handleMfaEnable}
                        disabled={mfaBusy}
                        className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-accent border-accent-edge bg-accent-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {mfaBusy ? 'Enabling...' : 'Enable 2FA'}
                      </button>
                    </div>
                  </div>
                )}

                {mfaStatus?.mfaEnabled && (
                  <div className="rounded-xl border border-edge bg-input p-3 space-y-2">
                    <p className="text-[13px] text-lo">
                      To disable 2FA, enter a current authenticator code.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={mfaCode}
                        onChange={(event) => setMfaCode(event.target.value)}
                        placeholder="6-digit code"
                        className="bg-card border border-edge text-hi text-[14px] rounded-xl px-3.5 py-2.5 outline-none focus:border-accent-edge transition-colors"
                      />
                      <button
                        onClick={handleMfaDisable}
                        disabled={mfaBusy}
                        className="px-4 py-2.5 rounded-xl text-[15px] font-medium border text-err border-err-edge bg-err-soft hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {mfaBusy ? 'Disabling...' : 'Disable 2FA'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {syncFeedback && (
              <div className="px-5 py-4">
                <p className={`text-[13px] ${syncFeedback.type === 'ok' ? 'text-ok' : 'text-err'}`}>
                  {syncFeedback.message}
                </p>
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
