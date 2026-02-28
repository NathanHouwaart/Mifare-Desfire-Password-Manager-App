import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cloud,
  CloudOff,
  Laptop,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Shield,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react';
import Button from './UI/Button';

type SetupRoute = 'invite' | 'manual';
type SetupStep = 'entry' | 'server' | 'username' | 'auth' | 'device' | 'done';
type AccountMode = 'register' | 'login';
type AsyncCheckState = 'idle' | 'running' | 'success' | 'error';

type DeviceSummary = {
  key: string;
  name: string;
  lastSeenAt: string;
  active: boolean;
  isCurrent: boolean;
  sessions: number;
};

interface SyncSetupFlowProps {
  initialSyncConfig?: SyncInvitePayloadDto | null;
  onBack: () => void;
  onCancel?: () => void;
  onComplete: () => void;
  asModal?: boolean;
}

function normalizeServerUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const trimmedPath = parsed.pathname.endsWith('/') && parsed.pathname !== '/'
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    parsed.pathname = trimmedPath;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function parseInviteInput(raw: string): SyncInvitePayloadDto | null {
  const text = raw.trim();
  if (text.length === 0) return null;

  const directServer = normalizeServerUrl(text);
  if (directServer) return { baseUrl: directServer };

  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'securepass:') return null;

    const server =
      parsed.searchParams.get('server') ??
      parsed.searchParams.get('baseUrl') ??
      parsed.searchParams.get('url');

    if (!server) return null;
    const baseUrl = normalizeServerUrl(server);
    if (!baseUrl) return null;

    const username = parsed.searchParams.get('username')?.trim();
    return {
      baseUrl,
      username: username && username.length > 0 ? username : undefined,
    };
  } catch {
    return null;
  }
}

function toFriendlySyncError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.toLowerCase();

  if (text.includes('username already exists') || text.includes('sync api 409')) {
    return 'That username already exists. Use Sign in instead.';
  }
  if (text.includes('invalid credentials')) return 'Sign in failed. Check username and password.';
  if (text.includes('mfa code required') || text.includes('mfa_required')) {
    return 'This account uses authenticator codes. Enter the 6-digit code and try again.';
  }
  if (text.includes('invalid mfa code') || text.includes('invalid_mfa_code')) {
    return 'Authenticator code is incorrect or expired.';
  }
  if (text.includes('failed to fetch') || text.includes('network')) {
    return 'Cannot reach the sync server. Check network and server address.';
  }
  if (text.includes('/v1/auth/status not found') || text.includes('sync api 404')) {
    return 'Server is missing required sync endpoints. Update/restart sync-server.';
  }
  return raw;
}

