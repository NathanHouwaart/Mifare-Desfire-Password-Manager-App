import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Search, Plus, Eye, EyeOff, Copy, Check,
  KeyRound, Trash2, Pencil, X, RefreshCw, ArrowUpDown,
  Shield, AlertCircle, Loader2, AtSign,
} from 'lucide-react';
import { TapCardOverlay } from '../Components/TapCardOverlay';

// ── Types ────────────────────────────────────────────────────────────────────

interface ModalFormEntry {
  service:     string;   // → label
  url:         string;
  username:    string;
  password:    string;
  description: string;   // → notes
  category:    string;
}

type SortKey = 'name-asc' | 'name-desc' | 'newest' | 'oldest';

// ── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_GRADIENTS = [
  'from-indigo-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
  'from-sky-500 to-blue-600',
  'from-green-500 to-emerald-600',
];

function avatarGradient(service: string): string {
  let hash = 0;
  for (const c of service) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function genPassword(): string {
  const pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const arr = new Uint32Array(18);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => pool[n % pool.length]).join('');
}

const SORT_LABELS: Record<SortKey, string> = {
  'name-asc':  'Name (A-Z)',
  'name-desc': 'Name (Z-A)',
  'newest':    'Newest',
  'oldest':    'Oldest',
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return `${diffDays}d ago`;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined });
}

const CATEGORY_OPTIONS = ['Development', 'Email', 'Finance', 'Social', 'Gaming', 'Work', 'Other'];

const CATEGORY_COLORS = {
  dark: {
    'Development': 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20',
    'Email':       'bg-blue-500/15 text-blue-300 border-blue-500/20',
    'Finance':     'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    'Social':      'bg-violet-500/15 text-violet-300 border-violet-500/20',
    'Gaming':      'bg-orange-500/15 text-orange-300 border-orange-500/20',
    'Work':        'bg-amber-500/15 text-amber-300 border-amber-500/20',
  },
  light: {
    'Development': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'Email':       'bg-blue-100 text-blue-700 border-blue-200',
    'Finance':     'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Social':      'bg-violet-100 text-violet-700 border-violet-200',
    'Gaming':      'bg-orange-100 text-orange-700 border-orange-200',
    'Work':        'bg-amber-100 text-amber-700 border-amber-200',
  },
} as const;
function categoryColor(cat: string, theme: 'dark' | 'light'): string {
  const map = CATEGORY_COLORS[theme] as Record<string, string>;
  return map[cat] ?? (theme === 'light'
    ? 'bg-zinc-100 text-zinc-600 border-zinc-200'
    : 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20');
}

// Shared grid template — breakpoints match hidden-column breakpoints (sm: username, md: date)
const ROW_GRID =
  'grid items-center gap-x-4 ' +
  'grid-cols-[2.5rem_minmax(0,1fr)_12rem] ' +
  'sm:grid-cols-[2.5rem_minmax(0,2fr)_minmax(0,1.5fr)_12rem] sm:gap-x-5 ' +
  'md:grid-cols-[2.5rem_minmax(0,2fr)_minmax(0,1.5fr)_8rem_12rem] md:gap-x-6';

// ── Shared primitives ────────────────────────────────────────────────────────

const INPUT_CLS =
  'w-full bg-input border border-edge text-hi text-[16px] px-4 py-3 rounded-xl outline-none ' +
  'focus:border-accent-edge focus:ring-1 focus:ring-accent-soft transition-all duration-150';

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="text-[13px] text-lo font-medium block mb-1.5">{label}</label>
    {children}
  </div>
);

