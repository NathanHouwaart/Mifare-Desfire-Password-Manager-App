import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CloudOff,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Server,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react';
import Button from './UI/Button';
import { SetupBrandShield } from './SetupBrandShield';

type SetupRoute = 'invite' | 'manual';
type SetupStep = 'entry' | 'invite' | 'server' | 'username' | 'auth' | 'security' | 'device' | 'done';
type AccountMode = 'register' | 'login' | 'bootstrap';
type AsyncCheckState = 'idle' | 'running' | 'success' | 'error';
type PasswordRuleState = 'ok' | 'warn' | 'neutral';

const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 256;

interface SyncSetupFlowProps {
  initialSyncConfig?: SyncInvitePayloadDto | null;
  onBack: () => void;
  onCancel?: () => void;
  onComplete: () => void;
  asModal?: boolean;
  resumeConfiguredState?: boolean;
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
    const inviteToken = parsed.searchParams.get('token')?.trim();
    return {
      baseUrl,
      username: username && username.length > 0 ? username : undefined,
      inviteToken: inviteToken && inviteToken.length > 0 ? inviteToken : undefined,
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
  if (text.includes('invite token is required')) return 'This server is invite-only. Enter your invite token.';
  if (text.includes('invalid invite token')) return 'Invite token is invalid.';
  if (text.includes('invite token has expired')) return 'Invite token expired. Ask for a new invite.';
  if (text.includes('invite token has already been used')) return 'This invite token has already been used.';
  if (text.includes('invalid bootstrap token')) return 'Bootstrap token is incorrect.';
  if (text.includes('bootstrap already completed')) return 'Server already has an owner. Use invite registration or sign in.';
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
    case 'invite':
      return 'Invite';
    case 'server':
      return 'Server';
    case 'username':
      return 'Username';
    case 'auth':
      return 'Account';
    case 'security':
      return 'Security';
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

function InlineCheckStatus({
  state,
  runningText,
  successText,
  errorText,
}: {
  state: AsyncCheckState;
  runningText: string;
  successText: string;
  errorText: string;
}) {
  if (state === 'idle') return null;

  const running = state === 'running';
  const success = state === 'success';

  return (
    <div className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 ${
      running
        ? 'border-accent-edge bg-accent-soft'
        : success
          ? 'border-ok-edge bg-ok-soft'
          : 'border-err-edge bg-err-soft'
    }`}>
      {running ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
      ) : (
        <CheckCircle2 className={`h-4 w-4 shrink-0 ${success ? 'text-ok' : 'text-err'}`} />
      )}
      <span className={`text-[13px] ${running ? 'text-lo' : success ? 'text-ok' : 'text-err'}`}>
        {running ? runningText : success ? successText : errorText}
      </span>
    </div>
  );
}

function PasswordRule({ state, text }: { state: PasswordRuleState; text: string }) {
  const dotClass = state === 'ok'
    ? 'bg-ok border-ok-edge'
    : state === 'warn'
      ? 'bg-err border-err-edge'
      : 'bg-input border-edge';

  const textClass = state === 'ok'
    ? 'text-ok'
    : state === 'warn'
      ? 'text-err'
      : 'text-dim';

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full border ${dotClass}`} />
      <span className={`text-[12px] ${textClass}`}>{text}</span>
    </div>
  );
}

export function SyncSetupFlow({
  initialSyncConfig = null,
  onBack,
  onCancel,
  onComplete,
  asModal = false,
  resumeConfiguredState = true,
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
    initialSyncConfig?.baseUrl
      ? `securepass://invite?server=${encodeURIComponent(initialSyncConfig.baseUrl)}${
        initialSyncConfig.inviteToken ? `&token=${encodeURIComponent(initialSyncConfig.inviteToken)}` : ''
      }`
      : ''
  );
  const [serverInput, setServerInput] = useState(initialSyncConfig?.baseUrl ?? '');
  const [serverValidation, setServerValidation] = useState<SyncServerValidationDto | null>(null);
  const [username, setUsername] = useState(initialSyncConfig?.username ?? '');
  const [inviteTokenInput, setInviteTokenInput] = useState(initialSyncConfig?.inviteToken ?? '');
  const [bootstrapToken, setBootstrapToken] = useState('');
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
    if (route === 'invite') order.push('invite');
    if (route === 'manual') order.push('server');
    order.push('username', 'auth', 'security', 'device');
    return order;
  }, [route]);

  const stepIdx = step === 'done'
    ? stepOrder.length - 1
    : Math.max(0, stepOrder.indexOf(step));

  const navRowClass = 'flex flex-col sm:flex-row gap-2';
  const navButtonClass = 'w-full min-w-0';
  const inputClass = `w-full bg-input border border-edge text-hi text-[14px] rounded-xl px-3.5 py-2.5 outline-none focus:border-accent-edge transition-colors placeholder:text-dim`;
  const creatingAccount = accountMode === 'register' || accountMode === 'bootstrap';
  const passwordLengthValid = password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
  const confirmPasswordPresent = confirmPassword.length > 0;
  const passwordsMatch = password === confirmPassword;
  const passwordCreationValid = passwordLengthValid && confirmPasswordPresent && passwordsMatch;
  const canSubmitAuth = accountMode === 'login'
    ? password.trim().length > 0
    : passwordCreationValid && (
      accountMode === 'register' ? inviteTokenInput.trim().length > 0 : bootstrapToken.trim().length > 0
    );

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
          if (resumeConfiguredState) {
            setStep('auth');
          } else {
            setStep(initialSyncConfig?.baseUrl ? 'invite' : 'entry');
          }
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
  }, [resumeConfiguredState]);

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
      if (serverValidation && !serverValidation.hasUsers) {
        if (cancelled) return;
        setUsernameExistsOnServer(false);
        setAccountMode('bootstrap');
        return;
      }

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
  }, [step, syncStatus, serverValidation]);

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
      setInviteTokenInput(invite.inviteToken ?? '');
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
      await handleValidateServer(serverInput.trim());
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
      const requiresBootstrap = Boolean(serverValidation && !serverValidation.hasUsers);
      let usernameExists: boolean | null = null;
      let nextAccountMode: AccountMode = 'login';

      if (requiresBootstrap) {
        usernameExists = false;
        nextAccountMode = 'bootstrap';
      } else {
        const lookup = await window.electron['sync:checkUsername']();
        usernameExists = lookup.exists;
        nextAccountMode = lookup.exists ? 'login' : 'register';
      }

      setUsernameExistsOnServer(usernameExists);
      setAccountMode(nextAccountMode);
      setPassword('');
      setConfirmPassword('');
      setBootstrapToken('');
      setMfaCode('');
      setMfaSetup(null);
      setAccountCheckState('success');
      await wait(700);
      setStep('auth');
      setMessage({
        type: 'ok',
        text: requiresBootstrap
          ? 'Fresh server detected. Complete owner bootstrap.'
          : usernameExists
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

    if (creatingAccount && !passwordLengthValid) {
      setMessage({ type: 'err', text: `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.` });
      return;
    }
    if (creatingAccount && password !== confirmPassword) {
      setMessage({ type: 'err', text: 'Passwords do not match.' });
      return;
    }
    if (accountMode === 'register' && !inviteTokenInput.trim()) {
      setMessage({ type: 'err', text: 'Invite token is required for account creation.' });
      return;
    }
    if (accountMode === 'bootstrap' && !bootstrapToken.trim()) {
      setMessage({ type: 'err', text: 'Bootstrap token is required to create the owner account.' });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      if (accountMode === 'bootstrap') {
        await window.electron['sync:bootstrap']({ password, bootstrapToken: bootstrapToken.trim() });
        setMessage({ type: 'ok', text: 'Owner account bootstrapped. Next: review account security.' });
      } else if (accountMode === 'register') {
        await window.electron['sync:register']({ password, inviteToken: inviteTokenInput.trim() });
        setMessage({ type: 'ok', text: 'Account created. Next: review account security.' });
      } else {
        await window.electron['sync:login']({ password, mfaCode: mfaCode.trim() || undefined });
        setMessage({ type: 'ok', text: 'Signed in successfully.' });
      }

      setPassword('');
      setConfirmPassword('');
      setBootstrapToken('');
      setMfaCode('');
      setOpenedWhileLoggedIn(false);
      setMfaSetup(null);
      await refreshAll();
      setStep('security');
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

  const handleDisableMfa = async () => {
    if (!mfaCode.trim()) {
      setMessage({ type: 'err', text: 'Authenticator code is required.' });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await window.electron['sync:mfaDisable']({ code: mfaCode.trim() });
      setMfaCode('');
      setMfaSetup(null);
      await refreshMfa(true);
      setMessage({ type: 'ok', text: 'Authenticator disabled.' });
    } catch (error) {
      setMessage({ type: 'err', text: toFriendlySyncError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSecurityContinue = async () => {
    if (!syncStatus?.loggedIn) {
      setMessage({ type: 'err', text: 'Sign in first.' });
      return;
    }
    await refreshMfa(true);
    setStep('device');
    setMessage(null);
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
      setBootstrapToken('');
      setMfaCode('');
      setMfaSetup(null);
      setUsernameExistsOnServer(null);
      setInviteTokenInput(initialSyncConfig?.inviteToken ?? '');
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

  return (
    <div className={asModal ? 'relative w-full' : 'relative h-screen w-screen overflow-hidden bg-page flex items-center justify-center px-4'}>
      {!asModal && (
        <>
          <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
        </>
      )}

      <div className="relative w-full max-w-[620px] z-10 mx-auto">
        <div className="absolute -inset-[1px] rounded-[30px] bg-gradient-to-br from-indigo-500/24 via-violet-500/18 to-cyan-500/16 blur-[2px]" />
        <div className="relative rounded-[30px] border border-edge bg-card/92 shadow-[0_24px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
            <div className="flex min-w-0 items-center gap-3">
              <SetupBrandShield size="sm" />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-semibold leading-tight text-hi">SecurePass Sync Setup</p>
                <p className="truncate text-[14px] text-lo">
                  {bootstrapping
                    ? 'Loading...'
                    : step === 'entry'
                      ? 'Connect to server'
                      : step === 'server'
                        ? 'Server address'
                        : step === 'username'
                          ? 'Your username'
                          : step === 'auth'
                            ? 'Sign in or create account'
                            : step === 'security'
                              ? 'Account security'
                              : step === 'device'
                                ? 'This device'
                                : 'Connected'}
                </p>
              </div>
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

            {step === 'entry' && (
              <div className="space-y-4">
                <div className="mb-2">
                  <h2 className="text-[22px] font-semibold text-hi leading-tight">How do you want to connect?</h2>
                  <p className="mt-1.5 text-[14px] text-lo">New user or returning — pick what fits you.</p>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRoute('invite');
                      setInviteInput('');
                      setServerCheckState('idle');
                      setMessage(null);
                      setStep('invite');
                    }}
                    disabled={busy}
                    className="group flex items-center gap-5 rounded-2xl border border-edge bg-input px-5 py-5 text-left transition-all duration-150 hover:border-accent-edge hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-edge disabled:opacity-50"
                  >
                    <div className="h-14 w-14 shrink-0 rounded-2xl bg-card border border-edge flex items-center justify-center group-hover:border-accent-edge group-hover:bg-accent-soft transition-all duration-150">
                      <Link2 className="w-7 h-7 text-mid group-hover:text-accent transition-colors" />
                    </div>
                    <div>
                      <p className="text-[19px] font-semibold text-hi leading-tight">I have an invite link</p>
                      <p className="mt-1 text-[14px] text-lo">Paste a link shared by your server admin.</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRoute('manual');
                      setServerInput('');
                      setServerValidation(null);
                      setServerCheckState('idle');
                      setMessage(null);
                      setStep('server');
                    }}
                    disabled={busy}
                    className="group flex items-center gap-5 rounded-2xl border border-edge bg-input px-5 py-5 text-left transition-all duration-150 hover:border-accent-edge hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-edge disabled:opacity-50"
                  >
                    <div className="h-14 w-14 shrink-0 rounded-2xl bg-card border border-edge flex items-center justify-center group-hover:border-accent-edge group-hover:bg-accent-soft transition-all duration-150">
                      <Server className="w-7 h-7 text-mid group-hover:text-accent transition-colors" />
                    </div>
                    <div>
                      <p className="text-[19px] font-semibold text-hi leading-tight">Connect to server</p>
                      <p className="mt-1 text-[14px] text-lo">Sign in or create an account on a server you know.</p>
                    </div>
                  </button>
                </div>

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
                </div>
              </div>
            )}

            {step === 'invite' && (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-hi">Paste your invite link</h2>
                <InlineCheckStatus
                  state={serverCheckState}
                  runningText="Checking server reachability..."
                  successText="Server verified"
                  errorText="Could not reach server"
                />
                <input
                  type="text"
                  value={inviteInput}
                  onChange={(event) => {
                    setInviteInput(event.target.value);
                    setServerCheckState('idle');
                  }}
                  placeholder="securepass://invite?server=...&token=..."
                  className={inputClass}
                  autoFocus
                />
                <div className={navRowClass}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setServerCheckState('idle');
                      setMessage(null);
                      setStep('entry');
                    }}
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
                    aria-label="Check invite and continue"
                    title="Check invite and continue"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}

            {step === 'server' && (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-hi">Enter server address</h2>
                <InlineCheckStatus
                  state={serverCheckState}
                  runningText="Connecting to server..."
                  successText="Server verified"
                  errorText="Could not reach server"
                />
                <input
                  type="text"
                  value={serverInput}
                  onChange={(event) => {
                    setServerInput(event.target.value);
                    setServerCheckState('idle');
                  }}
                  placeholder="http://192.168.10.2:8787"
                  className={inputClass}
                />
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
                <InlineCheckStatus
                  state={accountCheckState}
                  runningText="Checking username..."
                  successText={
                    accountMode === 'bootstrap'
                      ? 'Fresh server detected - owner bootstrap required'
                      : usernameExistsOnServer === true
                        ? `"${username}" found - will sign in`
                        : `"${username}" is new - will create account`
                  }
                  errorText="Could not check username right now"
                />
                <input
                  type="text"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setUsernameExistsOnServer(null);
                    setAccountCheckState('idle');
                  }}
                  placeholder="dad"
                  className={inputClass}
                />
                <div className={navRowClass}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAccountCheckState('idle');
                      setStep(route === 'manual' ? 'server' : 'invite');
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
                  {accountMode === 'bootstrap'
                    ? 'Create owner account'
                    : accountMode === 'register'
                      ? 'Create account'
                      : 'Sign in'}
                </h2>
                <p className="text-[12px] text-lo">
                  {accountMode === 'bootstrap' && `Fresh server detected. "${username}" will become the first admin account.`}
                  {usernameExistsOnServer === true && 'This username already exists on the server, so sign-in is required.'}
                  {usernameExistsOnServer === false && accountMode !== 'bootstrap' && 'This username is new on the server, so account creation is required.'}
                  {usernameExistsOnServer === null && 'Continue with account authentication.'}
                </p>

                {(accountMode === 'register' || accountMode === 'bootstrap') && (
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
                    <div className="space-y-2 rounded-xl border border-edge bg-input p-3">
                      <p className="text-[11px] uppercase tracking-wide text-dim">Password requirements</p>
                      <PasswordRule
                        state={passwordLengthValid ? 'ok' : 'warn'}
                        text={`Use ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`}
                      />
                      <PasswordRule
                        state={!confirmPasswordPresent ? 'neutral' : passwordsMatch ? 'ok' : 'warn'}
                        text={!confirmPasswordPresent
                          ? 'Repeat password to confirm'
                          : passwordsMatch
                            ? 'Passwords match'
                            : 'Passwords do not match'}
                      />
                    </div>
                    {accountMode === 'bootstrap' && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-dim uppercase tracking-wide block">Bootstrap token</label>
                        <input
                          type="password"
                          value={bootstrapToken}
                          onChange={(event) => setBootstrapToken(event.target.value)}
                          placeholder="Token from server .env (BOOTSTRAP_TOKEN)"
                          className={inputClass}
                        />
                      </div>
                    )}
                    {accountMode === 'register' && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-dim uppercase tracking-wide block">Invite token</label>
                        <input
                          type="text"
                          value={inviteTokenInput}
                          onChange={(event) => setInviteTokenInput(event.target.value)}
                          placeholder="Paste invite token"
                          className={inputClass}
                        />
                      </div>
                    )}
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
                        disabled={busy || !canSubmitAuth}
                        leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                        rightIcon={<ArrowRight className="w-4 h-4" />}
                        className={navButtonClass}
                        aria-label={accountMode === 'bootstrap' ? 'Bootstrap owner account and continue' : 'Create account and continue'}
                        title={accountMode === 'bootstrap' ? 'Bootstrap owner account and continue' : 'Create account and continue'}
                      >
                        {accountMode === 'bootstrap' ? 'Bootstrap owner & next' : 'Create account & next'}
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
                        disabled={busy || !canSubmitAuth}
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

            {step === 'security' && (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-hi">Account security</h2>
                <p className="text-[12px] text-lo">Set up two-factor authentication before finishing device setup.</p>
                <div className="rounded-xl border border-edge bg-input p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-hi">Authenticator (2FA)</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-lg border ${
                      mfaStatus?.mfaEnabled
                        ? 'text-ok border-ok-edge bg-ok-soft'
                        : 'text-dim border-edge bg-card'
                    }`}>
                      {mfaStatus?.mfaEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p className="text-[12px] text-lo">
                    Optional but strongly recommended for account safety.
                  </p>

                  {!mfaStatus?.mfaEnabled && !mfaSetup && (
                    <Button
                      variant="secondary"
                      onClick={handleSetupMfa}
                      disabled={busy || !syncStatus?.loggedIn}
                      className="w-full min-w-0"
                    >
                      Set up authenticator
                    </Button>
                  )}

                  {mfaSetup && (
                    <div className="rounded-xl border border-edge bg-card/70 p-3 space-y-3">
                      <p className="text-[12px] text-lo">
                        Scan the QR code, then enter a 6-digit code to enable 2FA.
                      </p>
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt="Authenticator QR code"
                          className="w-36 h-36 rounded-lg border border-edge bg-white p-2"
                        />
                      ) : (
                        <p className="text-[12px] text-dim">Generating QR code...</p>
                      )}
                      <p className="text-[11px] text-dim break-all">Manual code: {mfaSetup.secret}</p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={mfaCode}
                          onChange={(event) => setMfaCode(event.target.value)}
                          placeholder="6-digit code"
                          className={inputClass}
                          maxLength={6}
                        />
                        <Button
                          variant="primary"
                          onClick={handleEnableMfa}
                          disabled={busy}
                          className="w-full sm:w-auto min-w-0"
                        >
                          Enable 2FA
                        </Button>
                      </div>
                    </div>
                  )}

                  {mfaStatus?.mfaEnabled && (
                    <div className="rounded-xl border border-edge bg-card/70 p-3 space-y-2">
                      <p className="text-[12px] text-lo">To disable 2FA, enter your current authenticator code.</p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={mfaCode}
                          onChange={(event) => setMfaCode(event.target.value)}
                          placeholder="6-digit code"
                          className={inputClass}
                          maxLength={6}
                        />
                        <Button
                          variant="danger"
                          onClick={handleDisableMfa}
                          disabled={busy}
                          className="w-full sm:w-auto min-w-0"
                        >
                          Disable 2FA
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className={navRowClass}>
                  <Button
                    variant="secondary"
                    onClick={() => setStep('auth')}
                    disabled={busy}
                    className={navButtonClass}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => { void handleSecurityContinue(); }}
                    disabled={busy}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    className={navButtonClass}
                  >
                    Continue to device setup
                  </Button>
                </div>
              </div>
            )}

            {step === 'device' && (
              <div className="space-y-4">
                <h2 className="text-[18px] font-semibold text-hi">Name this device (optional)</h2>
                <p className="text-[12px] text-lo">This name appears in your linked device list.</p>
                <input type="text" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Dad's Laptop" className={inputClass} />
                <div className="rounded-xl border border-edge bg-input px-3 py-2.5 flex items-center justify-between">
                  <p className="text-[12px] text-mid">Two-factor authentication</p>
                  <span className={`text-[11px] px-2 py-0.5 rounded-lg border ${
                    mfaStatus?.mfaEnabled ? 'text-ok border-ok-edge bg-ok-soft' : 'text-warn border-warn-edge bg-warn-soft'
                  }`}>
                    {mfaStatus?.mfaEnabled ? 'Enabled' : 'Not set up'}
                  </span>
                </div>
                <div className={navRowClass}>
                  <Button
                    variant="secondary"
                    onClick={() => setStep('security')}
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
                    <div className="rounded-xl border border-edge bg-card/70 p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12px] font-semibold text-hi">Authenticator (2FA)</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-lg border ${
                          mfaStatus?.mfaEnabled
                            ? 'text-ok border-ok-edge bg-ok-soft'
                            : 'text-dim border-edge bg-input'
                        }`}>
                          {mfaStatus?.mfaEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      {!mfaStatus?.mfaEnabled && !mfaSetup && (
                        <Button
                          variant="secondary"
                          onClick={handleSetupMfa}
                          disabled={busy || syncNowBusy}
                          className="w-full min-w-0"
                          aria-label="Set up authenticator"
                          title="Set up authenticator"
                        >
                          Set up authenticator
                        </Button>
                      )}
                      {mfaSetup && (
                        <div className="space-y-2">
                          <p className="text-[11px] text-lo">
                            Scan the QR code, then enter a 6-digit code to enable 2FA.
                          </p>
                          {qrDataUrl ? (
                            <img
                              src={qrDataUrl}
                              alt="Authenticator QR code"
                              className="w-32 h-32 rounded-lg border border-edge bg-white p-1.5"
                            />
                          ) : (
                            <p className="text-[11px] text-dim">Generating QR code...</p>
                          )}
                          <p className="text-[11px] text-dim break-all">Manual code: {mfaSetup.secret}</p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={mfaCode}
                              onChange={(event) => setMfaCode(event.target.value)}
                              placeholder="6-digit code"
                              className={inputClass}
                              maxLength={6}
                            />
                            <Button
                              variant="primary"
                              onClick={handleEnableMfa}
                              disabled={busy || syncNowBusy}
                              className="w-full sm:w-auto min-w-0"
                              aria-label="Enable 2FA"
                              title="Enable 2FA"
                            >
                              Enable 2FA
                            </Button>
                          </div>
                        </div>
                      )}
                      {mfaStatus?.mfaEnabled && (
                        <div className="space-y-2">
                          <p className="text-[11px] text-lo">Enter a current code to disable 2FA.</p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={mfaCode}
                              onChange={(event) => setMfaCode(event.target.value)}
                              placeholder="6-digit code"
                              className={inputClass}
                              maxLength={6}
                            />
                            <Button
                              variant="danger"
                              onClick={handleDisableMfa}
                              disabled={busy || syncNowBusy}
                              className="w-full sm:w-auto min-w-0"
                              aria-label="Disable 2FA"
                              title="Disable 2FA"
                            >
                              Disable 2FA
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-edge bg-input p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-semibold text-hi">
                      Linked devices{devicesBusy ? '' : ` (${devices.length})`}
                    </p>
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
                  {!devicesBusy && devices.length === 0 && <p className="text-[12px] text-lo">No devices found.</p>}
                  {!devicesBusy && devices.length > 0 && (
                    <div className="max-h-56 overflow-y-auto pr-1 flex flex-col gap-2">
                      {devices.map((device) => (
                        <div key={device.id} className="rounded-xl border border-edge bg-card/60 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] font-medium text-hi truncate">{device.name}</p>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${device.active ? 'text-ok border-ok-edge bg-ok-soft' : 'text-lo border-edge bg-input'}`}>
                              {device.active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="text-[11px] text-lo mt-1">
                            Last seen: {new Date(device.lastSeenAt).toLocaleString()}
                            {device.isCurrent ? ' - This device' : ''}
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

