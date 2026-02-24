import { useState } from 'react';
import { RefreshCw, Copy, Check, KeyRound, User, Wand2 } from 'lucide-react';

// ── Word lists for username generator ────────────────────────────────────────

const ADJECTIVES = [
  'swift','bold','calm','dark','epic','fast','glad','holy','iron','jade',
  'keen','lone','mild','neat','odd','pale','quick','rare','sage','tall',
  'vast','warm','wild','zany','amber','brisk','crisp','dusty','eager','faint',
  'grand','harsh','icy','jolly','lunar','mossy','noble','outer','prime','quiet',
  'rusty','sleek','tidal','urban','vivid','wavy','young','azure','blunt','coded',
];

const NOUNS = [
  'wolf','hawk','bear','lynx','crow','fox','puma','kite','fern','oak',
  'reef','dusk','tide','peak','vale','moss','crag','gale','mist','frost',
  'pine','sage','ash','bay','dale','elm','fen','glen','heath','isle',
  'jet','knoll','loch','marsh','nook','orb','pool','ridge','spire','tor',
  'urn','vault','wick','yew','zero','atom','beam','core','deck','echo',
];

type UsernameStyle = 'readable' | 'professional' | 'random';

function rand(max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

function generateUsername(
  style: UsernameStyle,
  opts: { separator: string; capitalize: boolean; appendNumber: boolean },
): string {
  const sep = opts.separator;
  const cap = (s: string) => opts.capitalize ? s[0].toUpperCase() + s.slice(1) : s;

  if (style === 'readable') {
    const adj  = ADJECTIVES[rand(ADJECTIVES.length)];
    const noun = NOUNS[rand(NOUNS.length)];
    const num  = opts.appendNumber ? `${sep}${rand(100)}` : '';
    return `${cap(adj)}${sep}${cap(noun)}${num}`;
  }

  if (style === 'professional') {
    const first = ADJECTIVES[rand(ADJECTIVES.length)];     // reuse as "first name" feel
    const last  = NOUNS[rand(NOUNS.length)];
    const num   = opts.appendNumber ? `${rand(99) + 1}` : '';
    const base  = `${first[0]}${sep}${last}${num}`;
    return opts.capitalize ? base[0].toUpperCase() + base.slice(1) : base;
  }

  // random — alphanumeric slug
  const pool = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const len  = 8 + rand(5);
  const arr  = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => pool[n % pool.length]).join('');
}

// ── Shared primitives ────────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  example: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