const ActionBtn = ({
  onClick, title, danger, children,
}: {
  onClick: () => void; title: string; danger?: boolean; children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-100
                active:scale-90 focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-accent-edge
                ${danger
                  ? 'text-mid hover:text-err hover:bg-err-soft'
                  : 'text-mid hover:text-hi hover:bg-input'}`}
  >
    {children}
  </button>
);

// ── Entry Modal (add / edit) ─────────────────────────────────────────────────

const EntryModal = ({
  initial, onSave, onClose,
}: {
  initial: ModalFormEntry | null;
  onSave: (data: ModalFormEntry) => Promise<void>;
  onClose: () => void;
}) => {
  const [form, setForm] = useState<ModalFormEntry>(
    initial ?? { service: '', url: '', username: '', password: '', description: '', category: '' },
  );
  const [showPw,  setShowPw]  = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const set = (k: keyof ModalFormEntry) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const valid = form.service.trim() && form.username.trim() && form.password.trim();

  const handleSubmit = async () => {
    if (!valid) return;
    setSaving(true); setSaveErr(null);
    try { await onSave(form); }
    catch (err) { setSaveErr(err instanceof Error ? err.message : String(err)); setSaving(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="bg-card border border-edge rounded-2xl w-full max-w-md shadow-2xl
                      animate-[fadeSlideUp_0.2s_ease-out]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
          <h2 className="text-[18px] font-semibold text-hi">
            {initial ? 'Edit Entry' : 'New Entry'}
          </h2>
          <button
            onClick={onClose} disabled={saving}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-dim
                       hover:text-hi hover:bg-input active:scale-90 transition-all duration-100
                       disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          <Field label="Service / Website *">
            <input value={form.service} onChange={set('service')} placeholder="e.g. GitHub"
                   disabled={saving} className={INPUT_CLS} />
          </Field>
          <Field label="URL">
            <input value={form.url} onChange={set('url')} placeholder="e.g. https://github.com"
                   disabled={saving} className={INPUT_CLS} />
          </Field>
          <Field label="Username / Email *">
            <input value={form.username} onChange={set('username')} placeholder="e.g. user@example.com"
                   disabled={saving} className={INPUT_CLS} />
          </Field>
          <Field label="Password *">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input value={form.password} onChange={set('password')}
                       type={showPw ? 'text' : 'password'} placeholder="••••••••••••"
                       disabled={saving} className={`${INPUT_CLS} pr-11 font-mono`} />
                <button
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dim
                             hover:text-bright transition-colors duration-100"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={() => setForm(f => ({ ...f, password: genPassword() }))}
                title="Generate password" disabled={saving}
                className="px-3.5 rounded-xl bg-input border border-edge text-dim
                           hover:text-accent hover:border-accent-edge
                           active:scale-95 transition-all duration-100 disabled:opacity-40"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </Field>
          <Field label="Notes">
            <textarea
              value={form.description}
              onChange={set('description')}
              placeholder="e.g. Personal dev account, 2FA enabled"
              rows={2} disabled={saving}
              className={`${INPUT_CLS} resize-none`}
            />
          </Field>
          <Field label="Category">
            <select
              value={form.category}
              onChange={set('category')}
              disabled={saving}
              className={INPUT_CLS}
            >
              <option value="">— Uncategorized —</option>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {saveErr && (
            <div className="flex items-start gap-2 rounded-xl bg-err-soft border border-err-edge p-3">
              <AlertCircle className="w-4 h-4 text-err shrink-0 mt-0.5" />
              <p className="text-[13px] text-err">{saveErr}</p>
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-5">
          <button onClick={onClose} disabled={saving}
                  className="flex-1 py-3 rounded-xl text-[16px] font-medium text-lo
                             bg-input border border-edge hover:text-hi
                             active:scale-[0.98] transition-all duration-100 disabled:opacity-40">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!valid || saving}
                  className="flex-1 py-3 rounded-xl text-[16px] font-medium text-white
                             bg-accent-solid hover:bg-accent-hover disabled:opacity-40
                             disabled:cursor-not-allowed active:scale-[0.98] transition-all duration-100
                             flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {initial ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Delete Confirmation ──────────────────────────────────────────────────────

const DeleteDialog = ({
  entry, onConfirm, onClose,
}: {
  entry: EntryListItemDto; onConfirm: () => void; onClose: () => void;
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}
  >
    <div className="bg-card border border-edge rounded-2xl w-full max-w-sm shadow-2xl p-6
                    flex flex-col gap-4 animate-[fadeSlideUp_0.2s_ease-out]">
      <div className="w-12 h-12 rounded-2xl bg-err-soft border border-err-edge
                      flex items-center justify-center">
        <Trash2 className="w-6 h-6 text-err" />
      </div>
      <div>
        <h2 className="text-[18px] font-semibold text-hi">Delete Entry?</h2>
        <p className="text-[15px] text-lo mt-1 leading-relaxed">
          Remove <span className="text-hi font-medium">{entry.label}</span> from your vault?
          This cannot be undone.
        </p>
      </div>
      <div className="flex gap-3">
        <button onClick={onClose}
                className="flex-1 py-3 rounded-xl text-[16px] font-medium text-lo
                           bg-input border border-edge hover:text-hi
                           active:scale-[0.98] transition-all duration-100">
          Cancel
        </button>
        <button onClick={onConfirm}
                className="flex-1 py-3 rounded-xl text-[16px] font-medium text-white
                           bg-red-500 hover:bg-red-600 active:scale-[0.98] transition-all duration-100">
          Delete
        </button>
      </div>
    </div>
  </div>
);

// ── Password Row ─────────────────────────────────────────────────────────────

interface PasswordCardProps {
  entry:             EntryListItemDto;
  decrypted:         EntryPayloadDto | null;
  isRevealed:        boolean;
  copiedId:          string | null;
  copiedUsernameId:  string | null;
  revealCopiedField: 'user' | 'pw' | null;
  /** 0–1 fraction of reveal time remaining; null = no auto-hide timer */
  revealProgress:    number | null;
  revealSecsLeft:    number | null;
  onRevealToggle:    () => void;
  onCopyClick:       () => void;
  onCopyUsernameClick: () => void;
  onCopyUsername:    () => void;
  onCopyPassword:    () => void;
  onEdit:            () => void;
  onDelete:          () => void;
  theme:             'dark' | 'light';
}

const PasswordCard = ({
  entry, decrypted, isRevealed, copiedId, copiedUsernameId, revealCopiedField,
  revealProgress, revealSecsLeft,
  onRevealToggle, onCopyClick, onCopyUsernameClick, onCopyUsername, onCopyPassword, onEdit, onDelete, theme,
}: PasswordCardProps) => (
  <div className="border-b border-edge last:border-b-0 hover:bg-input transition-colors duration-100">

    {/* ── Main row ── */}
    <div className={`${ROW_GRID} px-5 py-4`}>

      {/* Avatar */}
      <div
        className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarGradient(entry.label)}
                    flex items-center justify-center text-[15px] font-bold text-white shrink-0`}
      >
        {entry.label[0]?.toUpperCase() ?? '?'}
      </div>

      {/* Label + URL + Category */}
      <div className="min-w-0">
        <p className="text-[17px] font-semibold text-hi truncate leading-tight">{entry.label}</p>
        {entry.url
          ? <p className="text-[13px] text-lo truncate mt-0.5 leading-snug">{entry.url}</p>
          : <p className="text-[13px] text-dim truncate mt-0.5 italic leading-snug">No URL</p>
        }
        {entry.category && (
          <span className={`inline-flex items-center mt-1.5 border rounded px-1.5 py-0.5
                            text-[11px] font-semibold uppercase tracking-wide
                            ${categoryColor(entry.category, theme)}`}>
            {entry.category}
          </span>
        )}
      </div>

      {/* Username — masked until decrypted */}
      <div className="min-w-0 hidden sm:flex sm:items-center sm:border-l sm:border-edge/40 sm:pl-2">
        <span
          className="inline-flex items-center bg-input border border-edge rounded-md
                     px-2 py-0.5 max-w-full"
          title={decrypted ? decrypted.username : 'Tap card to view'}
        >
          <span className={`text-[15px] font-medium truncate ${decrypted ? 'text-mid' : 'text-dim italic'}`}>
            {decrypted ? decrypted.username : 'Tap to view'}
          </span>
        </span>
      </div>

      {/* Last edited */}
      <div className="hidden md:block md:border-l md:border-edge/40 md:pl-2">
        <p className="text-[14px] text-mid">{formatDate(entry.updatedAt)}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 justify-end border-l border-edge/40 pl-2">
        <button
          onClick={onRevealToggle}
          aria-label={isRevealed ? 'Hide password' : 'Show password'}
          aria-pressed={isRevealed}
          title={isRevealed ? 'Hide password' : 'Show password'}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-100
                      active:scale-90 focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-accent-edge
                      ${isRevealed
                        ? 'text-accent bg-accent-soft'
                        : 'text-mid hover:text-hi hover:bg-well'}`}
        >
          {isRevealed ? <EyeOff className="w-[17px] h-[17px]" /> : <Eye className="w-[17px] h-[17px]" />}
        </button>

        {/* Copy username */}
        <button
          onClick={onCopyUsernameClick}
          aria-label={copiedUsernameId === entry.id ? 'Username copied' : 'Copy username'}
          title={copiedUsernameId === entry.id ? 'Username copied' : 'Copy username'}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-100
                      active:scale-90 focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-accent-edge
                      ${copiedUsernameId === entry.id
                        ? 'text-ok bg-ok-soft'
                        : 'text-mid hover:text-hi hover:bg-well'}`}
        >
          {copiedUsernameId === entry.id
            ? <Check className="w-[17px] h-[17px]" />
            : <AtSign className="w-[17px] h-[17px]" />}
        </button>

        {/* Copy password */}
        <button
          onClick={onCopyClick}
          aria-label={copiedId === entry.id ? 'Password copied' : 'Copy password'}
          title={copiedId === entry.id ? 'Password copied' : 'Copy password'}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-100
                      active:scale-90 focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-accent-edge
                      ${copiedId === entry.id
                        ? 'text-ok bg-ok-soft'
                        : 'text-mid hover:text-hi hover:bg-well'}`}
        >
          {copiedId === entry.id
            ? <Check className="w-[17px] h-[17px]" />
            : <Copy  className="w-[17px] h-[17px]" />}
        </button>
        {(copiedUsernameId === entry.id || copiedId === entry.id) && (
          <span className="text-[12px] text-ok font-semibold shrink-0
                           animate-[fadeSlideUp_0.15s_ease-out]">
            {copiedUsernameId === entry.id ? 'Username copied!' : 'Copied!'}
          </span>
        )}

        <ActionBtn onClick={onEdit}   title="Edit entry"><Pencil className="w-[17px] h-[17px]" /></ActionBtn>
        <ActionBtn onClick={onDelete} title="Delete entry" danger><Trash2 className="w-[17px] h-[17px]" /></ActionBtn>
      </div>
    </div>

    {/* ── Revealed credentials panel ── */}
    {isRevealed && decrypted && (
      <div className="px-5 pb-4 animate-[fadeSlideUp_0.15s_ease-out]" aria-live="polite">
        <div className="flex flex-col gap-1 bg-well border border-accent-edge rounded-xl px-4 py-3">
          <button
            onClick={onCopyUsername}
            title="Click to copy username"
            className="flex items-center gap-2 group w-full text-left rounded-lg
                       hover:bg-accent-soft/30 -mx-1 px-1 py-1
                       transition-colors duration-100
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-edge"
          >
            <span className="text-[12px] text-lo font-semibold w-20 shrink-0">USERNAME</span>
            <p className="font-mono text-[14px] text-hi select-all flex-1 break-all">{decrypted.username}</p>
            <span className="shrink-0 flex items-center gap-1 justify-end">
              {revealCopiedField === 'user'
                ? <>
                    <Check className="w-3.5 h-3.5 text-ok" />
                    <span className="text-[12px] text-ok font-semibold animate-[fadeSlideUp_0.15s_ease-out]">Copied!</span>
                  </>
                : <Copy className="w-3.5 h-3.5 text-dim opacity-0 group-hover:opacity-100 transition-opacity" />}
            </span>
          </button>
          <button
            onClick={onCopyPassword}
            title="Click to copy password"
            className="flex items-center gap-2 group w-full text-left rounded-lg
                       hover:bg-accent-soft/30 -mx-1 px-1 py-1
                       transition-colors duration-100
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-edge"
          >
            <span className="text-[12px] text-lo font-semibold w-20 shrink-0">PASSWORD</span>
            <p className="font-mono text-[14px] text-hi select-all flex-1 break-all">{decrypted.password}</p>
            <span className="shrink-0 flex items-center gap-1 justify-end">
              {revealCopiedField === 'pw'
                ? <>
                    <Check className="w-3.5 h-3.5 text-ok" />
                    <span className="text-[12px] text-ok font-semibold animate-[fadeSlideUp_0.15s_ease-out]">Copied!</span>
                  </>
                : <Copy className="w-3.5 h-3.5 text-dim opacity-0 group-hover:opacity-100 transition-opacity" />}
            </span>
          </button>
          {decrypted.notes && (
            <div className="flex items-start gap-2 pt-1 border-t border-edge mt-1">
              <span className="text-[12px] text-lo font-semibold w-20 shrink-0 mt-px">NOTES</span>
              <p className="text-[14px] text-mid flex-1 whitespace-pre-wrap">{decrypted.notes}</p>
            </div>
          )}

          {/* ── Countdown bar ── */}
          {revealProgress !== null && revealSecsLeft !== null && (
            <div className="pt-2 mt-1 border-t border-edge/50">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-edge overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-[80ms] ease-linear
                                ${
                                  revealProgress > 0.5 ? 'bg-accent-solid'
                                  : revealProgress > 0.25 ? 'bg-warn'
                                  : 'bg-err'
                                }`}
                    style={{ width: `${revealProgress * 100}%` }}
                  />
                </div>
                <span className={`text-[11px] font-mono font-semibold shrink-0 w-6 text-right
                                  ${
                                    revealProgress > 0.5 ? 'text-accent'
                                    : revealProgress > 0.25 ? 'text-warn'
                                    : 'text-err'
                                  }`}>
                  {revealSecsLeft}s
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
  </div>
);

