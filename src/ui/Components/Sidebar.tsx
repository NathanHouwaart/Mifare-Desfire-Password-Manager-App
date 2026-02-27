import { useEffect, useState, type ElementType } from 'react';
import { NavLink } from 'react-router-dom';
import { KeyRound, Shuffle, Cpu, CreditCard, Settings, Info, ShieldCheck, Lock, Cloud, CloudOff, CloudCheck, CloudAlert } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/passwords', icon: KeyRound,   label: 'Passwords'  },
  { to: '/generator', icon: Shuffle,    label: 'Generator'  },
  { to: '/card',      icon: CreditCard, label: 'Card'       },
  { to: '/nfc',       icon: Cpu,        label: 'NFC Reader' },
  { to: '/settings',  icon: Settings,   label: 'Settings'   },
  { to: '/about',     icon: Info,       label: 'About'      },
];

interface SidebarProps {
  onLock: () => void;
  isNfcConnected: boolean;
  onOpenSync: () => void;
}

export const Sidebar = ({ onLock, isNfcConnected, onOpenSync }: SidebarProps) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);

  useEffect(() => {
    const poll = async () => {
      try { setSyncStatus(await window.electron['sync:getStatus']()); }
      catch { /* ignore */ }
    };
    void poll();
    const id = setInterval(() => void poll(), 6000);
    return () => clearInterval(id);
  }, []);

  const syncMode = (localStorage.getItem('setting-sync-mode') ?? 'local') as 'local' | 'synced';

  // Right-side status icon + colour for the Sync button
  let StatusIcon: ElementType;
  let statusCls: string;
  let syncTitle: string;
  if (syncMode === 'local') {
    StatusIcon = CloudOff;
    statusCls  = 'text-dim';
    syncTitle  = 'Local only — click to set up sync';
  } else if (syncStatus?.loggedIn) {
    StatusIcon = CloudCheck;
    statusCls  = 'text-ok';
    syncTitle  = `Synced · ${syncStatus.username ?? ''}`;
  } else if (syncStatus?.configured) {
    StatusIcon = CloudAlert;
    statusCls  = 'text-warn';
    syncTitle  = 'Sync configured but not logged in';
  } else {
    StatusIcon = CloudOff;
    statusCls  = 'text-dim';
    syncTitle  = 'Sync not configured';
  }

  return (
    <aside className="w-[220px] shrink-0 flex flex-col bg-nav border-r border-well h-full">

      {/* App header */}
      <div className="p-5 border-b border-well shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl
                          flex items-center justify-center shrink-0
                          shadow-[0_2px_12px_rgba(99,102,241,0.35)]">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-hi leading-tight">SecurePass</h1>
            <p className="text-[12px] text-lo leading-tight mt-0.5">NFC Password Manager</p>
          </div>
        </div>
      </div>

      {/* NFC connection status */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-well shrink-0">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300 ${
          isNfcConnected ? 'bg-ok' : 'bg-err opacity-70'
        }`} />
        <span className={`text-[14px] font-medium transition-colors duration-300 ${
          isNfcConnected ? 'text-ok' : 'text-lo'
        }`}>
          {isNfcConnected ? 'NFC Connected' : 'NFC Disconnected'}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2 pt-3 flex-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3.5 rounded-xl text-[16px] font-medium
               select-none active:scale-[0.97] transition-all duration-100
               ${isActive
                 ? 'bg-accent-soft text-accent border border-accent-edge'
                 : 'text-mid hover:text-hi hover:bg-input border border-transparent'
               }`
            }
          >
            <Icon className="w-[17px] h-[17px] shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="px-2 pb-3 pt-2 border-t border-well shrink-0 flex flex-col gap-0.5">

        {/* Sync button */}
        <button
          onClick={onOpenSync}
          title={syncTitle}
          className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-[16px] font-medium
                     text-mid border border-transparent select-none
                     hover:text-accent hover:bg-accent-soft hover:border-accent-edge
                     active:scale-[0.97] transition-all duration-100"
        >
          <Cloud className="w-[17px] h-[17px] shrink-0" />
          <span className="flex-1 text-left">Sync</span>
          <StatusIcon className={`w-[15px] h-[15px] shrink-0 transition-colors ${statusCls}`} />
        </button>

        {/* Lock button */}
        <button
          onClick={onLock}
          className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-[16px] font-medium
                     text-lo border border-transparent select-none
                     hover:text-err hover:bg-err-soft hover:border-err-edge
                     active:scale-[0.97] transition-all duration-100"
        >
          <Lock className="w-[17px] h-[17px] shrink-0" />
          Lock Vault
        </button>

      </div>

    </aside>
  );
};
