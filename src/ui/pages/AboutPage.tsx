import { ShieldCheck } from 'lucide-react';

export const AboutPage = () => (
  <div className="px-6 py-6 max-w-2xl w-full mx-auto">
    <div className="flex items-start gap-4 mb-6">
      <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent-edge
                      flex items-center justify-center shrink-0 mt-0.5">
        <ShieldCheck className="w-5 h-5 text-accent" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-hi leading-tight">About</h1>
        <p className="text-[14px] text-lo mt-0.5">Password Manager · v0.1.0</p>
      </div>
    </div>

    <div className="bg-card border border-edge rounded-2xl p-6 flex flex-col items-center text-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-accent-soft border border-accent-edge
                      flex items-center justify-center">
        <ShieldCheck className="w-8 h-8 text-accent" />
      </div>

      <div>
        <h2 className="text-[18px] font-semibold text-hi">Password Manager</h2>
        <p className="text-[15px] text-lo mt-1">Version 0.1.0</p>
      </div>

      <p className="text-[16px] text-lo leading-relaxed max-w-xs">
        A secure, NFC-backed password manager built with Electron, React,
        and a native C++ DESFire module.
      </p>

      <div className="w-full border-t border-edge pt-4 grid grid-cols-2 gap-3 text-left">
        {[
          ['Framework',  'Electron + React'],
          ['UI',         'Tailwind CSS v4'],
          ['Native',     'C++ / Node-API'],
          ['NFC',        'PN532 / DESFire'],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[13px] text-dim uppercase tracking-wider">{label}</p>
            <p className="text-[16px] text-mid mt-0.5">{value}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);