// ── Main Page ────────────────────────────────────────────────────────────────

export const PasswordsPage = ({ theme = 'dark' }: { theme?: 'dark' | 'light' }) => {
  const [entries,        setEntries]        = useState<EntryListItemDto[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [loadError,      setLoadError]      = useState<string | null>(null);

  const [revealedPayload, setRevealedPayload] = useState<EntryPayloadDto | null>(null);
  const [revealedId,      setRevealedId]      = useState<string | null>(null);
  const [copiedId,           setCopiedId]           = useState<string | null>(null);
  const [copiedUsernameId,   setCopiedUsernameId]   = useState<string | null>(null);
  const [copiedRevealField,  setCopiedRevealField]  = useState<{ id: string; field: 'user' | 'pw' } | null>(null);
  const [revealProgress,     setRevealProgress]     = useState<number | null>(null);
  const [revealSecsLeft,     setRevealSecsLeft]     = useState<number | null>(null);

  const [search,         setSearch]         = useState('');
  const [sort,           setSort]           = useState<SortKey>('name-asc');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const [tapOverlay,  setTapOverlay]  = useState<{ label: string } | null>(null);
  const [tapError,    setTapError]    = useState<string | null>(null);

  const [editTarget,   setEditTarget]   = useState<
    'new' | { entry: EntryListItemDto; decrypted: EntryPayloadDto } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<EntryListItemDto | null>(null);

  const cancelRef = useRef(false);

  // ── Load entries on mount ────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true); setLoadError(null);
      try {
        const list = await window.electron['vault:listEntries']();
        setEntries(list);
      } catch (err) { setLoadError(errMsg(err)); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  // ── Auto-hide + countdown bar ────────────────────────────────────────────
  // Read duration fresh on each reveal so settings changes take effect immediately.
  // Drives both the auto-hide timeout and the animated countdown bar.
  useEffect(() => {
    if (!revealedId) {
      setRevealProgress(null);
      setRevealSecsLeft(null);
      return;
    }
    const dur = parseInt(localStorage.getItem('setting-reveal-duration') ?? '5', 10);
    if (dur <= 0) {
      // 0 = "until hidden manually" — no bar, no auto-hide
      setRevealProgress(null);
      setRevealSecsLeft(null);
      return;
    }
    const total = dur * 1000;
    const start = Date.now();
    setRevealProgress(1);
    setRevealSecsLeft(dur);

    // Auto-hide timeout
    const hideTimer = setTimeout(() => {
      setRevealedId(null);
      setRevealedPayload(null);
    }, total);

    // Countdown interval (~50 ms ticks for smooth animation)
    const ticker = setInterval(() => {
      const elapsed  = Date.now() - start;
      const fraction = Math.max(0, 1 - elapsed / total);
      setRevealProgress(fraction);
      setRevealSecsLeft(Math.ceil(Math.max(0, total - elapsed) / 1000));
      if (fraction <= 0) clearInterval(ticker);
    }, 50);

    return () => {
      clearTimeout(hideTimer);
      clearInterval(ticker);
      setRevealProgress(null);
      setRevealSecsLeft(null);
    };
  }, [revealedId]);

  // ── withTap ─────────────────────────────────────────────────────────────
  const withTap = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    cancelRef.current = false;
    setTapOverlay({ label });
    setTapError(null);
    try { return await fn(); }
    catch (err) {
      if (!cancelRef.current) setTapError(errMsg(err));
      throw err;
    } finally { setTapOverlay(null); }
  }, []);

  const handleCancelTap = useCallback(() => {
    cancelRef.current = true;
    setTapOverlay(null);
    // Tell the main process to stop the polling loop immediately so it does
    // not keep firing InListPassiveTarget commands until PROBE_TIMEOUT_MS.
    window.electron['nfc:cancel']().catch(() => {});
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const refreshEntries = useCallback(async () => {
    const list = await window.electron['vault:listEntries']();
    setEntries(list);
  }, []);

  // ── Reveal toggle ────────────────────────────────────────────────────────
  // Always require a card tap to reveal — even if this entry was previously
  // shown. Hiding clears the decrypted payload so it cannot be re-shown
  // without another tap.
  const handleRevealToggle = useCallback(async (entry: EntryListItemDto) => {
    if (revealedId === entry.id) {
      setRevealedId(null);
      setRevealedPayload(null);
      return;
    }
    try {
      await withTap(`to reveal "${entry.label}"`, async () => {
        const payload = await window.electron['vault:getEntry'](entry.id);
        setRevealedPayload(payload);
        setRevealedId(entry.id);
      });
    } catch { /* tapError already set */ }
  }, [revealedId, withTap]);

  // ── Clipboard helper ───────────────────────────────────────────────────
  // Writes text to clipboard, then arms the auto-clear timer if configured.
  // Logs to console so you can verify the setting is being read at the right time.
  const copyToClipboard = useCallback(async (text: string) => {
    // Log first — before any async work — so we know the function was reached.
    const autoClear = localStorage.getItem('setting-autoclear') === 'true';
    const delay     = parseInt(localStorage.getItem('setting-autoclear-delay') ?? '30', 10);
    console.log('[clipboard] copyToClipboard called — autoClear =', autoClear,
      '| raw =', JSON.stringify(localStorage.getItem('setting-autoclear')),
      '| delay =', delay + 's');

    try {
      await navigator.clipboard.writeText(text);
      console.log('[clipboard] write succeeded');
    } catch (e) {
      console.warn('[clipboard] write failed:', e);
      throw e; // propagate so the caller can show an error
    }

    if (autoClear) {
      console.log(`[clipboard] auto-clear armed — will fire in ${delay}s`);
      setTimeout(async () => {
        console.log('[clipboard] auto-clear firing — checking clipboard content');
        try {
          // Only clear if the clipboard still contains what we put there.
          // If the user copied something else in the meantime, leave it alone.
          const current = await window.electron['clipboard:read']();
          if (current !== text) {
            console.log('[clipboard] auto-clear skipped — clipboard content has changed');
            return;
          }
        } catch (e) {
          console.warn('[clipboard] auto-clear read failed, clearing anyway:', e);
        }
        // Use the main-process IPC to clear — navigator.clipboard.writeText()
        // throws NotAllowedError when the document is not focused (Electron sandbox).
        window.electron['clipboard:clear']()
          .then(() => console.log('[clipboard] auto-clear succeeded'))
          .catch(e  => console.warn('[clipboard] auto-clear failed:', e));
      }, delay * 1000);
    } else {
      console.log('[clipboard] auto-clear is OFF — clipboard will not be cleared');
    }
  }, []);

  // ── Copy ─────────────────────────────────────────────────────────────────
  // Copy is free only while the entry is already revealed (no card removed
  // between reveal and copy). Any other copy requires a card tap; the
  // retrieved plaintext is used once and not stored.
  const handleCopyClick = useCallback(async (entry: EntryListItemDto) => {
    let payload: EntryPayloadDto | null =
      revealedId === entry.id ? revealedPayload : null;
    if (!payload) {
      try {
        await withTap(`to copy password for "${entry.label}"`, async () => {
          payload = await window.electron['vault:getEntry'](entry.id);
        });
      } catch { return; }
    }
    if (payload) {
      await copyToClipboard(payload.password);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  }, [revealedId, revealedPayload, withTap, copyToClipboard]);

  // ── Copy username (main row) ─────────────────────────────────────────────
  const handleCopyUsernameClick = useCallback(async (entry: EntryListItemDto) => {
    let payload: EntryPayloadDto | null =
      revealedId === entry.id ? revealedPayload : null;
    if (!payload) {
      try {
        await withTap(`to copy username for "${entry.label}"`, async () => {
          payload = await window.electron['vault:getEntry'](entry.id);
        });
      } catch { return; }
    }
    if (payload) {
      await copyToClipboard(payload.username);
      setCopiedUsernameId(entry.id);
      setTimeout(() => setCopiedUsernameId(null), 1500);
    }
  }, [revealedId, revealedPayload, withTap, copyToClipboard]);

  // ── Inline reveal-panel copy (username or password, no extra card tap) ──
  const handleCopyRevealField = useCallback(async (field: 'user' | 'pw') => {
    if (!revealedId || !revealedPayload) return;
    const id   = revealedId;
    const text = field === 'user' ? revealedPayload.username : revealedPayload.password;
    await copyToClipboard(text);
    setCopiedRevealField({ id, field });
    setTimeout(() => setCopiedRevealField(null), 1500);
  }, [revealedId, revealedPayload, copyToClipboard]);

  // ── Edit (always requires a card tap) ───────────────────────────────────
  const handleEdit = useCallback(async (entry: EntryListItemDto) => {
    let decrypted: EntryPayloadDto | undefined;
    try {
      await withTap(`to decrypt "${entry.label}"`, async () => {
        decrypted = await window.electron['vault:getEntry'](entry.id);
      });
    } catch { return; }
    if (decrypted) setEditTarget({ entry, decrypted });
  }, [withTap]);

  // ── Save (second tap) ────────────────────────────────────────────────────
  const handleSave = useCallback(async (form: ModalFormEntry) => {
    if (editTarget === 'new') {
      const data: EntryCreateDto = {
        label: form.service, url: form.url, username: form.username,
        password: form.password, notes: form.description, category: form.category,
      };
      await withTap(`to add "${form.service}"`, async () => {
        await window.electron['vault:createEntry'](data);
        await refreshEntries();
      });
    } else if (editTarget) {
      const entryId = editTarget.entry.id;
      const data: EntryUpdateDto = {
        label: form.service, url: form.url, username: form.username,
        password: form.password, notes: form.description, category: form.category,
      };
      await withTap(`to save "${form.service}"`, async () => {
        await window.electron['vault:updateEntry'](entryId, data);
        await refreshEntries();
      });
    }
    setEditTarget(null);
  }, [editTarget, withTap, refreshEntries]);

  // ── Delete (no card needed) ──────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await window.electron['vault:deleteEntry'](id);
      setEntries(prev => prev.filter(e => e.id !== id));
      if (revealedId === id) { setRevealedId(null); setRevealedPayload(null); }
      if (copiedRevealField?.id === id) setCopiedRevealField(null);
      if (copiedUsernameId === id) setCopiedUsernameId(null);
    } catch (err) { setTapError(errMsg(err)); }
  }, [deleteTarget, revealedId, copiedRevealField, copiedUsernameId]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = [...new Set(entries.map(e => e.category).filter(Boolean))].sort();
    return ['All', ...cats];
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = entries.filter(e => {
      const matchSearch = !q || e.label.toLowerCase().includes(q) || (e.url ?? '').toLowerCase().includes(q);
      const matchCat    = categoryFilter === 'All' || e.category === categoryFilter;
      return matchSearch && matchCat;
    });
    list.sort((a, b) => {
      switch (sort) {
        case 'name-asc':  return a.label.localeCompare(b.label);
        case 'name-desc': return b.label.localeCompare(a.label);
        case 'newest':    return b.createdAt - a.createdAt;
        case 'oldest':    return a.createdAt - b.createdAt;
      }
    });
    return list;
  }, [entries, search, sort, categoryFilter]);

  const modalInitial = useMemo((): ModalFormEntry | null => {
    if (!editTarget || editTarget === 'new') return null;
    return {
      service:     editTarget.entry.label,
      url:         editTarget.entry.url ?? '',
      username:    editTarget.decrypted.username,
      password:    editTarget.decrypted.password,
      description: editTarget.decrypted.notes ?? '',
      category:    editTarget.entry.category ?? '',
    };
  }, [editTarget]);

  // ─── render ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex flex-col h-full max-w-6xl w-full mx-auto">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-well shrink-0">
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent-edge
                              flex items-center justify-center shrink-0 mt-0.5">
                <Shield className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-hi leading-tight">Password Vault</h1>
                <p className="text-[14px] text-lo mt-0.5">
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · Secured by MIFARE DESFire EV2
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-dim" />
              <input
                type="text"
                placeholder="Search vault…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-card border border-edge text-hi placeholder-[var(--color-dim)]
                           text-[17px] pl-11 pr-4 py-3 rounded-xl outline-none
                           focus:border-accent-edge focus:ring-1 focus:ring-accent-soft
                           transition-all duration-150"
              />
            </div>
            <div className="relative">
              <ArrowUpDown className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dim pointer-events-none" />
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                className="bg-card border border-edge text-hi text-[15px]
                           pl-10 pr-4 py-3 rounded-xl outline-none appearance-none cursor-pointer
                           focus:border-accent-edge transition-all duration-150"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category filter chips */}
          {categories.length > 1 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap
                               transition-all duration-100 border
                               ${categoryFilter === cat
                                 ? 'bg-accent-soft text-accent border-accent-edge'
                                 : 'bg-transparent text-lo border-edge hover:text-hi hover:border-edge2'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Tap error banner */}
          {tapError && (
            <div className="flex items-start gap-2 mt-3 rounded-xl bg-err-soft border border-err-edge p-3">
              <AlertCircle className="w-4 h-4 text-err shrink-0 mt-0.5" />
              <p className="text-[13px] text-err flex-1">{tapError}</p>
              <button onClick={() => setTapError(null)} className="text-err hover:text-hi shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center h-full gap-3 text-lo select-none">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-[16px]">Loading vault…</span>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center select-none">
              <AlertCircle className="w-8 h-8 text-err" />
              <p className="text-err text-[16px] font-medium">Failed to load vault</p>
              <p className="text-lo text-[14px] max-w-xs">{loadError}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center select-none">
              <div className="w-14 h-14 rounded-2xl bg-card border border-edge flex items-center justify-center">
                <KeyRound className="w-6 h-6 text-dim" />
              </div>
              <p className="text-lo text-[17px]">
                {search ? 'No results found' : 'No passwords yet'}
              </p>
              <p className="text-dim text-[15px]">
                {search ? 'Try a different search term' : 'Press + to add your first entry'}
              </p>
            </div>
          ) : (
            <div className="bg-card border border-edge rounded-2xl overflow-hidden">
              <div className={`${ROW_GRID} px-5 py-3 border-b border-edge bg-well/50`}>
                <div />
                <p className="text-[12px] font-semibold text-lo uppercase tracking-widest">Service</p>
                <p className="text-[12px] font-semibold text-lo uppercase tracking-widest hidden sm:block sm:border-l sm:border-edge/40 sm:pl-2">Username</p>
                <p className="text-[12px] font-semibold text-lo uppercase tracking-widest hidden md:block md:border-l md:border-edge/40 md:pl-2">Last Edited</p>
                <p className="text-[12px] font-semibold text-lo uppercase tracking-widest border-l border-edge/40 pl-2">Actions</p>
              </div>
              {filtered.map(entry => (
                <PasswordCard
                  key={entry.id}
                  entry={entry}
                  decrypted={revealedId === entry.id ? revealedPayload : null}
                  isRevealed={revealedId === entry.id}
                  copiedId={copiedId}
                  copiedUsernameId={copiedUsernameId}
                  revealCopiedField={copiedRevealField?.id === entry.id ? copiedRevealField.field : null}
                  revealProgress={revealedId === entry.id ? revealProgress : null}
                  revealSecsLeft={revealedId === entry.id ? revealSecsLeft : null}
                  onRevealToggle={() => handleRevealToggle(entry)}
                  onCopyClick={() => handleCopyClick(entry)}
                  onCopyUsernameClick={() => handleCopyUsernameClick(entry)}
                  onCopyUsername={() => handleCopyRevealField('user')}
                  onCopyPassword={() => handleCopyRevealField('pw')}
                  onEdit={() => handleEdit(entry)}
                  onDelete={() => setDeleteTarget(entry)}
                  theme={theme}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 shrink-0 flex items-center justify-between border-t border-well">
          <p className="text-[14px] text-dim">
            {filtered.length} of {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
          </p>
          <button
            onClick={() => setEditTarget('new')}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent-solid hover:bg-accent-hover
                       active:scale-95 rounded-2xl text-[15px] font-medium text-white
                       shadow-lg shadow-accent-soft transition-all duration-150"
          >
            <Plus className="w-4 h-4" />
            New Credential
          </button>
        </div>
      </div>

      {/* Modals */}
      {editTarget !== null && (
        <EntryModal
          initial={modalInitial}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          entry={deleteTarget}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Card tap overlay */}
      {tapOverlay && (
        <TapCardOverlay message={tapOverlay.label} onCancel={handleCancelTap} />
      )}
    </>
  );
};
