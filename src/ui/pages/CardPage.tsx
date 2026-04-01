import { useState, useCallback } from 'react';
import {
  CreditCard, Wifi, MemoryStick, List,
  ShieldCheck, ShieldX, RefreshCw, Trash2,
  AlertTriangle, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { TapCardOverlay } from '../Components/TapCardOverlay';

interface CardPageProps {
  isNfcConnected: boolean;
  highlightInitAction?: boolean;
}

type OpState = 'idle' | 'busy' | 'ok' | 'err';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── tiny status badge ───────────────────────────────────────────────────────
function Badge({ state, label }: { state: OpState; label: string }) {
  if (state === 'idle') return null;
  const cfg: Record<Exclude<OpState, 'idle'>, { cls: string; Icon: React.ElementType }> = {
    busy: { cls: 'text-lo',  Icon: Loader2 },
    ok:   { cls: 'text-ok',  Icon: CheckCircle2 },
    err:  { cls: 'text-err', Icon: XCircle },
  };
  const { cls, Icon } = cfg[state as Exclude<OpState, 'idle'>];
  return (
    <span className={`flex items-center gap-1.5 text-[13px] ${cls}`}>
      <Icon className={`w-4 h-4 shrink-0 ${state === 'busy' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}

// ─── section card ────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card border border-edge p-5 flex flex-col gap-4">
      <h2 className="text-[15px] font-semibold text-mid uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

// ─── action button ───────────────────────────────────────────────────────────
function ActionBtn({
  onClick, disabled, variant = 'default', children, className = '', dataGuideItem,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
  children: React.ReactNode;
  className?: string;
  dataGuideItem?: string;
}) {
  const base = `flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-medium
                select-none transition-all duration-100 active:scale-[0.97]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-edge`;
  const style =
    variant === 'destructive'
      ? 'bg-err-soft text-err border border-err-edge hover:bg-err/20 disabled:opacity-40'
      : 'bg-accent-soft text-accent border border-accent-edge hover:bg-accent/20 disabled:opacity-40';
  return (
    <button
      className={`${base} ${style} ${className}`}
      onClick={onClick}
      disabled={disabled}
      data-guide-item={dataGuideItem}
    >
      {children}
    </button>
  );
}

// ─── info row ────────────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[13px] text-lo shrink-0 mt-px">{label}</span>
      <span className="text-[13px] text-hi font-mono break-all text-right">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export const CardPage = ({ isNfcConnected, highlightInitAction = false }: CardPageProps) => {

  // ── Probe state ────────────────────────────────────────────────────────────
  const [uid,             setUid]             = useState<string | null>(null);
  const [isInit,          setIsInit]          = useState<boolean | null>(null);
  const [isCompatible,    setIsCompatible]    = useState<boolean | null>(null);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const [freeMemory,      setFreeMemory]      = useState<number | null>(null);
  const [aids,            setAids]            = useState<string[] | null>(null);

  const [probeState,      setProbeState]      = useState<OpState>('idle');
  const [probeMsg,        setProbeMsg]        = useState('');

  // ── Init card state ────────────────────────────────────────────────────────
  const [initState,       setInitState]       = useState<OpState>('idle');
  const [initMsg,         setInitMsg]         = useState('');

  // ── Format state ──────────────────────────────────────────────────────────
  const [formatState,     setFormatState]     = useState<OpState>('idle');
  const [formatMsg,       setFormatMsg]       = useState('');
  const [confirmFormat,   setConfirmFormat]   = useState(false);
  const [confirmFormatText, setConfirmFormatText] = useState('');

  const CONFIRM_PHRASE = 'format card';

  // ── Tap overlay ───────────────────────────────────────────────────────────
  const [tapOverlay,      setTapOverlay]      = useState<{ message: string } | null>(null);
  const [tapCancelled,    setTapCancelled]    = useState(false);

  // ── Probe card ─────────────────────────────────────────────────────────────
  const handleProbe = useCallback(async () => {
    setProbeState('busy'); setProbeMsg('Probing…');
    setUid(null); setIsInit(null); setIsCompatible(null); setCompatibilityError(null); setFreeMemory(null); setAids(null);
    try {
      const {
        uid,
        isInitialised,
        isCompatibleWithCurrentVault,
        compatibilityError,
      } = await window.electron['card:probe']();
      if (uid === null) {
        setProbeState('err'); setProbeMsg('No card detected');
      } else {
        setUid(uid);
        setIsInit(isInitialised);
        setIsCompatible(isCompatibleWithCurrentVault);
        setCompatibilityError(compatibilityError ?? null);
        if (isInitialised && isCompatibleWithCurrentVault === true) {
          window.dispatchEvent(new Event('securepass:guide-card-initialized'));
        }
        if (isInitialised && isCompatibleWithCurrentVault === false) {
          setProbeState('ok'); setProbeMsg('Card detected (belongs to another vault)');
        } else if (isInitialised && isCompatibleWithCurrentVault === null && compatibilityError) {
          setProbeState('ok'); setProbeMsg('Card detected (compatibility not verified)');
        } else {
          setProbeState('ok'); setProbeMsg('Card detected');
        }
      }
    } catch (err) {
      setProbeState('err'); setProbeMsg(errMsg(err));
    }
  }, []);

  const handleFetchMemory = useCallback(async () => {
    if (!uid) return;
    setTapOverlay({ message: 'to read free memory from the card' });
    setTapCancelled(false);
    try {
      const mem = await window.electron['card:freeMemory']();
      setFreeMemory(mem);
    } catch (err) {
      if (!tapCancelled) setProbeMsg(errMsg(err));
    } finally {
      setTapOverlay(null);
    }
  }, [uid, tapCancelled]);

  const handleFetchAids = useCallback(async () => {
    if (!uid) return;
    setTapOverlay({ message: 'to read application IDs from the card' });
    setTapCancelled(false);
    try {
      const list = await window.electron['card:getAids']();
      setAids(list);
    } catch (err) {
      if (!tapCancelled) setProbeMsg(errMsg(err));
    } finally {
      setTapOverlay(null);
    }
  }, [uid, tapCancelled]);

  // ── Init card ──────────────────────────────────────────────────────────────
  const handleInit = useCallback(async () => {
    setInitState('busy'); setInitMsg('Waiting for card tap…');
    setTapOverlay({ message: 'to initialise the card for this vault' });
    setTapCancelled(false);
    try {
      await window.electron['card:init']();
      setIsInit(true);
      setIsCompatible(true);
      setCompatibilityError(null);
      setInitState('ok'); setInitMsg('Card initialised successfully');
      window.dispatchEvent(new Event('securepass:guide-card-initialized'));
    } catch (err) {
      if (!tapCancelled) {
        setInitState('err'); setInitMsg(errMsg(err));
      } else {
        setInitState('idle'); setInitMsg('');
      }
    } finally {
      setTapOverlay(null);
    }
  }, [tapCancelled]);

  // ── Format card ────────────────────────────────────────────────────────────
  const handleFormat = useCallback(async () => {
    setConfirmFormat(false);
    setConfirmFormatText('');
    setFormatState('busy'); setFormatMsg('Waiting for card tap…');
    setTapOverlay({ message: 'to format the card to factory state — this cannot be undone' });
    setTapCancelled(false);
    try {
      await window.electron['card:format']();
      setIsInit(false);
      setIsCompatible(null);
      setCompatibilityError(null);
      setUid(null); setFreeMemory(null); setAids(null);
      setFormatState('ok'); setFormatMsg('Card formatted to factory state');
    } catch (err) {
      if (!tapCancelled) {
        setFormatState('err'); setFormatMsg(errMsg(err));
      } else {
        setFormatState('idle'); setFormatMsg('');
      }
    } finally {
      setTapOverlay(null);
    }
  }, [tapCancelled]);

  const handleCancelTap = useCallback(() => {
    setTapCancelled(true);
    setTapOverlay(null);
  }, []);

  // ─── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="px-6 py-6 max-w-2xl w-full mx-auto">

      {/* Page header */}
      <div className="flex items-start gap-4 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent-edge
                        flex items-center justify-center shrink-0 mt-0.5">
          <CreditCard className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-hi leading-tight">Card Management</h1>
          <p className="text-[14px] text-lo mt-0.5">Manage DESFire card operations</p>
        </div>
      </div>

      {/* NFC not connected warning */}
      {!isNfcConnected && (
        <div className="flex items-start gap-3 rounded-2xl bg-warn-soft border border-warn-edge p-4 mb-4">
          <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-semibold text-warn">NFC reader not connected</p>
            <p className="text-[13px] text-lo mt-0.5">
              Go to <span className="font-medium text-mid">NFC Reader</span> to connect a reader
              before using card operations.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
      {/* ── Probe section ── */}
      <Section title="Card Probe">
        <p className="text-[13px] text-lo">
          Read basic information from the card without unlocking it.
        </p>
        <div className="flex items-center gap-3">
          <ActionBtn onClick={handleProbe} disabled={!isNfcConnected || probeState === 'busy'}>
            <RefreshCw className={`w-4 h-4 ${probeState === 'busy' ? 'animate-spin' : ''}`} />
            {uid ? 'Re-probe' : 'Probe Card'}
          </ActionBtn>
          <Badge state={probeState} label={probeMsg} />
        </div>

        {uid && (
          <div className="rounded-xl bg-well border border-edge p-4 flex flex-col gap-2.5">
            <InfoRow label="UID" value={uid} />
            <InfoRow
              label="Initialised"
              value={isInit === null ? '—' : isInit ? 'Yes' : 'No'}
            />
            {isInit && (
              <InfoRow
                label="Matches Current Vault"
                value={isCompatible === null ? 'Unknown' : isCompatible ? 'Yes' : 'No'}
              />
            )}
            {freeMemory !== null && (
              <InfoRow label="Free Memory" value={`${freeMemory} bytes`} />
            )}
            {compatibilityError && (
              <p className="text-[12px] text-warn">{compatibilityError}</p>
            )}
          </div>
        )}

        {uid && isInit && (
          <div className="flex flex-wrap gap-2">
            <ActionBtn onClick={handleFetchMemory} disabled={!isNfcConnected}>
              <MemoryStick className="w-4 h-4" />
              Read Free Memory
            </ActionBtn>
            <ActionBtn onClick={handleFetchAids} disabled={!isNfcConnected}>
              <List className="w-4 h-4" />
              List AIDs
            </ActionBtn>
          </div>
        )}

        {aids !== null && (
          <div className="rounded-xl bg-well border border-edge p-4">
            <p className="text-[13px] text-lo mb-2">Application IDs on card</p>
            {aids.length === 0 ? (
              <p className="text-[13px] text-hi italic">No AIDs found</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {aids.map((aid, i) => (
                  <li key={i} className="text-[13px] text-hi font-mono">
                    {aid}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      {/* ── Init section ── */}
      <Section title="Initialise Card">
        <div className="flex items-start gap-3 rounded-xl bg-well border border-edge p-4">
          {isInit === true && isCompatible === true ? (
            <>
              <ShieldCheck className="w-5 h-5 text-ok shrink-0 mt-0.5" />
              <div>
                <p className="text-[14px] font-semibold text-ok">Card is ready for this vault</p>
                <p className="text-[13px] text-lo mt-0.5">
                  This card is linked to this vault. Tap it to unlock entries.
                </p>
              </div>
            </>
          ) : isInit === true && isCompatible === false ? (
            <>
              <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
              <div>
                <p className="text-[14px] font-semibold text-warn">Card belongs to a different vault</p>
                <p className="text-[13px] text-lo mt-0.5">
                  If you are signing into an existing synced account, use the card already used by that account.
                  Only initialize here for a brand-new or empty vault.
                </p>
              </div>
            </>
          ) : isInit === true ? (
            <>
              <AlertTriangle className="w-5 h-5 text-mid shrink-0 mt-0.5" />
              <div>
                <p className="text-[14px] font-semibold text-mid">Card detected, compatibility unknown</p>
                <p className="text-[13px] text-lo mt-0.5">
                  Keep the card on the reader and press Probe again to verify this card matches the current vault.
                </p>
              </div>
            </>
          ) : (
            <>
              <ShieldX className="w-5 h-5 text-lo shrink-0 mt-0.5" />
              <div>
                <p className="text-[14px] font-semibold text-mid">Card not initialised</p>
                <p className="text-[13px] text-lo mt-0.5">
                  Initialise to link this card to the current vault. If you already have a synced account,
                  use that account's existing card instead of creating a new one.
                </p>
              </div>
            </>
          )}
        </div>

        {(isInit !== true || isCompatible === false) && (
          <div className="flex flex-col gap-2">
            {isCompatible === false && (
              <p className="text-[12px] text-warn">
                Re-initializing changes this card&apos;s vault secret. Use this only if the vault is new/empty.
              </p>
            )}
            <div className="flex items-center gap-3">
            <ActionBtn
              onClick={handleInit}
              disabled={!isNfcConnected || initState === 'busy'}
              className={highlightInitAction ? 'guide-click-target' : ''}
              dataGuideItem="card-init"
            >
              <Wifi className="w-4 h-4" />
              {isCompatible === false ? 'Initialize for This Vault' : 'Initialise Card'}
            </ActionBtn>
            <Badge state={initState} label={initMsg} />
            </div>
          </div>
        )}
      </Section>

      {/* ── Format section ── */}
      <Section title="Format Card">
        <div className="flex items-start gap-3 rounded-xl bg-err-soft border border-err-edge p-4">
          <AlertTriangle className="w-5 h-5 text-err shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-semibold text-err">Destructive operation</p>
            <p className="text-[13px] text-lo mt-0.5">
              Formats only the tapped card to factory state. Vault data on this device is not deleted.
            </p>
          </div>
        </div>

        {!confirmFormat ? (
          <ActionBtn
            variant="destructive"
            onClick={() => { setConfirmFormat(true); setConfirmFormatText(''); }}
            disabled={!isNfcConnected || formatState === 'busy'}
          >
            <Trash2 className="w-4 h-4" />
            Format Card…
          </ActionBtn>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl bg-err-soft border border-err-edge p-4">
            <p className="text-[14px] font-semibold text-err">Are you absolutely sure?</p>
            <p className="text-[13px] text-lo">
              This card will be reset to factory state. Vault data on this device is not deleted.
              <span className="font-medium text-mid"> This cannot be undone.</span>
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] text-lo">
                Type{' '}
                <span className="font-mono font-semibold text-err">{CONFIRM_PHRASE}</span>
                {' '}to confirm:
              </label>
              <input
                type="text"
                value={confirmFormatText}
                onChange={e => setConfirmFormatText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                spellCheck={false}
                className="w-full bg-input border border-edge text-hi text-[14px] font-mono
                           px-3 py-2 rounded-lg outline-none
                           focus:border-err focus:ring-1 focus:ring-err/30
                           placeholder:text-dim/50 transition-all duration-150"
              />
            </div>
            <div className="flex gap-2">
              <ActionBtn
                variant="destructive"
                onClick={handleFormat}
                disabled={formatState === 'busy' || confirmFormatText !== CONFIRM_PHRASE}
              >
                <Trash2 className="w-4 h-4" />
                Yes, Format Card
              </ActionBtn>
              <ActionBtn onClick={() => { setConfirmFormat(false); setConfirmFormatText(''); }}>
                Cancel
              </ActionBtn>
            </div>
          </div>
        )}

        <Badge state={formatState} label={formatMsg} />
      </Section>

      </div>
      {/* TapCardOverlay */}
      {tapOverlay && (
        <TapCardOverlay message={tapOverlay.message} onCancel={handleCancelTap} />
      )}
    </div>
  );
};
