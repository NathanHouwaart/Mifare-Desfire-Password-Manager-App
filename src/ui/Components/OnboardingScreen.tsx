import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cloud,
  HardDrive,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RotateCcw,
  Server,
  Shield,
  Sparkles,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react';

type OnboardingMode = 'local' | 'synced';
type SyncedStep = 'configure' | 'account' | 'mfa' | 'vault' | 'done';
type AccountMode = 'choose' | 'register' | 'login';

interface OnboardingScreenProps {
  initialMode?: OnboardingMode | null;
  onCancel?: () => void;
  onComplete: (mode: OnboardingMode) => void;
  /** When true the component renders as a bare card (no full-screen wrapper). The parent supplies the backdrop. */
  asModal?: boolean;
}

function computeSyncedStep(
  syncStatus: SyncStatusDto | null,
  mfaStatus: SyncMfaStatusDto | null,
  vaultStatus: SyncVaultKeyStatusDto | null
): SyncedStep {
  if (!syncStatus?.configured) return 'configure';
  if (!syncStatus.loggedIn) return 'account';
  if (!mfaStatus?.mfaEnabled) return 'mfa';
  if (!vaultStatus?.hasRemoteEnvelope || !vaultStatus?.hasLocalUnlockedKey) return 'vault';
  return 'done';
}

function toFriendlySyncError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.toLowerCase();

  if (text.includes('username already exists') || text.includes('sync api 409')) {
    return 'That username already exists. Use Login instead of Register.';
  }
  if (text.includes('invalid credentials')) {
    return 'Login failed. Check username and password.';
  }
  if (text.includes('mfa code required') || text.includes('mfa_required')) {
    return 'This account uses 2FA. Enter your 6-digit authenticator code and press Login.';
  }
  if (text.includes('invalid mfa code') || text.includes('invalid_mfa_code')) {
    return 'The 6-digit authenticator code is incorrect or expired. Try the newest code.';
  }
  if (text.includes('failed to fetch') || text.includes('network')) {
    return 'Cannot reach the sync server. Check server URL and network.';
  }
  if (text.includes('sync url must use http or https')) {
    return 'Sync URL must start with http:// or https://';
  }
  if (text.includes('username must be at least 3 characters')) {
    return 'Username must be at least 3 characters.';
  }
  if (text.includes('sync api 400')) {
    return 'Some input is invalid. Check URL, username, password, and 6-digit code.';
  }
  if (text.includes('sync api 404: mfa endpoints not found on server')) {
    return 'Your sync server is missing the 2FA endpoints. Rebuild/restart sync-server, then try again.';
  }
  if (text.includes('sync api 404: not found')) {
    return 'Endpoint not found on server. Make sure sync-server is updated and restarted.';
  }
  if (text.includes('sync api 500')) {
    return 'Server error. Check if your sync server is running, then try again.';
  }
  if (text.includes('unable to authenticate data')) {
    return 'This account still uses an older vault-key setup. Recreate the server key envelope from your original device, then login again.';
  }
  if (text.includes("no handler registered for 'sync:preparevaultkey'")) {
    return 'App update mismatch detected. Restart SecurePass (or reinstall the latest build) and try again.';
  }

  return raw;
}

