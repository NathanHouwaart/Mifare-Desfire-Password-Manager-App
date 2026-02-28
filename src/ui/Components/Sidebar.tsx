import { useEffect, useState, type ElementType } from 'react';
import { NavLink } from 'react-router-dom';
import {
  KeyRound,
  Shuffle,
  Cpu,
  CreditCard,
  Settings,
  Info,
  ShieldCheck,
  Lock,
  CloudOff,
  CloudCheck,
  CloudAlert,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/passwords', icon: KeyRound, label: 'Passwords', guideKey: 'passwords' },
  { to: '/generator', icon: Shuffle, label: 'Generator', guideKey: null },
  { to: '/card', icon: CreditCard, label: 'Card', guideKey: 'card' },
  { to: '/nfc', icon: Cpu, label: 'NFC Reader', guideKey: 'nfc' },
  { to: '/settings', icon: Settings, label: 'Settings', guideKey: null },
  { to: '/about', icon: Info, label: 'About', guideKey: null },
];

interface SidebarProps {
  onLock: () => void;
  isNfcConnected: boolean;
  onOpenSync: () => void;
  highlightSync?: boolean;
  highlightNfcNav?: boolean;
  highlightCardNav?: boolean;
  highlightPasswordsNav?: boolean;
}

export const Sidebar = ({
  onLock,
  isNfcConnected,
  onOpenSync,
  highlightSync = false,
  highlightNfcNav = false,
  highlightCardNav = false,
  highlightPasswordsNav = false,
}: SidebarProps) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        setSyncStatus(await window.electron['sync:getStatus']());
      } catch {
        // Ignore polling errors and keep the last known state.
      }
    };

    void poll();
    const id = setInterval(() => void poll(), 6000);
    const onSyncModeChanged = () => {
      void poll();
    };
    window.addEventListener('securepass:sync-mode-changed', onSyncModeChanged);

    return () => {
      clearInterval(id);
      window.removeEventListener('securepass:sync-mode-changed', onSyncModeChanged);
    };
  }, []);

  const syncMode = (localStorage.getItem('setting-sync-mode') ?? 'local') as 'local' | 'synced';

  let SyncStatusIcon: ElementType;
  let syncIconCls: string;
  let syncHintCls: string;
  let syncHint: string;
  let syncTitle: string;
  const nfcOnline = isNfcConnected;
  const nfcIconCls = nfcOnline ? 'text-ok' : 'text-lo';
  const nfcHintCls = nfcOnline ? 'text-ok' : 'text-dim';
  const nfcHint = nfcOnline ? 'Connected' : 'Disconnected';

  if (syncMode === 'local') {
    SyncStatusIcon = CloudOff;
    syncIconCls = 'text-dim';
    syncHintCls = 'text-dim';
    syncHint = 'Local';
    syncTitle = 'Local only - click to set up sync';
  } else if (syncStatus?.lastSyncError) {
    SyncStatusIcon = CloudAlert;
    syncIconCls = 'text-warn';
    syncHintCls = 'text-warn';
    syncHint = 'Error';
    syncTitle = `Sync error: ${syncStatus.lastSyncError}`;
  } else if (syncStatus?.loggedIn) {
    SyncStatusIcon = CloudCheck;
    syncIconCls = 'text-ok';
    syncHintCls = 'text-ok';
    syncHint = 'Connected';
    syncTitle = `Synced - ${syncStatus.username ?? ''}`;
  } else if (syncStatus?.configured) {
    SyncStatusIcon = CloudAlert;
    syncIconCls = 'text-warn';
    syncHintCls = 'text-warn';
    syncHint = 'Login';
    syncTitle = 'Sync configured but not logged in';
  } else {
    SyncStatusIcon = CloudOff;
    syncIconCls = 'text-dim';
    syncHintCls = 'text-dim';
    syncHint = 'Not Set';
    syncTitle = 'Sync not configured';
  }

  return (
    <aside className="w-[220px] shrink-0 flex flex-col bg-nav border-r border-well h-full">
      <div className="p-5 border-b border-well shrink-0">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl
                        flex items-center justify-center shrink-0
                        shadow-[0_2px_12px_rgba(99,102,241,0.35)]"
          >
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-hi leading-tight">SecurePass</h1>
            <p className="text-[12px] text-lo leading-tight mt-0.5">NFC Password Manager</p>
          </div>
        </div>
      </div>

      <div className="px-2 py-2 border-b border-well shrink-0">
        <div
          role="status"
          aria-live="polite"
          aria-label={`NFC reader ${nfcHint.toLowerCase()}`}
          className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-[16px] font-medium
                     border border-transparent select-none"
          title={`NFC ${nfcHint}`}
        >
          <Cpu className={`w-[17px] h-[17px] shrink-0 ${nfcIconCls}`} />
          <span className="flex-1 text-left text-mid">NFC</span>
          <span className={`text-[11px] ${nfcHintCls}`}>{nfcHint}</span>
        </div>
      </div>

      <div className="px-2 py-2 border-b border-well shrink-0">
        <button
          onClick={onOpenSync}
          title={syncTitle}
          aria-label={`${syncTitle}. Open backup and sync settings`}
          data-guide-item="sidebar-sync"
          className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-[16px] font-medium
                      text-mid border border-transparent select-none
                      hover:text-hi hover:bg-input active:scale-[0.97]
                      transition-all duration-100 ${highlightSync ? 'guide-click-target' : ''}`}
        >
          <SyncStatusIcon className={`w-[17px] h-[17px] shrink-0 ${syncIconCls}`} />
          <span className="flex-1 text-left">Sync</span>
          <span className={`text-[11px] ${syncHintCls}`}>{syncHint}</span>
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pt-3 flex-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label, guideKey }) => {
          const dataGuideItem =
            guideKey === 'nfc'
              ? 'sidebar-nfc'
              : guideKey === 'card'
                ? 'sidebar-card'
                : guideKey === 'passwords'
                  ? 'sidebar-passwords'
                  : undefined;
          const highlight =
            (guideKey === 'nfc' && highlightNfcNav) ||
            (guideKey === 'card' && highlightCardNav) ||
            (guideKey === 'passwords' && highlightPasswordsNav);

          return (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              data-guide-item={dataGuideItem}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3.5 rounded-xl text-[16px] font-medium
                 select-none active:scale-[0.97] transition-all duration-100
                 ${
                   isActive
                     ? 'bg-accent-soft text-accent border border-accent-edge'
                     : 'text-mid hover:text-hi hover:bg-input border border-transparent'
                 }
                 ${highlight ? 'guide-click-target' : ''}`
              }
            >
              <Icon className="w-[17px] h-[17px] shrink-0" />
              {label}
            </NavLink>
          );
        })}
      </nav>

      <div className="px-2 pb-3 pt-2 border-t border-well shrink-0 flex flex-col gap-0.5">
        <button
          onClick={onLock}
          aria-label="Lock Vault"
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
