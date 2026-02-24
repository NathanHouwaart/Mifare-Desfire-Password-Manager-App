import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, Plus, Eye, EyeOff, Copy, Check,
  KeyRound, Trash2, Pencil, X, RefreshCw, ArrowUpDown,
  Shield,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface PasswordEntry {
  id: string;
  service: string;
  username: string;
  password: string;
  description: string;
  category: string;
  createdAt: number;
  updatedAt: number;
}

interface ModalEntry { service: string; username: string; password: string; description: string; category: string; }

type SortKey = 'name-asc' | 'name-desc' | 'username' | 'newest' | 'oldest';

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

function genId(): string { return Math.random().toString(36).slice(2, 10); }

function genPassword(): string {
  const pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const arr = new Uint32Array(18);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => pool[n % pool.length]).join('');
}

const SORT_LABELS: Record<SortKey, string> = {
  'name-asc':  'Name (A-Z)',
  'name-desc': 'Name (Z-A)',
  'username':  'Username',
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
  'md:grid-cols-[2.5rem_minmax(0,2fr)_minmax(0,1.5fr)_5.5rem_12rem] md:gap-x-6';

// Placeholder data — will be replaced by C++ DESFire storage
const INITIAL_PASSWORDS: PasswordEntry[] = [
  { id: genId(), service: 'GitHub',  username: 'nathandev',        password: 'Gh!x9#mK2pLq',  description: 'Personal dev account',    category: 'Development', createdAt: Date.now() - 86400000 * 5,  updatedAt: Date.now() - 86400000 * 1  },
  { id: genId(), service: 'Google',  username: 'nathan@gmail.com', password: 'G00gl3$ecure!', description: 'Main Google account',     category: 'Email',       createdAt: Date.now() - 86400000 * 3,  updatedAt: Date.now() - 86400000 * 3  },
  { id: genId(), service: 'Discord', username: 'NathanDev#4421',   password: 'Disc0rd@pass',   description: 'Gaming + dev communities', category: 'Gaming',      createdAt: Date.now() - 86400000 * 2,  updatedAt: Date.now() - 86400000 * 2  },
  { id: genId(), service: 'Netflix', username: 'nathan@gmail.com', password: 'Netfl!x2024#',  description: 'Family streaming plan',   category: 'Social',      createdAt: Date.now() - 86400000 * 1,  updatedAt: Date.now()                  },
  { id: genId(), service: 'AWS',     username: 'nathan.admin',     password: 'Aws!K9mP#3xZ',  description: 'Production AWS account',  category: 'Work',        createdAt: Date.now() - 86400000 * 10, updatedAt: Date.now() - 86400000 * 7  },
  { id: genId(), service: 'Spotify', username: 'nathandev',        password: 'Spot!fy#88mz',  description: 'Music + podcasts',        category: 'Social',      createdAt: Date.now() - 86400000 * 7,  updatedAt: Date.now() - 86400000 * 5  },
  { id: genId(), service: 'Twitter', username: '@nathandev',       password: 'Tw!tter#2024',  description: 'Dev & tech updates',      category: 'Social',      createdAt: Date.now() - 86400000 * 4,  updatedAt: Date.now() - 86400000 * 4  },
];

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
  initial: PasswordEntry | null;
  onSave: (data: ModalEntry) => void;
  onClose: () => void;
}) => {
  const [form, setForm] = useState<ModalEntry>(
    initial
      ? { service: initial.service, username: initial.username, password: initial.password, description: initial.description, category: initial.category }
      : { service: '', username: '', password: '', description: '', category: '' },
  );
  const [showPw, setShowPw] = useState(false);

  const set = (k: keyof ModalEntry) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const valid = form.service.trim() && form.username.trim() && form.password.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-edge rounded-2xl w-full max-w-md shadow-2xl
                      animate-[fadeSlideUp_0.2s_ease-out]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
          <h2 className="text-[18px] font-semibold text-hi">
            {initial ? 'Edit Entry' : 'New Entry'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-dim
                       hover:text-hi hover:bg-input active:scale-90 transition-all duration-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <Field label="Service / Website">
            <input value={form.service} onChange={set('service')} placeholder="e.g. GitHub"
                   className={INPUT_CLS} />
          </Field>
          <Field label="Username / Email">
            <input value={form.username} onChange={set('username')} placeholder="e.g. user@example.com"
                   className={INPUT_CLS} />
          </Field>
          <Field label="Password">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input value={form.password} onChange={set('password')}
                       type={showPw ? 'text' : 'password'} placeholder="••••••••••••"
                       className={`${INPUT_CLS} pr-11 font-mono`} />
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
                title="Generate password"
                className="px-3.5 rounded-xl bg-input border border-edge text-dim
                           hover:text-accent hover:border-accent-edge
                           active:scale-95 transition-all duration-100"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={form.description}
              onChange={set('description')}
              placeholder="e.g. Personal dev account, 2FA enabled"
              rows={2}
              className={`${INPUT_CLS} resize-none`}
            />
          </Field>
          <Field label="Category">
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className={INPUT_CLS}
            >
              <option value="">— Uncategorized —</option>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex gap-3 px-6 pb-5">
          <button onClick={onClose}
                  className="flex-1 py-3 rounded-xl text-[16px] font-medium text-lo
                             bg-input border border-edge hover:text-hi
                             active:scale-[0.98] transition-all duration-100">
            Cancel
          </button>
          <button onClick={() => valid && onSave(form)} disabled={!valid}
                  className="flex-1 py-3 rounded-xl text-[16px] font-medium text-white
                             bg-accent-solid hover:bg-accent-hover disabled:opacity-40
                             disabled:cursor-not-allowed active:scale-[0.98] transition-all duration-100">
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
  entry: PasswordEntry; onConfirm: () => void; onClose: () => void;
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
          Remove <span className="text-hi font-medium">{entry.service}</span> from your vault?
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
  entry: PasswordEntry;
  revealDuration: number;
  copiedId: string | null;
  onCopied: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  theme: 'dark' | 'light';
}

const PasswordCard = ({
  entry, revealDuration, copiedId, onCopied, onEdit, onDelete, theme,
}: PasswordCardProps) => {
  const [revealed, setRevealed] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startReveal = () => {
    if (revealed) {
      if (revealTimer.current) clearTimeout(revealTimer.current);
      setRevealed(false);
      return;
    }
    setRevealed(true);
    if (revealDuration > 0) {
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setRevealed(false), revealDuration * 1000);
    }
  };

  // Clear any running timer when this row unmounts
  useEffect(() => () => { if (revealTimer.current) clearTimeout(revealTimer.current); }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.password);
    onCopied(entry.id);
  };

  return (
    <div className="border-b border-edge last:border-b-0 hover:bg-input transition-colors duration-100">

      {/* ── Main row ── */}
      <div className={`${ROW_GRID} px-5 py-4`}>

        {/* Avatar */}
        <div
          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarGradient(entry.service)}
                      flex items-center justify-center text-[15px] font-bold text-white`}
        >
          {entry.service[0]?.toUpperCase() ?? '?'}
        </div>

        {/* Service + Description + Category tag */}
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-hi truncate leading-tight">{entry.service}</p>
          {entry.description
            ? <p className="text-[13px] text-lo truncate mt-0.5 leading-snug">{entry.description}</p>
            : <p className="text-[13px] text-dim truncate mt-0.5 italic leading-snug">No description</p>
          }
          {entry.category && (
            <span className={`inline-flex items-center mt-1.5 border rounded px-1.5 py-0.5
                              text-[11px] font-semibold uppercase tracking-wide
                              ${categoryColor(entry.category, theme)}`}>
              {entry.category}
            </span>
          )}
        </div>

        {/* Username */}
        <div className="min-w-0 hidden sm:block">
          <span
            className="inline-flex items-center bg-input border border-edge rounded-md
                       px-2 py-0.5 max-w-full"
            title={entry.username}
          >
            <span className="text-[15px] text-mid font-medium truncate">{entry.username}</span>
          </span>
        </div>

        {/* Last Edited */}
        <div className="hidden md:block">
          <p className="text-[14px] text-mid">{formatDate(entry.updatedAt)}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 justify-end">
          <button
            onClick={startReveal}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            title={revealed ? 'Hide password' : 'Show password'}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-100
                        active:scale-90 focus-visible:outline-none focus-visible:ring-2
                        focus-visible:ring-accent-edge
                        ${revealed
                          ? 'text-accent bg-accent-soft'
                          : 'text-mid hover:text-hi hover:bg-well'}`}
          >
            {revealed ? <EyeOff className="w-[17px] h-[17px]" /> : <Eye className="w-[17px] h-[17px]" />}
          </button>

          <button
            onClick={handleCopy}
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
          {copiedId === entry.id && (
            <span className="text-[12px] text-ok font-semibold shrink-0
                             animate-[fadeSlideUp_0.15s_ease-out]">Copied!</span>
          )}

          <ActionBtn onClick={onEdit} title="Edit entry">
            <Pencil className="w-[17px] h-[17px]" />
          </ActionBtn>
          <ActionBtn onClick={onDelete} title="Delete entry" danger>
            <Trash2 className="w-[17px] h-[17px]" />
          </ActionBtn>
        </div>
      </div>

      {/* ── Revealed password — full width below the row ── */}
      {revealed && (
        <div
          className="px-5 pb-4 animate-[fadeSlideUp_0.15s_ease-out]"
          aria-live="polite"
          aria-label="Revealed password"
        >
          <div className="flex items-center gap-3 bg-well border border-accent-edge rounded-xl px-4 py-3">
            <p className="font-mono text-[14px] text-hi select-all flex-1 break-all">
              {entry.password}
            </p>
            {copiedId === entry.id && (
              <span className="text-[12px] text-ok font-semibold shrink-0
                               animate-[fadeSlideUp_0.15s_ease-out]">Copied!</span>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

// ── Main Page ────────────────────────────────────────────────────────────────

export const PasswordsPage = ({ theme = 'dark' }: { theme?: 'dark' | 'light' }) => {
  const [entries,        setEntries]        = useState<PasswordEntry[]>(INITIAL_PASSWORDS);
  const [search,         setSearch]         = useState('');
  const [sort,           setSort]           = useState<SortKey>('name-asc');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [copiedId,       setCopiedId]       = useState<string | null>(null);
  const [editTarget,   setEditTarget]   = useState<PasswordEntry | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PasswordEntry | null>(null);

  // Read reveal duration once on page mount so each card row doesn't hit localStorage on every click
  const revealDuration = useMemo(
    () => parseInt(localStorage.getItem('setting-reveal-duration') ?? '5', 10),
    [],
  );

  const categories = useMemo(() => {
    const cats = [...new Set(entries.map(e => e.category).filter(Boolean))].sort() as string[];
    return ['All', ...cats];
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = entries.filter(e => {
      const matchSearch = !q || e.service.toLowerCase().includes(q) || e.username.toLowerCase().includes(q);
      const matchCat    = categoryFilter === 'All' || e.category === categoryFilter;
      return matchSearch && matchCat;
    });

    list.sort((a, b) => {
      switch (sort) {
        case 'name-asc':  return a.service.localeCompare(b.service);
        case 'name-desc': return b.service.localeCompare(a.service);
        case 'username':  return a.username.localeCompare(b.username);
        case 'newest':    return b.createdAt - a.createdAt;
        case 'oldest':    return a.createdAt - b.createdAt;
      }
    });
    return list;
  }, [entries, search, sort, categoryFilter]);

  const handleCopied = (id: string) => {
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSave = (data: ModalEntry) => {
    if (editTarget === 'new') {
      setEntries(prev => [...prev, { id: genId(), ...data, createdAt: Date.now(), updatedAt: Date.now() }]);
    } else if (editTarget) {
      setEntries(prev =>
        prev.map(e => e.id === (editTarget as PasswordEntry).id ? { ...e, ...data, updatedAt: Date.now() } : e),
      );
    }
    setEditTarget(null);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setEntries(prev => prev.filter(e => e.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

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
                className="w-full bg-card border border-edge text-hi
                           placeholder-[var(--color-dim)] text-[17px] pl-11 pr-4 py-3 rounded-xl
                           outline-none focus:border-accent-edge focus:ring-1 focus:ring-accent-soft
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
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filtered.length === 0 ? (
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
              {/* Column header */}
              <div className={`${ROW_GRID} px-5 py-3 border-b border-edge bg-well/50`}>
                <div />{/* avatar spacer */}
                <p className="text-[12px] font-semibold text-lo uppercase tracking-widest">Service</p>
                <p className="text-[12px] font-semibold text-lo uppercase tracking-widest hidden sm:block">Username</p>
                <p className="text-[12px] font-semibold text-lo uppercase tracking-widest hidden md:block">Last Edited</p>
                <p className="text-[12px] font-semibold text-lo uppercase tracking-widest text-right">Actions</p>
              </div>

              {filtered.map(entry => (
                <PasswordCard
                  key={entry.id}
                  entry={entry}
                  revealDuration={revealDuration}
                  copiedId={copiedId}
                  onCopied={handleCopied}
                  onEdit={() => setEditTarget(entry)}
                  onDelete={() => setDeleteTarget(entry)}
                  theme={theme}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer bar */}
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
          initial={editTarget === 'new' ? null : editTarget}
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
    </>
  );
};