export const OnboardingScreen = ({ initialMode = null, onCancel, onComplete, asModal = false }: OnboardingScreenProps) => {
  const [mode, setMode] = useState<OnboardingMode | null>(initialMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);
  const [mfaStatus, setMfaStatus] = useState<SyncMfaStatusDto | null>(null);
  const [mfaSetup, setMfaSetup] = useState<SyncMfaSetupDto | null>(null);
  const [vaultStatus, setVaultStatus] = useState<SyncVaultKeyStatusDto | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultAutoAttempted, setVaultAutoAttempted] = useState(false);
  const [accountMode, setAccountMode] = useState<AccountMode>('choose');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const syncedStep = useMemo(
    () => computeSyncedStep(syncStatus, mfaStatus, vaultStatus),
    [syncStatus, mfaStatus, vaultStatus]
  );

  const refreshSyncStatus = async (): Promise<SyncStatusDto | null> => {
    try {
      const status = await window.electron['sync:getStatus']();
      setSyncStatus(status);
      setBaseUrl(status.baseUrl ?? '');
      setUsername(status.username ?? '');
      setDeviceName(status.deviceName ?? '');
      return status;
    } catch {
      setSyncStatus(null);
      return null;
    }
  };

  const refreshMfaStatus = async (loggedIn: boolean): Promise<SyncMfaStatusDto | null> => {
    if (!loggedIn) {
      setMfaStatus(null);
      return null;
    }
    try {
      const status = await window.electron['sync:mfaStatus']();
      setMfaStatus(status);
      return status;
    } catch {
      setMfaStatus(null);
      return null;
    }
  };

  const refreshVaultStatus = async (loggedIn: boolean): Promise<SyncVaultKeyStatusDto | null> => {
    if (!loggedIn) {
      setVaultStatus(null);
      return null;
    }
    try {
      const status = await window.electron['sync:getVaultKeyStatus']();
      setVaultStatus(status);
      return status;
    } catch {
      setVaultStatus(null);
      return null;
    }
  };

  const refreshAll = async () => {
    const s = await refreshSyncStatus();
    const loggedIn = s?.loggedIn ?? false;
    await refreshMfaStatus(loggedIn);
    await refreshVaultStatus(loggedIn);
  };

  useEffect(() => {
    if (mode !== 'synced') return;
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Generate QR code whenever mfaSetup changes
  useEffect(() => {
    const url = mfaSetup?.otpauthUrl;
    if (!url) { setQrDataUrl(null); return; }
    void QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(dataUrl => setQrDataUrl(dataUrl))
      .catch(() => setQrDataUrl(null));
  }, [mfaSetup]);

  // Reset account sub-step whenever the wizard re-enters the account step
  useEffect(() => {
    if (syncedStep === 'account') setAccountMode('choose');
  }, [syncedStep]);

  const handleUseLocal = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:clearConfig']();
      localStorage.setItem('setting-sync-mode', 'local');
      setMessage({ type: 'ok', text: 'Local mode enabled.' });
      onComplete('local');
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleBackToModeChoice = () => {
    setMode(null);
    setMessage(null);
    setMfaCode('');
    setAccountMode('choose');
  };

  const handleLogout = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:logout']();
      setPassword('');
      setMfaCode('');
      setMfaSetup(null);
      await refreshAll();
      setMessage({ type: 'ok', text: 'Logged out. You can now log in with another account.' });
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleResetSync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:clearConfig']();
      setBaseUrl('');
      setUsername('');
      setDeviceName('');
      setPassword('');
      setMfaCode('');
      setMfaSetup(null);
      setMfaStatus(null);
      setVaultStatus(null);
      setVaultPassword('');
      setMode(null);
      setMessage({ type: 'ok', text: 'Sync reset on this device. Choose Local or Synced to continue.' });
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!baseUrl.trim() || !username.trim()) {
      setMessage({ type: 'err', text: 'Server URL and username are required.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:setConfig']({
        baseUrl: baseUrl.trim(),
        username: username.trim(),
        deviceName: deviceName.trim() || undefined,
      });
      await refreshAll();
      setMessage({ type: 'ok', text: 'Server settings saved.' });
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async () => {
    if (!password.trim()) {
      setMessage({ type: 'err', text: 'Password is required.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:register']({ password });
      setVaultPassword(password);
      setPassword('');
      setMfaCode('');
      setMfaSetup(null);
      await refreshAll();
      setMessage({ type: 'ok', text: 'Account registered.' });
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async () => {
    if (!password.trim()) {
      setMessage({ type: 'err', text: 'Password is required.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:login']({
        password,
        mfaCode: mfaCode.trim() || undefined,
      });
      setVaultPassword(password);
      setPassword('');
      setMfaCode('');
      await refreshAll();
      setMessage({ type: 'ok', text: 'Logged in.' });
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleMfaSetup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const setup = await window.electron['sync:mfaSetup']();
      setMfaSetup(setup);
      await refreshMfaStatus(true);
      setMessage({ type: 'ok', text: 'MFA setup created. Add it in your authenticator app.' });
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleMfaEnable = async () => {
    if (!mfaCode.trim()) {
      setMessage({ type: 'err', text: 'Authenticator code is required.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:mfaEnable']({ code: mfaCode.trim() });
      setMfaSetup(null);
      setMfaCode('');
      await refreshMfaStatus(true);
      setMessage({ type: 'ok', text: 'MFA enabled.' });
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleVaultStep = async () => {
    if (!vaultPassword.trim()) {
      setMessage({ type: 'err', text: 'Account password is required.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      try {
        await window.electron['sync:prepareVaultKey']({ password: vaultPassword });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (raw.toLowerCase().includes("no handler registered for 'sync:preparevaultkey'")) {
          // Legacy IPC fallback for out-of-sync app binaries.
          if (!vaultStatus?.hasRemoteEnvelope) {
            await window.electron['sync:initVaultKey']({ passphrase: vaultPassword });
          } else {
            await window.electron['sync:unlockVaultKey']({ passphrase: vaultPassword });
          }
        } else {
          throw err;
        }
      }
      setMessage({
        type: 'ok',
        text: !vaultStatus?.hasRemoteEnvelope
          ? 'Shared vault key initialized from your account password.'
          : 'Vault key unlocked on this device.',
      });
      setVaultPassword('');
      await refreshVaultStatus(true);
      await refreshAll();
    } catch (e) {
      setMessage({ type: 'err', text: toFriendlySyncError(e) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (syncedStep !== 'vault') {
      setVaultAutoAttempted(false);
      return;
    }
    if (busy || vaultAutoAttempted) return;
    if (!vaultPassword.trim()) return;
    setVaultAutoAttempted(true);
    void handleVaultStep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedStep, vaultPassword, busy, vaultAutoAttempted]);

  const handleFinishSynced = () => {
    localStorage.setItem('setting-sync-mode', 'synced');
    onComplete('synced');
  };

  // â”€â”€ CSS helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const primaryButtonClass = `px-4 py-2.5 rounded-xl text-[15px] font-medium border
    text-accent border-accent-edge bg-accent-soft transition-all duration-100
    hover:opacity-90 active:scale-95
    disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100`;

  const inputClass = `w-full bg-input border border-edge text-hi text-[14px] rounded-xl px-3.5 py-2.5 outline-none focus:border-accent-edge transition-colors placeholder:text-dim`;
  const smallSecondaryClass = `h-8 px-2.5 rounded-xl border border-edge bg-input flex items-center justify-center gap-1.5 text-[12px] font-medium text-dim hover:text-mid hover:border-edge2 hover:opacity-90 transition-all duration-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`;
  const smallDangerClass = `h-8 px-2.5 rounded-xl border border-err-edge bg-err-soft flex items-center justify-center gap-1.5 text-[12px] font-medium text-err hover:opacity-90 transition-all duration-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`;

  const STEP_ORDER: SyncedStep[] = ['configure', 'account', 'mfa', 'vault', 'done'];
  const currentStepIdx = STEP_ORDER.indexOf(syncedStep);

  const outerCls = asModal
    ? 'relative w-full'
    : 'relative h-screen w-screen overflow-hidden bg-page flex items-center justify-center px-4';

  return (
    <div className={outerCls}>
      {/* Ambient glow — only visible in full-screen mode */}
      {!asModal && (
        <>
          <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
        </>
      )}

      <div className="relative w-full max-w-[480px] z-10 mx-auto">
        <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-indigo-500/25 via-violet-500/20 to-cyan-500/20 blur-[2px]" />
        <div className="relative rounded-3xl border border-edge bg-card/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl overflow-hidden">

          {/* â”€â”€ Top bar â”€â”€ */}
          <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-edge/50">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-accent-soft border border-accent-edge flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-accent" />
              </div>
              <span className="text-[11px] font-bold text-mid tracking-widest uppercase">SecurePass Setup</span>
            </div>
            <div className="flex items-center gap-1.5">
              {mode === 'synced' && syncStatus?.loggedIn && (
                <button onClick={handleLogout} disabled={busy} className={smallDangerClass} title="Log out of account">
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </button>
              )}
              {mode === 'synced' && (syncStatus?.configured || syncStatus?.loggedIn) && (
                <button onClick={handleResetSync} disabled={busy} className={smallDangerClass} title="Reset sync on this device">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              )}
              {onCancel && (
                <button onClick={onCancel} className={smallSecondaryClass}>
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* â”€â”€ Progress bar (synced only) â”€â”€ */}
          {mode === 'synced' && (
            <>
              <div className="px-5 pt-3 pb-1 flex items-center gap-1">
                {STEP_ORDER.map((s, i) => (
                  <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                    i < currentStepIdx ? 'bg-ok' : i === currentStepIdx ? 'bg-accent' : 'bg-edge'
                  }`} />
                ))}
              </div>
              <div className="px-5 flex items-center justify-between">
                <span className="text-[10px] text-dim uppercase tracking-widest">Step {currentStepIdx + 1} / {STEP_ORDER.length}</span>
                <span className="text-[10px] text-dim uppercase tracking-widest">
                  {syncedStep === 'configure' && 'Server'}
                  {syncedStep === 'account' && 'Account'}
                  {syncedStep === 'mfa' && 'Two-Factor Auth'}
                  {syncedStep === 'vault' && 'Vault Key'}
                  {syncedStep === 'done' && 'Complete'}
                </span>
              </div>
            </>
          )}

          {/* â”€â”€ Animated content â€” key changes trigger fadeSlideUp â”€â”€ */}
          <div
            key={`${mode ?? 'start'}-${syncedStep}-${accountMode}`}
            className="px-5 pt-5 pb-6 [animation:fadeSlideUp_0.22s_ease_both]"
          >

            {/* â•â• CHOICE: Local vs Synced â•â• */}
            {!mode && (
              <div>
                <div className="text-center mb-6">
                  <div className="inline-flex h-14 w-14 rounded-2xl bg-accent-soft border border-accent-edge items-center justify-center mb-3 shadow-[0_0_28px_rgba(99,102,241,0.3)]">
                    <Sparkles className="w-7 h-7 text-accent" />
                  </div>
                  <h1 className="text-[22px] font-semibold text-hi">Welcome to SecurePass</h1>
                  <p className="mt-1.5 text-[13px] text-lo">How would you like to use your passwords?</p>
                </div>

                <div className="flex flex-col gap-3">
                  <button onClick={handleUseLocal} disabled={busy}
                    className="group rounded-2xl border border-edge bg-input p-5 text-left hover:border-accent-edge hover:bg-accent-soft hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(99,102,241,0.18)] transition-all duration-200 disabled:opacity-50">
                    <div className="flex items-start gap-4">
                      <div className="h-11 w-11 rounded-xl bg-card border border-edge flex items-center justify-center flex-shrink-0 group-hover:border-accent-edge group-hover:bg-accent-soft transition-all">
                        <HardDrive className="w-5 h-5 text-mid group-hover:text-accent transition-colors" />
                      </div>
                      <div>
                        <p className="text-[16px] font-semibold text-hi">Keep it on this device</p>
                        <p className="mt-1 text-[13px] text-lo">No account or internet needed. Passwords stay on this computer only.</p>
                      </div>
                    </div>
                  </button>

                  <button onClick={() => setMode('synced')} disabled={busy}
                    className="group rounded-2xl border border-edge bg-input p-5 text-left hover:border-accent-edge hover:bg-accent-soft hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(99,102,241,0.18)] transition-all duration-200 disabled:opacity-50">
                    <div className="flex items-start gap-4">
                      <div className="h-11 w-11 rounded-xl bg-card border border-edge flex items-center justify-center flex-shrink-0 group-hover:border-accent-edge group-hover:bg-accent-soft transition-all">
                        <Cloud className="w-5 h-5 text-mid group-hover:text-accent transition-colors" />
                      </div>
                      <div>
                        <p className="text-[16px] font-semibold text-hi">Sync across devices</p>
                        <p className="mt-1 text-[13px] text-lo">Use your passwords on multiple computers. Requires a sync server and a free account.</p>
                      </div>
                    </div>
                  </button>
                </div>

                {message && (
                  <p className={`mt-4 text-[13px] ${message.type === 'ok' ? 'text-ok' : 'text-err'}`}>{message.text}</p>
                )}
              </div>
            )}

            {/* â•â• SYNCED STEPS â•â• */}
            {mode === 'synced' && (
              <div className="flex flex-col gap-4">

                {/* Back navigation */}
                <button
                  onClick={syncedStep === 'account' && accountMode !== 'choose'
                    ? () => { setAccountMode('choose'); setMessage(null); }
                    : handleBackToModeChoice}
                  disabled={busy}
                  className="self-start -mt-1 mb-1 px-3 py-2 rounded-lg text-[13px] font-medium border text-lo border-edge bg-input hover:opacity-90 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {syncedStep === 'account' && accountMode !== 'choose' ? 'Back' : 'Back to start'}
                </button>

                {/* â”€â”€ Step 1: Server â”€â”€ */}
                {syncedStep === 'configure' && (
                  <div>
                    <div className="flex items-start gap-4 mb-5">
                      <div className="h-12 w-12 flex-shrink-0 rounded-2xl bg-accent-soft border border-accent-edge flex items-center justify-center shadow-[0_0_22px_rgba(99,102,241,0.25)]">
                        <Server className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <h2 className="text-[18px] font-semibold text-hi">Connect to your server</h2>
                        <p className="mt-1 text-[13px] text-lo">Enter the server address and pick a username.</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="text-[11px] text-dim uppercase tracking-wide mb-1.5 block">Server Address</label>
                        <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                          placeholder="e.g. http://192.168.1.10:8787" className={inputClass} />
                        <p className="mt-1 text-[11px] text-dim">Ask whoever manages the server what address to enter here.</p>
                      </div>
                      <div>
                        <label className="text-[11px] text-dim uppercase tracking-wide mb-1.5 block">Username</label>
                        <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                          placeholder="e.g. dad" className={inputClass} />
                        <p className="mt-1 text-[11px] text-dim">Use the same username on every device.</p>
                      </div>
                      <div>
                        <label className="text-[11px] text-dim uppercase tracking-wide mb-1.5 block">
                          Device Name <span className="normal-case opacity-60">(optional)</span>
                        </label>
                        <input type="text" value={deviceName} onChange={e => setDeviceName(e.target.value)}
                          placeholder="e.g. living-room-pc" className={inputClass} />
                      </div>
                      <button onClick={handleSaveConfig} disabled={busy}
                        className={`${primaryButtonClass} flex items-center justify-center gap-2 w-full mt-1`}>
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        Continue <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* â”€â”€ Step 2a: Account â€” choose â”€â”€ */}
                {syncedStep === 'account' && accountMode === 'choose' && (
                  <div>
                    <div className="flex items-start gap-4 mb-5">
                      <div className="h-12 w-12 flex-shrink-0 rounded-2xl bg-accent-soft border border-accent-edge flex items-center justify-center shadow-[0_0_22px_rgba(99,102,241,0.25)]">
                        <UserRound className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <h2 className="text-[18px] font-semibold text-hi">Your account</h2>
                        <p className="mt-1 text-[13px] text-lo">
                          Server: <span className="text-mid">{baseUrl || 'â€”'}</span> &nbsp;Â·&nbsp; User: <span className="text-mid">{username || 'â€”'}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <button onClick={() => { setAccountMode('register'); setMessage(null); }} disabled={busy}
                        className="group rounded-2xl border border-edge bg-input p-4 text-left hover:border-accent-edge hover:bg-accent-soft hover:-translate-y-0.5 hover:shadow-[0_0_22px_rgba(99,102,241,0.18)] transition-all duration-200 disabled:opacity-50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-card border border-edge flex items-center justify-center flex-shrink-0 group-hover:border-accent-edge group-hover:bg-accent-soft transition-all">
                            <UserPlus className="w-5 h-5 text-mid group-hover:text-accent transition-colors" />
                          </div>
                          <div>
                            <p className="text-[15px] font-semibold text-hi">First time on this server</p>
                            <p className="text-[12px] text-lo mt-0.5">Create a new account with this username</p>
                          </div>
                        </div>
                      </button>

                      <button onClick={() => { setAccountMode('login'); setMessage(null); }} disabled={busy}
                        className="group rounded-2xl border border-edge bg-input p-4 text-left hover:border-accent-edge hover:bg-accent-soft hover:-translate-y-0.5 hover:shadow-[0_0_22px_rgba(99,102,241,0.18)] transition-all duration-200 disabled:opacity-50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-card border border-edge flex items-center justify-center flex-shrink-0 group-hover:border-accent-edge group-hover:bg-accent-soft transition-all">
                            <LogIn className="w-5 h-5 text-mid group-hover:text-accent transition-colors" />
                          </div>
                          <div>
                            <p className="text-[15px] font-semibold text-hi">I already have an account</p>
                            <p className="text-[12px] text-lo mt-0.5">Sign in with my existing password</p>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                {/* â”€â”€ Step 2b: Account â€” register â”€â”€ */}
                {syncedStep === 'account' && accountMode === 'register' && (
                  <div>
                    <div className="flex items-start gap-4 mb-5">
                      <div className="h-12 w-12 flex-shrink-0 rounded-2xl bg-accent-soft border border-accent-edge flex items-center justify-center shadow-[0_0_22px_rgba(99,102,241,0.25)]">
                        <UserPlus className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <h2 className="text-[18px] font-semibold text-hi">Create your account</h2>
                        <p className="mt-1 text-[13px] text-lo">Username: <span className="text-mid">{username}</span></p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="text-[11px] text-dim uppercase tracking-wide mb-1.5 block">Choose a password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                          placeholder="Password for your sync account" className={inputClass} />
                        <p className="mt-1 text-[11px] text-dim">This same password is also used to unlock your synced vault key.</p>
                      </div>
                      <button onClick={handleRegister} disabled={busy}
                        className={`${primaryButtonClass} flex items-center justify-center gap-2 w-full mt-1`}>
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        Create Account <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* â”€â”€ Step 2c: Account â€” login â”€â”€ */}
                {syncedStep === 'account' && accountMode === 'login' && (
                  <div>
                    <div className="flex items-start gap-4 mb-5">
                      <div className="h-12 w-12 flex-shrink-0 rounded-2xl bg-accent-soft border border-accent-edge flex items-center justify-center shadow-[0_0_22px_rgba(99,102,241,0.25)]">
                        <LogIn className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <h2 className="text-[18px] font-semibold text-hi">Sign in</h2>
                        <p className="mt-1 text-[13px] text-lo">Account: <span className="text-mid">{username}</span></p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="text-[11px] text-dim uppercase tracking-wide mb-1.5 block">Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                          placeholder="Your sync account password" className={inputClass} />
                      </div>
                      <div>
                        <label className="text-[11px] text-dim uppercase tracking-wide mb-1.5 block">
                          Authenticator Code <span className="normal-case opacity-60">(only if 2FA is already on)</span>
                        </label>
                        <input type="text" inputMode="numeric" value={mfaCode} onChange={e => setMfaCode(e.target.value)}
                          placeholder="6-digit code from your app" className={inputClass} maxLength={6} />
                      </div>
                      <button onClick={handleLogin} disabled={busy}
                        className={`${primaryButtonClass} flex items-center justify-center gap-2 w-full mt-1`}>
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        Sign In <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* â”€â”€ Step 3: Two-Factor Auth â”€â”€ */}
                {syncedStep === 'mfa' && (
                  <div>
                    <div className="flex items-start gap-4 mb-5">
                      <div className="h-12 w-12 flex-shrink-0 rounded-2xl bg-accent-soft border border-accent-edge flex items-center justify-center shadow-[0_0_22px_rgba(99,102,241,0.25)]">
                        <Shield className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <h2 className="text-[18px] font-semibold text-hi">Two-factor authentication</h2>
                        <p className="mt-1 text-[13px] text-lo">Adds an extra lock so only you can sign in.</p>
                      </div>
                    </div>

                    {!mfaSetup ? (
                      <div className="flex flex-col gap-3">
                        <div className="rounded-xl border border-edge bg-input p-4 text-[13px] text-lo">
                          <p className="mb-2">You'll need a free authenticator app on your phone:</p>
                          <ul className="list-disc list-inside space-y-0.5 text-mid">
                            <li>Google Authenticator</li>
                            <li>Microsoft Authenticator</li>
                            <li>2FAS Authenticator</li>
                            <li>Authy</li>
                          </ul>
                          <p className="mt-2">Install one, then press the button below.</p>
                        </div>
                        <button onClick={handleMfaSetup} disabled={busy}
                          className={`${primaryButtonClass} flex items-center justify-center gap-2 w-full`}>
                          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                          <Shield className="w-4 h-4" />
                          Get My QR Code
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <p className="text-[13px] text-lo">Open your authenticator app and scan this QR code:</p>

                        {qrDataUrl ? (
                          <div className="flex justify-center">
                            <div className="p-3 bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                              <img src={qrDataUrl} alt="2FA QR Code" className="w-44 h-44" />
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-center items-center h-44 rounded-2xl border border-edge bg-input">
                            <Loader2 className="w-6 h-6 animate-spin text-dim" />
                          </div>
                        )}

                        <details>
                          <summary className="text-[11px] text-dim cursor-pointer select-none hover:text-mid transition-colors">
                            Can't scan? Show the manual entry code
                          </summary>
                          <div className="mt-2 p-3 rounded-xl border border-edge bg-input space-y-1">
                            <p className="text-[11px] text-lo">Issuer: <span className="text-hi">{mfaSetup.issuer}</span></p>
                            <p className="text-[11px] text-lo">Account: <span className="text-hi">{mfaSetup.accountName}</span></p>
                            <p className="text-[11px] text-lo break-all">Secret: <span className="text-hi font-mono">{mfaSetup.secret}</span></p>
                          </div>
                        </details>

                        <div>
                          <label className="text-[11px] text-dim uppercase tracking-wide mb-1.5 block">
                            Enter the 6-digit code shown in your app
                          </label>
                          <input type="text" inputMode="numeric" value={mfaCode} onChange={e => setMfaCode(e.target.value)}
                            placeholder="123456" className={inputClass} maxLength={6} />
                        </div>

                        <button onClick={handleMfaEnable} disabled={busy}
                          className={`${primaryButtonClass} flex items-center justify-center gap-2 w-full`}>
                          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                          Activate 2FA <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* â”€â”€ Step 4: Vault Key â”€â”€ */}
                {syncedStep === 'vault' && (
                  <div>
                    <div className="flex items-start gap-4 mb-5">
                      <div className="h-12 w-12 flex-shrink-0 rounded-2xl bg-accent-soft border border-accent-edge flex items-center justify-center shadow-[0_0_22px_rgba(99,102,241,0.25)]">
                        <KeyRound className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <h2 className="text-[18px] font-semibold text-hi">
                          {!vaultStatus?.hasRemoteEnvelope ? 'Finalize vault key setup' : 'Unlock this device vault key'}
                        </h2>
                        <p className="mt-1 text-[13px] text-lo">
                          {!vaultStatus?.hasRemoteEnvelope
                            ? 'We use your account password to initialize your shared vault key.'
                            : 'Usually this is automatic after login. If shown, enter your account password once.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      {!vaultStatus?.hasRemoteEnvelope && (
                        <div className="rounded-xl border border-warn-edge bg-warn-soft p-3 text-[12px] text-warn">
                          Use your sync account password here. There is no separate vault passphrase anymore.
                        </div>
                      )}
                      <div>
                        <label className="text-[11px] text-dim uppercase tracking-wide mb-1.5 block">Account Password</label>
                        <input type="password" value={vaultPassword} onChange={e => { setVaultPassword(e.target.value); setVaultAutoAttempted(false); }}
                          placeholder="Your sync account password" className={inputClass} />
                      </div>
                      <button onClick={handleVaultStep} disabled={busy}
                        className={`${primaryButtonClass} flex items-center justify-center gap-2 w-full mt-1`}>
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        <KeyRound className="w-4 h-4" />
                        {!vaultStatus?.hasRemoteEnvelope ? 'Create Vault Key' : 'Unlock Vault Key'}
                      </button>
                    </div>
                  </div>
                )}

                {/* â”€â”€ Step 5: Done â”€â”€ */}
                {syncedStep === 'done' && (
                  <div className="text-center py-2">
                    <div className="inline-flex h-16 w-16 rounded-2xl bg-ok-soft border border-ok-edge items-center justify-center mb-4 shadow-[0_0_28px_rgba(34,197,94,0.3)]">
                      <CheckCircle2 className="w-8 h-8 text-ok" />
                    </div>
                    <h2 className="text-[20px] font-semibold text-hi">You're all set!</h2>
                    <p className="mt-2 text-[13px] text-lo max-w-[300px] mx-auto">
                      Sync is now active. On your next device, choose <span className="text-mid font-medium">I already have an account</span> and sign in with the same username.
                    </p>
                    <button onClick={handleFinishSynced}
                      className={`${primaryButtonClass} flex items-center justify-center gap-2 mx-auto mt-5`}>
                      <CheckCircle2 className="w-4 h-4" />
                      Start Using SecurePass
                    </button>
                  </div>
                )}

                {message && (
                  <p className={`text-[13px] ${message.type === 'ok' ? 'text-ok' : 'text-err'}`}>
                    {message.text}
                  </p>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};