function getStepLabel(step: SetupStep): string {
  switch (step) {
    case 'entry':
      return 'Method';
    case 'server':
      return 'Server';
    case 'username':
      return 'Username';
    case 'auth':
      return 'Account';
    case 'device':
      return 'Device';
    case 'done':
      return 'Complete';
    default:
      return 'Setup';
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SyncSetupFlow({
  initialSyncConfig = null,
  onBack,
  onCancel,
  onComplete,
  asModal = false,
}: SyncSetupFlowProps) {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const [devicesBusy, setDevicesBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [route, setRoute] = useState<SetupRoute>(initialSyncConfig?.baseUrl ? 'invite' : 'manual');
  const [step, setStep] = useState<SetupStep>('entry');

  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);
  const [mfaStatus, setMfaStatus] = useState<SyncMfaStatusDto | null>(null);
  const [mfaSetup, setMfaSetup] = useState<SyncMfaSetupDto | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<SyncDeviceDto[]>([]);

  const [inviteInput, setInviteInput] = useState(
    initialSyncConfig?.baseUrl ? `securepass://invite?server=${encodeURIComponent(initialSyncConfig.baseUrl)}` : ''
  );
  const [serverInput, setServerInput] = useState(initialSyncConfig?.baseUrl ?? '');
  const [serverValidation, setServerValidation] = useState<SyncServerValidationDto | null>(null);
  const [username, setUsername] = useState(initialSyncConfig?.username ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [accountMode, setAccountMode] = useState<AccountMode>('login');
  const [usernameExistsOnServer, setUsernameExistsOnServer] = useState<boolean | null>(null);
  const [serverCheckState, setServerCheckState] = useState<AsyncCheckState>('idle');
  const [accountCheckState, setAccountCheckState] = useState<AsyncCheckState>('idle');
  const [deviceName, setDeviceName] = useState('');
  const [openedWhileLoggedIn, setOpenedWhileLoggedIn] = useState(false);

  const stepOrder = useMemo<SetupStep[]>(() => {
    const order: SetupStep[] = ['entry'];
    if (route === 'manual') order.push('server');
    order.push('username', 'auth', 'device');
    return order;
  }, [route]);

  const deviceSummaries = useMemo<DeviceSummary[]>(() => {
    const groups = new Map<string, DeviceSummary>();

    for (const device of devices) {
      const key = device.name.trim().toLowerCase();
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          key,
          name: device.name,
          lastSeenAt: device.lastSeenAt,
          active: device.active,
          isCurrent: device.isCurrent,
          sessions: 1,
        });
        continue;
      }

      const existingSeen = new Date(existing.lastSeenAt).getTime();
      const currentSeen = new Date(device.lastSeenAt).getTime();
      if (Number.isFinite(currentSeen) && currentSeen > existingSeen) {
        existing.lastSeenAt = device.lastSeenAt;
        existing.name = device.name;
      }

      existing.active = existing.active || device.active;
      existing.isCurrent = existing.isCurrent || device.isCurrent;
      existing.sessions += 1;
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      if (a.active !== b.active) return a.active ? -1 : 1;
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
  }, [devices]);

  const stepIdx = step === 'done'
    ? stepOrder.length - 1
    : Math.max(0, stepOrder.indexOf(step));

  const navRowClass = 'flex flex-col sm:flex-row gap-2';
  const navButtonClass = 'w-full min-w-0';
  const inputClass = `w-full bg-input border border-edge text-hi text-[14px] rounded-xl px-3.5 py-2.5 outline-none focus:border-accent-edge transition-colors placeholder:text-dim`;

  const refreshStatus = async (): Promise<SyncStatusDto | null> => {
    try {
      const status = await window.electron['sync:getStatus']();
      setSyncStatus(status);
      setServerInput((current) => status.baseUrl || current || initialSyncConfig?.baseUrl || '');
      setUsername((current) => status.username || current || initialSyncConfig?.username || '');
      setDeviceName((current) => status.deviceName || current);
      return status;
    } catch {
      setSyncStatus(null);
      return null;
    }
  };

  const refreshMfa = async (loggedIn: boolean) => {
    if (!loggedIn) {
      setMfaStatus(null);
      return;
    }
    try {
      const status = await window.electron['sync:mfaStatus']();
      setMfaStatus(status);
    } catch {
      setMfaStatus(null);
    }
  };

  const refreshDevices = async (loggedIn: boolean) => {
    if (!loggedIn) {
      setDevices([]);
      return;
    }
    setDevicesBusy(true);
    try {
      const list = await window.electron['sync:getDevices']();
      setDevices(list);
    } catch {
      setDevices([]);
    } finally {
      setDevicesBusy(false);
    }
  };

  const refreshAll = async () => {
    const status = await refreshStatus();
    const loggedIn = Boolean(status?.loggedIn);
    await refreshMfa(loggedIn);
    await refreshDevices(loggedIn);
    return status;
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = await refreshAll();
        if (cancelled) return;

        if (status?.loggedIn) {
          setOpenedWhileLoggedIn(true);
          setStep('done');
          return;
        }

        if (status?.configured) {
          setStep('auth');
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const url = mfaSetup?.otpauthUrl;
    if (!url) {
      setQrDataUrl(null);
      return;
    }

    void QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((dataUrl) => setQrDataUrl(dataUrl))
      .catch(() => setQrDataUrl(null));
  }, [mfaSetup]);

  useEffect(() => {
    let cancelled = false;

    const resolveAuthMode = async () => {
      if (step !== 'auth') return;
      if (!syncStatus?.configured || syncStatus.loggedIn) return;

      try {
        const lookup = await window.electron['sync:checkUsername']();
        if (cancelled) return;
        setUsernameExistsOnServer(lookup.exists);
        setAccountMode(lookup.exists ? 'login' : 'register');
      } catch {
        if (cancelled) return;
        setUsernameExistsOnServer(null);
      }
    };

    void resolveAuthMode();
    return () => {
      cancelled = true;
    };
  }, [step, syncStatus]);

  const handleValidateServer = async (baseUrl: string) => {
    const validation = await window.electron['sync:validateServer']({ baseUrl });
    setServerValidation(validation);
    setServerInput(validation.baseUrl);
    return validation;
  };

  const handleEntryContinue = async () => {
    setMessage(null);
    setServerCheckState('idle');

    if (route === 'manual') {
      setStep('server');
      return;
    }

    const invite = parseInviteInput(inviteInput) ?? (initialSyncConfig?.baseUrl ? initialSyncConfig : null);
    if (!invite) {
      setMessage({ type: 'err', text: 'Paste a valid invite link or server address.' });
      return;
    }

    setBusy(true);
    try {
      setServerCheckState('running');
      await wait(550);
      await handleValidateServer(invite.baseUrl);
      if (invite.username) setUsername(invite.username);
      setServerCheckState('success');
      await wait(700);
      setStep('username');
      setMessage({ type: 'ok', text: 'Invite accepted. Server verified.' });
    } catch (error) {
      setServerCheckState('error');
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleManualServerContinue = async () => {
    if (!serverInput.trim()) {
      setMessage({ type: 'err', text: 'Server address is required.' });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      setServerCheckState('running');
      await wait(550);
      const result = await handleValidateServer(serverInput.trim());
      setServerCheckState('success');
      await wait(700);
      setStep('username');
      setMessage({
        type: 'ok',
        text: 'Server Verified. Sign in with existing username or create a new one.'
      });
    } catch (error) {
      setServerCheckState('error');
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleUsernameContinue = async () => {
    const resolvedBaseUrl = serverValidation?.baseUrl ?? serverInput;
    const trimmedUsername = username.trim();

    if (!resolvedBaseUrl) {
      setMessage({ type: 'err', text: 'Validate the server first.' });
      return;
    }
    if (trimmedUsername.length < 3) {
      setMessage({ type: 'err', text: 'Username must be at least 3 characters.' });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:setConfig']({
        baseUrl: resolvedBaseUrl,
        username: trimmedUsername,
        deviceName: deviceName.trim() || undefined,
      });

      setAccountCheckState('running');
      await wait(550);
      const lookup = await window.electron['sync:checkUsername']();
      setUsernameExistsOnServer(lookup.exists);
      setAccountMode(lookup.exists ? 'login' : 'register');
      setPassword('');
      setConfirmPassword('');
      setMfaCode('');
      setMfaSetup(null);
      setAccountCheckState('success');
      await wait(700);
      setStep('auth');
      setMessage({
        type: 'ok',
        text: lookup.exists
          ? 'Username exists. Continue with Sign in.'
          : 'Username is new. Continue with Create account.',
      });

      await refreshStatus();
    } catch (error) {
      setAccountCheckState('error');
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleAuthenticate = async () => {
    if (!password.trim()) {
      setMessage({ type: 'err', text: 'Password is required.' });
      return;
    }
    if (accountMode === 'register' && password !== confirmPassword) {
      setMessage({ type: 'err', text: 'Passwords do not match.' });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      if (accountMode === 'register') {
        await window.electron['sync:register']({ password });
        setMessage({ type: 'ok', text: 'Account created. Next: set up 2FA (highly recommended).' });
      } else {
        await window.electron['sync:login']({ password, mfaCode: mfaCode.trim() || undefined });
        setMessage({ type: 'ok', text: 'Signed in successfully.' });
      }

      setPassword('');
      setConfirmPassword('');
      setMfaCode('');
      setOpenedWhileLoggedIn(false);
      setMfaSetup(null);
      await refreshAll();
      setStep('device');
      window.dispatchEvent(new Event('securepass:vault-sync-applied'));
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSetupMfa = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const setup = await window.electron['sync:mfaSetup']();
      setMfaSetup(setup);
      setMessage({ type: 'ok', text: 'Authenticator setup is ready.' });
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleEnableMfa = async () => {
    if (!mfaCode.trim()) {
      setMessage({ type: 'err', text: 'Authenticator code is required.' });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:mfaEnable']({ code: mfaCode.trim() });
      setMfaCode('');
      setMfaSetup(null);
      await refreshMfa(true);
      setMessage({ type: 'ok', text: 'Authenticator enabled.' });
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleDeviceContinue = async () => {
    if (!syncStatus?.loggedIn) {
      setMessage({ type: 'err', text: 'Sign in first.' });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const trimmedDeviceName = deviceName.trim();
      if (trimmedDeviceName) {
        await window.electron['sync:updateCurrentDeviceName']({ name: trimmedDeviceName });
      }

      const resolvedBaseUrl = serverValidation?.baseUrl ?? syncStatus.baseUrl;
      const resolvedUsername = username.trim() || syncStatus.username;
      if (!resolvedBaseUrl || !resolvedUsername) {
        throw new Error('Missing sync configuration');
      }

      await window.electron['sync:setConfig']({
        baseUrl: resolvedBaseUrl,
        username: resolvedUsername,
        deviceName: trimmedDeviceName || undefined,
      });

      await refreshAll();
      setStep('done');
      setMessage({ type: 'ok', text: 'Device details saved.' });
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncNowBusy(true);
    setMessage(null);
    try {
      const result = await window.electron['sync:syncNow']();
      await refreshAll();
      setMessage({
        type: 'ok',
        text: `Sync complete. Push ${result.push.applied}/${result.push.sent}, pull ${result.pull.applied}/${result.pull.received}.`,
      });
      window.dispatchEvent(new Event('securepass:vault-sync-applied'));
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setSyncNowBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:logout']();
      await refreshAll();
      setOpenedWhileLoggedIn(false);
      setPassword('');
      setConfirmPassword('');
      setMfaCode('');
      setMfaSetup(null);
      setUsernameExistsOnServer(null);
      setStep('auth');
      window.dispatchEvent(new Event('securepass:vault-sync-applied'));
      setMessage({ type: 'ok', text: 'Signed out on this device.' });
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchAccount = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:switchUser']();
      setRoute(initialSyncConfig?.baseUrl ? 'invite' : 'manual');
      setStep('entry');
      setOpenedWhileLoggedIn(false);
      setPassword('');
      setConfirmPassword('');
      setMfaCode('');
      setMfaSetup(null);
      setUsernameExistsOnServer(null);
      setDevices([]);
      await refreshStatus();
      window.dispatchEvent(new Event('securepass:vault-sync-applied'));
      setMessage({ type: 'ok', text: 'Ready for a different account.' });
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleStopSyncing = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:clearConfig']();
      localStorage.setItem('setting-sync-mode', 'local');
      window.dispatchEvent(new CustomEvent('securepass:sync-mode-changed', { detail: { mode: 'local' } }));
      setMessage({ type: 'ok', text: 'Sync disabled on this device.' });
      onBack();
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const showProgressTracker = !bootstrapping && !openedWhileLoggedIn && step !== 'done';
  const showServerCheckOverlay =
    (step === 'entry' || step === 'server') &&
    (serverCheckState === 'running' || serverCheckState === 'success');
  const showAccountCheckOverlay =
    step === 'username' &&
    (accountCheckState === 'running' || accountCheckState === 'success');

  return (
    <div className={asModal ? 'relative w-full' : 'relative h-screen w-screen overflow-hidden bg-page flex items-center justify-center px-4'}>
      {!asModal && (
        <>
          <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
        </>
      )}

      <div className="relative w-full max-w-[520px] z-10 mx-auto">
        <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-indigo-500/25 via-violet-500/20 to-cyan-500/20 blur-[2px]" />
        <div className="relative rounded-3xl border border-edge bg-card/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-edge/50">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-accent-soft border border-accent-edge flex items-center justify-center">
                <Cloud className="w-4 h-4 text-accent" />
              </div>
              <span className="text-[11px] font-bold text-mid tracking-widest uppercase">Sync Setup</span>
            </div>
            <div className="flex items-center gap-2">
              {!openedWhileLoggedIn && (
                <Button
                  variant="icon"
                  onClick={onBack}
                  aria-label="Go back"
                  title="Go back"
                  className="!border-edge text-dim hover:text-mid hover:!border-edge2"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              )}
              {onCancel && (
                <Button
                  variant="icon"
                  onClick={onCancel}
                  aria-label="Close sync setup"
                  title="Close sync setup"
                  className="!border-edge text-dim hover:text-mid hover:!border-edge2"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {showProgressTracker && (
            <>
              <div className="px-5 pt-3 pb-1 flex items-center gap-1">
                {stepOrder.map((setupStep, i) => (
                  <div key={setupStep} className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                    i < stepIdx ? 'bg-ok' : i === stepIdx ? 'bg-accent' : 'bg-edge'
                  }`} />
                ))}
              </div>
              <div className="px-5 flex items-center justify-between">
                <span className="text-[10px] text-dim uppercase tracking-widest">Step {stepIdx + 1} / {stepOrder.length}</span>
                <span className="text-[10px] text-dim uppercase tracking-widest">{getStepLabel(step)}</span>
              </div>
            </>
          )}

          {bootstrapping ? (
            <div className="px-5 pt-6 pb-6 [animation:wizardSlideHorizontal_0.28s_cubic-bezier(0.22,1,0.36,1)_both]">
              <div className="rounded-2xl border border-edge bg-input p-4 flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-accent [animation:spin_1.8s_linear_infinite]" />
                <div>
                  <p className="text-[14px] font-medium text-hi">Loading sync status</p>
                  <p className="text-[12px] text-lo">Checking this device before showing setup steps.</p>
                </div>
              </div>
            </div>
          ) : (
          <div key={`${step}-${route}-${accountMode}`} className="relative px-5 pt-5 pb-6 [animation:wizardSlideHorizontal_0.28s_cubic-bezier(0.22,1,0.36,1)_both]">
            {(showServerCheckOverlay || showAccountCheckOverlay) && (
              <div className="sync-check-indicator">
                <div className="sync-check-pill">
                  {(showServerCheckOverlay ? serverCheckState : accountCheckState) === 'running' ? (
                    <Loader2 className="w-4 h-4 text-accent sync-check-pulse" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-ok sync-check-flash" />
                  )}
                  <span className="text-[12px] font-medium text-hi">
                    {showServerCheckOverlay ? 'Checking server reachability...' : 'Checking account status...'}
                  </span>
                </div>
                <div className="sync-check-bar">
                  <span className={(showServerCheckOverlay ? serverCheckState : accountCheckState) === 'running'
                    ? 'sync-check-bar-fill-running'
                    : 'sync-check-bar-fill-success'}
                  />
                </div>
              </div>
            )}

            {step === 'entry' && (
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 flex-shrink-0 rounded-2xl bg-accent-soft border border-accent-edge flex items-center justify-center">
                    <Link2 className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h2 className="text-[18px] font-semibold text-hi">Choose setup method</h2>
                    <p className="mt-1 text-[13px] text-lo">Choose one path. Manual setup asks for server details first.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRoute('invite')}
                    disabled={busy}
                    className={`rounded-2xl border p-4 text-left transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-edge ${route === 'invite' ? 'border-accent-edge bg-accent-soft' : 'border-edge bg-input hover:border-edge2'}`}
                  >
                    <p className="text-[14px] font-semibold text-hi">Use invite link</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoute('manual')}
                    disabled={busy}
                    className={`rounded-2xl border p-4 text-left transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-edge ${route === 'manual' ? 'border-accent-edge bg-accent-soft' : 'border-edge bg-input hover:border-edge2'}`}
                  >
                    <p className="text-[14px] font-semibold text-hi">Manual setup</p>
                  </button>
                </div>

                {route === 'invite' && (
                  <>
                    <input type="text" value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} placeholder="securepass://invite?server=..." className={inputClass} />
                    {serverCheckState !== 'idle' && (
                      <div className="rounded-xl border border-edge bg-input p-3 space-y-2">
                        <p className="text-[12px] font-medium text-hi">Checking server...</p>
                        <div className="flex items-center gap-2 text-[12px] text-lo">
                          {serverCheckState === 'running' ? (
                            <Loader2 className="w-4 h-4 text-accent [animation:spin_1.8s_linear_infinite]" />
                          ) : (
                            <CheckCircle2 className={`w-4 h-4 ${serverCheckState === 'success' ? 'text-ok [animation:checkPulse_1.4s_ease-in-out_infinite]' : 'text-err'}`} />
                          )}
                          <span>Validate server address and sync API</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className={navRowClass}>
                  <Button
                    variant="secondary"
                    onClick={onBack}
                    className={navButtonClass}
                    aria-label="Previous"
                    title="Previous"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleEntryContinue}
                    disabled={busy}
                    leftIcon={busy ? <Loader2 className="w-4 h-4 [animation:spin_1.8s_linear_infinite]" /> : undefined}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    className={navButtonClass}
                    aria-label={route === 'invite' ? 'Check invite and continue' : 'Continue'}
                    title={route === 'invite' ? 'Check invite and continue' : 'Continue'}
                  >
                    {route === 'invite' ? 'Check invite & next' : 'Next'}
                  </Button>
                </div>
              </div>
            )}

            {step === 'server' && (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-hi">Enter server address</h2>
                <input type="text" value={serverInput} onChange={(event) => setServerInput(event.target.value)} placeholder="http://192.168.10.2:8787" className={inputClass} />
                {serverCheckState !== 'idle' && (
                  <div className="rounded-xl border border-edge bg-input p-3 space-y-2">
                    <p className="text-[12px] font-medium text-hi">Server verification</p>
                    <div className="flex items-center gap-2 text-[12px] text-lo">
                      {serverCheckState === 'running' ? (
                        <Loader2 className="w-4 h-4 text-accent [animation:spin_1.8s_linear_infinite]" />
                      ) : (
                        <CheckCircle2 className={`w-4 h-4 ${serverCheckState === 'success' ? 'text-ok [animation:checkPulse_1.4s_ease-in-out_infinite]' : 'text-err'}`} />
                      )}
                      <span>Reach server and confirm sync endpoints</span>
                    </div>
                  </div>
                )}
                <div className={navRowClass}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setServerCheckState('idle');
                      setStep('entry');
                    }}
                    disabled={busy}
                    className={navButtonClass}
                    aria-label="Previous"
                    title="Previous"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleManualServerContinue}
                    disabled={busy}
                    leftIcon={busy ? <Loader2 className="w-4 h-4 [animation:spin_1.8s_linear_infinite]" /> : undefined}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    className={navButtonClass}
                    aria-label="Check server and continue"
                    title="Check server and continue"
                  >
                    Check server & next
                  </Button>
                </div>
              </div>
            )}

            {step === 'username' && (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-hi">Enter username</h2>
                <p className="text-[12px] text-lo">Server: <span className="text-mid">{serverValidation?.baseUrl ?? serverInput}</span></p>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setUsernameExistsOnServer(null);
                  }}
                  placeholder="dad"
                  className={inputClass}
                />
                {accountCheckState !== 'idle' && (
                  <div className="rounded-xl border border-edge bg-input p-3 space-y-2">
                    <p className="text-[12px] font-medium text-hi">Checking account...</p>
                    <div className="flex items-center gap-2 text-[12px] text-lo">
                      {accountCheckState === 'running' ? (
                        <Loader2 className="w-4 h-4 text-accent [animation:spin_1.8s_linear_infinite]" />
                      ) : (
                        <CheckCircle2 className={`w-4 h-4 ${accountCheckState === 'success' ? 'text-ok [animation:checkPulse_1.4s_ease-in-out_infinite]' : 'text-err'}`} />
                      )}
                      <span>Resolve whether this username should sign in or register</span>
                    </div>
                  </div>
                )}
                <div className={navRowClass}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAccountCheckState('idle');
                      setStep(route === 'manual' ? 'server' : 'entry');
                    }}
                    disabled={busy}
                    className={navButtonClass}
                    aria-label="Previous"
                    title="Previous"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleUsernameContinue}
                    disabled={busy}
                    leftIcon={busy ? <Loader2 className="w-4 h-4 [animation:spin_1.8s_linear_infinite]" /> : undefined}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    className={navButtonClass}
                    aria-label="Check account and continue"
                    title="Check account and continue"
                  >
                    Check account & next
                  </Button>
                </div>
              </div>
            )}

            {step === 'auth' && (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-hi">
                  {accountMode === 'register' ? 'Create account' : 'Sign in'}
                </h2>
                <p className="text-[12px] text-lo">
                  {usernameExistsOnServer === true && 'This username already exists on the server, so sign-in is required.'}
                  {usernameExistsOnServer === false && 'This username is new on the server, so account creation is required.'}
                  {usernameExistsOnServer === null && 'Continue with account authentication.'}
                </p>

                {accountMode === 'register' && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-accent-edge bg-accent-soft p-3 text-[12px] text-mid">
                      Create a sign-in password for this username.
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-dim uppercase tracking-wide block">Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Create account password"
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-dim uppercase tracking-wide block">Confirm password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Repeat password"
                        className={inputClass}
                      />
                    </div>
                    <div className={navRowClass}>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAccountCheckState('idle');
                          setStep('username');
                        }}
                        disabled={busy}
                        className={navButtonClass}
                        aria-label="Previous"
                        title="Previous"
                      >
                        Previous
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleAuthenticate}
                        disabled={busy}
                        leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                        rightIcon={<ArrowRight className="w-4 h-4" />}
                        className={navButtonClass}
                        aria-label="Create account and continue"
                        title="Create account and continue"
                      >
                        Create account & next
                      </Button>
                    </div>
                  </div>
                )}

                {accountMode === 'login' && (
                  <div className="space-y-3">
                    
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-dim uppercase tracking-wide block">Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Account password"
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-dim uppercase tracking-wide block">
                        Authenticator code <span className="normal-case opacity-70">(only if your account already uses 2FA)</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={mfaCode}
                        onChange={(event) => setMfaCode(event.target.value)}
                        placeholder="6-digit code"
                        className={inputClass}
                        maxLength={6}
                      />
                    </div>
                    <div className={navRowClass}>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAccountCheckState('idle');
                          setStep('username');
                        }}
                        disabled={busy}
                        className={navButtonClass}
                        aria-label="Previous"
                        title="Previous"
                      >
                        Previous
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleAuthenticate}
                        disabled={busy}
                        leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                        rightIcon={<ArrowRight className="w-4 h-4" />}
                        className={navButtonClass}
                        aria-label="Sign in and continue"
                        title="Sign in and continue"
                      >
                        Sign in & next
                      </Button>
                    </div>
                  </div>
                )}

              </div>
            )}

            {step === 'device' && (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-hi">Name this device (optional)</h2>
                <div className="flex items-center gap-2 text-[12px] text-lo"><Laptop className="w-4 h-4" />Shows in linked devices list</div>
                <input type="text" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Dad's Laptop" className={inputClass} />
                <div className={navRowClass}>
                  <Button
                    variant="secondary"
                    onClick={() => setStep('auth')}
                    disabled={busy}
                    className={navButtonClass}
                    aria-label="Previous"
                    title="Previous"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleDeviceContinue}
                    disabled={busy}
                    leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    className={navButtonClass}
                    aria-label="Save and continue"
                    title="Save and continue"
                  >
                    Save & next
                  </Button>
                </div>
              </div>
            )}

            {step === 'done' && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="inline-flex h-16 w-16 rounded-2xl bg-ok-soft border border-ok-edge items-center justify-center mb-3">
                    <CheckCircle2 className="w-8 h-8 text-ok" />
                  </div>
                  <h2 className="text-[20px] font-semibold text-hi">
                    {openedWhileLoggedIn ? 'Sync overview' : "You're all set"}
                  </h2>
                  <p className="mt-1 text-[13px] text-lo">
                    {openedWhileLoggedIn ? 'This account is already synced on this device.' : 'Active devices linked to this account:'}
                  </p>
                </div>

                {syncStatus?.loggedIn && (
                  <div className="rounded-2xl border border-edge bg-input p-3 space-y-3">
                    <div>
                      <p className="text-[14px] font-medium text-hi">
                        {`Synced as ${syncStatus.username ?? 'unknown'}${syncStatus.baseUrl ? ` · ${syncStatus.baseUrl}` : ''}`}
                      </p>
                      <p className="text-[12px] text-lo mt-0.5">Last sync: {syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : 'Never'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full">
                      <Button
                        variant="primary"
                        leftIcon={syncNowBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        onClick={handleSyncNow}
                        disabled={busy || syncNowBusy}
                        aria-label="Sync now"
                        title="Sync now"
                        className="w-full min-w-0"
                      >
                        Sync now
                      </Button>
                      <Button
                        variant="danger"
                        leftIcon={<CloudOff className="w-3.5 h-3.5" />}
                        onClick={() => {
                          if (!window.confirm('Disable sync on this device?')) return;
                          void handleStopSyncing();
                        }}
                        disabled={busy || syncNowBusy}
                        aria-label="Disable sync on this device"
                        title="Disable sync on this device"
                        className="w-full min-w-0 text-[13px]"
                      >
                        Disable sync
                      </Button>
                      <Button
                        variant="secondary"
                        leftIcon={<LogOut className="w-3.5 h-3.5" />}
                        onClick={handleLogout}
                        disabled={busy || syncNowBusy}
                        aria-label="Sign out"
                        title="Sign out"
                        className="w-full min-w-0 !border-edge hover:!border-edge2"
                      >
                        Sign out
                      </Button>
                      <Button
                        variant="secondary"
                        leftIcon={<UserRound className="w-3.5 h-3.5" />}
                        onClick={() => {
                          if (!window.confirm('Use a different account on this device? This clears local vault data first.')) return;
                          void handleSwitchAccount();
                        }}
                        disabled={busy || syncNowBusy}
                        aria-label="Switch account"
                        title="Switch account"
                        className="w-full min-w-0 !border-edge hover:!border-edge2"
                      >
                        Switch account
                      </Button>
                    </div>
                    <p className="text-[11px] text-lo">
                      Disabling sync keeps passwords on this device and disconnects server backup for this computer only.
                    </p>
                  </div>
                )}

                <div className="rounded-2xl border border-edge bg-input p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-semibold text-hi">Linked devices</p>
                    <Button
                      variant="compact"
                      onClick={() => { void refreshDevices(Boolean(syncStatus?.loggedIn)); }}
                      disabled={devicesBusy || busy || !syncStatus?.loggedIn}
                      leftIcon={devicesBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      aria-label="Refresh linked devices"
                      title="Refresh linked devices"
                    >
                      Refresh
                    </Button>
                  </div>

                  {devicesBusy && <p className="text-[12px] text-lo">Loading devices...</p>}
                  {!devicesBusy && deviceSummaries.length === 0 && <p className="text-[12px] text-lo">No devices found.</p>}
                  {!devicesBusy && deviceSummaries.length > 0 && (
                    <div className="max-h-56 overflow-y-auto pr-1 flex flex-col gap-2">
                      {deviceSummaries.map((device) => (
                        <div key={device.key} className="rounded-xl border border-edge bg-card/60 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] font-medium text-hi truncate">{device.name}</p>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${device.active ? 'text-ok border-ok-edge bg-ok-soft' : 'text-lo border-edge bg-input'}`}>
                              {device.active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="text-[11px] text-lo mt-1">
                            Last seen: {new Date(device.lastSeenAt).toLocaleString()}
                            {device.isCurrent ? ' · This device' : ''}
                            {device.sessions > 1 ? ` · ${device.sessions} sessions` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {!openedWhileLoggedIn && (
                  <div className={navRowClass}>
                    <Button
                      variant="secondary"
                      onClick={() => setStep('device')}
                      className={navButtonClass}
                      aria-label="Previous"
                      title="Previous"
                    >
                      Previous
                    </Button>
                    <Button
                      variant="primary"
                      onClick={onComplete}
                      className={navButtonClass}
                      leftIcon={<CheckCircle2 className="w-4 h-4" />}
                      aria-label={asModal ? 'Done' : 'Continue to PIN setup'}
                      title={asModal ? 'Done' : 'Continue to PIN setup'}
                    >
                      {asModal ? 'Done' : 'Continue to PIN setup'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {message && (
              <p className={`mt-4 text-[13px] ${message.type === 'ok' ? 'text-ok' : 'text-err'}`}>
                {message.text}
              </p>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