const ToggleRow = ({ label, example, value, onChange }: ToggleRowProps) => (
  <button
    role="switch"
    aria-checked={value}
    onClick={() => onChange(!value)}
    className={`flex items-center justify-between px-4 py-4 rounded-xl border text-[16px]
                select-none active:scale-[0.99] transition-all duration-100
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset
                focus-visible:ring-accent-edge
                ${value
                  ? 'bg-accent-soft border-accent-edge text-hi'
                  : 'bg-card border-edge text-lo'}`}
  >
    <span>{label}</span>
    <div className="flex items-center gap-3">
      <span className="font-mono text-[14px] text-dim">{example}</span>
      <div className={`w-10 h-5 rounded-full flex items-center px-0.5 transition-colors duration-200
                       ${value ? 'bg-accent-solid' : 'bg-edge'}`}>
        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
                         ${value ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </div>
  </button>
);

const OutputCard = ({
  value, onCopy, onRegen, copied, mono = true,
}: {
  value: string; onCopy: () => void; onRegen: () => void;
  copied: boolean; mono?: boolean;
}) => (
  <div className="bg-card border border-edge rounded-2xl p-4 mb-6">
    <p className={`${mono ? 'font-mono' : ''} text-[18px] text-hi break-all leading-relaxed min-h-[3rem]`}>
      {value}
    </p>
    <div className="flex gap-2 mt-3">
      <button
        onClick={onCopy}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-input border border-edge
                   text-[15px] text-mid hover:text-bright hover:border-edge2
                   active:scale-95 transition-all duration-100 select-none"
      >
        {copied ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <button
        onClick={onRegen}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-input border border-edge
                   text-[15px] text-mid hover:text-bright hover:border-edge2
                   active:scale-95 transition-all duration-100 select-none"
      >
        <RefreshCw className="w-4 h-4" />
        Regenerate
      </button>
    </div>
  </div>
);

// ── Password generator ────────────────────────────────────────────────────────

const CHARS = {
  lower:   'abcdefghijklmnopqrstuvwxyz',
  upper:   'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?',
};

function generatePassword(length: number, opts: { upper: boolean; numbers: boolean; symbols: boolean }): string {
  let pool = CHARS.lower;
  if (opts.upper)   pool += CHARS.upper;
  if (opts.numbers) pool += CHARS.numbers;
  if (opts.symbols) pool += CHARS.symbols;
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => pool[n % pool.length]).join('');
}

const PasswordGenerator = () => {
  const [length,  setLength]  = useState(16);
  const [upper,   setUpper]   = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(false);
  const [password, setPassword] = useState(() => generatePassword(16, { upper: true, numbers: true, symbols: false }));
  const [copied, setCopied] = useState(false);

  const regenWith = (ov: { upper?: boolean; numbers?: boolean; symbols?: boolean; length?: number } = {}) => {
    setPassword(generatePassword(
      ov.length  ?? length,
      { upper: ov.upper ?? upper, numbers: ov.numbers ?? numbers, symbols: ov.symbols ?? symbols },
    ));
    setCopied(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <OutputCard value={password} onCopy={handleCopy} onRegen={() => regenWith()} copied={copied} mono />

      {/* Length slider */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[16px] text-mid">Length</label>
          <span className="text-[16px] font-mono text-accent">{length}</span>
        </div>
        <input type="range" min={8} max={64} value={length}
               onChange={e => { const n = Number(e.target.value); setLength(n); regenWith({ length: n }); }}
               className="w-full accent-accent-solid h-1.5 rounded-full cursor-pointer" />
        <div className="flex justify-between text-[13px] text-dim mt-1"><span>8</span><span>64</span></div>
      </div>

      {/* Character set toggles */}
      <div className="flex flex-col gap-2">
        <ToggleRow label="Uppercase letters" example="A-Z"  value={upper}   onChange={v => { setUpper(v);   regenWith({ upper: v });   }} />
        <ToggleRow label="Numbers"           example="0-9"  value={numbers} onChange={v => { setNumbers(v); regenWith({ numbers: v }); }} />
        <ToggleRow label="Symbols"           example="!@#$" value={symbols} onChange={v => { setSymbols(v); regenWith({ symbols: v }); }} />
      </div>
    </>
  );
};

// ── Username generator ────────────────────────────────────────────────────────

const STYLE_LABELS: Record<UsernameStyle, { label: string; description: string; example: string }> = {
  readable:     { label: 'Readable',     description: 'Adjective + noun',   example: 'SwiftWolf' },
  professional: { label: 'Professional', description: 'Initial + surname',  example: 'j.carter'  },
  random:       { label: 'Random',       description: 'Alphanumeric slug',  example: 'kx7mp2rq'  },
};

const SEPARATORS = [
  { value: '',  label: 'None'        },
  { value: '.', label: 'Dot  ( . )'  },
  { value: '-', label: 'Dash  ( - )' },
  { value: '_', label: 'Under ( _ )' },
];

const UsernameGenerator = () => {
  const [style,         setStyle]         = useState<UsernameStyle>('readable');
  const [separator,     setSeparator]     = useState('.');
  const [capitalize,    setCapitalize]    = useState(false);
  const [appendNumber,  setAppendNumber]  = useState(false);
  const [username, setUsername] = useState(() =>
    generateUsername('readable', { separator: '.', capitalize: false, appendNumber: false })
  );
  const [copied, setCopied] = useState(false);

  const regenWith = (ov: {
    style?: UsernameStyle; separator?: string;
    capitalize?: boolean; appendNumber?: boolean;
  } = {}) => {
    setUsername(generateUsername(
      ov.style        ?? style,
      {
        separator:    ov.separator    ?? separator,
        capitalize:   ov.capitalize   ?? capitalize,
        appendNumber: ov.appendNumber ?? appendNumber,
      },
    ));
    setCopied(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(username);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <OutputCard value={username} onCopy={handleCopy} onRegen={() => regenWith()} copied={copied} mono={false} />

      {/* Style picker */}
      <div className="mb-5">
        <p className="text-[14px] text-lo font-medium mb-2">Style</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(STYLE_LABELS) as UsernameStyle[]).map(s => {
            const { label, description, example } = STYLE_LABELS[s];
            const active = style === s;
            return (
              <button
                key={s}
                onClick={() => { setStyle(s); regenWith({ style: s }); }}
                className={`flex flex-col items-start px-3.5 py-3 rounded-xl border text-left
                            transition-all duration-100 active:scale-[0.98]
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-edge
                            ${active
                              ? 'bg-accent-soft border-accent-edge text-hi'
                              : 'bg-card border-edge text-lo hover:text-hi hover:border-edge2'}`}
              >
                <span className="text-[14px] font-semibold">{label}</span>
                <span className="text-[12px] text-dim mt-0.5">{description}</span>
                <span className={`font-mono text-[12px] mt-1.5 ${active ? 'text-accent' : 'text-dim'}`}>{example}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Separator — hidden for random style */}
      {style !== 'random' && (
        <div className="mb-5">
          <p className="text-[14px] text-lo font-medium mb-2">Separator</p>
          <div className="flex gap-2 flex-wrap">
            {SEPARATORS.map(({ value, label }) => (
              <button
                key={label}
                onClick={() => { setSeparator(value); regenWith({ separator: value }); }}
                className={`px-4 py-2 rounded-xl border text-[14px] font-mono transition-all duration-100
                            active:scale-95 focus-visible:outline-none focus-visible:ring-2
                            focus-visible:ring-accent-edge
                            ${separator === value
                              ? 'bg-accent-soft border-accent-edge text-hi'
                              : 'bg-card border-edge text-lo hover:text-hi hover:border-edge2'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Options */}
      <div className="flex flex-col gap-2">
        {style !== 'random' && (
          <ToggleRow
            label="Capitalize words"
            example="SwiftWolf"
            value={capitalize}
            onChange={v => { setCapitalize(v); regenWith({ capitalize: v }); }}
          />
        )}
        <ToggleRow
          label="Append a number"
          example="…42"
          value={appendNumber}
          onChange={v => { setAppendNumber(v); regenWith({ appendNumber: v }); }}
        />
      </div>
    </>
  );
};

// ── Page shell with tabs ──────────────────────────────────────────────────────

type Tab = 'password' | 'username';

export const GeneratorPage = () => {
  const [tab, setTab] = useState<Tab>('password');

  return (
    <div className="px-6 py-6 max-w-2xl w-full mx-auto">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent-edge
                        flex items-center justify-center shrink-0 mt-0.5">
          <Wand2 className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-hi leading-tight">Generator</h1>
          <p className="text-[14px] text-lo mt-0.5">Create secure passwords and usernames</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-well border border-edge rounded-2xl mb-6 w-fit">
        {([
          { id: 'password', Icon: KeyRound, label: 'Password' },
          { id: 'username', Icon: User,     label: 'Username' },
        ] as { id: Tab; Icon: React.ComponentType<{ className?: string }>; label: string }[]).map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[15px] font-medium
                        transition-all duration-150 select-none
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-edge
                        ${tab === id
                          ? 'bg-card border border-edge text-hi shadow-sm'
                          : 'text-lo hover:text-hi'}`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'password' ? <PasswordGenerator /> : <UsernameGenerator />}
    </div>
  );
};
