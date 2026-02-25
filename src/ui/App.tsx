import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Components/Sidebar';
import { LockScreen } from './Components/LockScreen';
import { SplashScreen } from './Components/SplashScreen';
import { LockTransition } from './Components/LockTransition';
import { DebugTerminal } from './Components/DebugTerminal';
import { PasswordsPage } from './pages/PasswordsPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { CardPage } from './pages/CardPage';
import { NfcReaderPage } from './pages/NfcReaderPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';
import './App.css';

function App() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const path      = location.pathname;

  const [unlocked,         setUnlocked]         = useState(false);
  const [locking,          setLocking]           = useState(false);
  const [showSplash,       setShowSplash]        = useState(true);
  const [isTerminalOpen,   setIsTerminalOpen]    = useState(false);
  const [isNfcConnected,   setIsNfcConnected]    = useState(false);
  const [terminalEnabled,  setTerminalEnabled]   = useState(
    () => (localStorage.getItem('setting-terminal-enabled') ?? 'true') === 'true'
  );
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('app-theme') as 'dark' | 'light') ?? 'dark'
  );

  // Track whether the window was blurred so the focus handler only acts on
  // a real wake-from-background, not the initial focus on startup.
  const wasBlurred = useRef(false);

  const toggleTerminalEnabled = () =>
    setTerminalEnabled(prev => {
      const next = !prev;
      localStorage.setItem('setting-terminal-enabled', String(next));
      if (!next) setIsTerminalOpen(false);
      return next;
    });

  // Redirect bare / → /passwords on first render
  useEffect(() => {
    if (path === '/') navigate('/passwords', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Require PIN on wake ──────────────────────────────────────────────────
  // When enabled, lock the vault whenever the app window regains focus after
  // having been blurred (i.e. the user switched away and came back).
  useEffect(() => {
    if (!unlocked) return;
    const onBlur  = () => { wasBlurred.current = true; };
    const onFocus = () => {
      if (!wasBlurred.current) return;
      wasBlurred.current = false;
      const requirePin = (localStorage.getItem('setting-pin-wake') ?? 'true') === 'true';
      if (requirePin) setLocking(true);
    };
    window.addEventListener('blur',  onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur',  onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [unlocked]);

  // ── Auto-lock on inactivity ──────────────────────────────────────────────
  // Reads the current value from localStorage each time the vault is unlocked
  // so settings changes take effect immediately without a restart.
  useEffect(() => {
    if (!unlocked) return;
    const raw = localStorage.getItem('setting-autolock') ?? '5';
    if (raw === 'never') return;
    const ms = parseInt(raw, 10) * 60 * 1000;
    if (!ms || ms <= 0) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setLocking(true), ms);
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'] as const;
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset(); // arm the timer immediately

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [unlocked]);

  const toggleTheme = () =>
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('app-theme', next);
      return next;
    });

  const themeClass = theme === 'light' ? 'light' : '';

  if (showSplash) {
    return (
      <div className={`h-screen w-screen bg-page ${themeClass}`}>
        <SplashScreen onDone={() => setShowSplash(false)} />
      </div>
    );
  }

  return (
    <div className={`h-screen w-screen overflow-hidden bg-page ${themeClass}`}>

      {/* Lock screen — shown when vault is locked */}
      {!unlocked && (
        <LockScreen onUnlock={() => setUnlocked(true)} />
      )}

      {/* Main app — shown when vault is unlocked */}
      {unlocked && (
        <div className="flex h-full w-full overflow-hidden">
          <Sidebar
            onLock={() => setLocking(true)}
            isNfcConnected={isNfcConnected}
          />

          {/* flex-col wrapper so the terminal sits in flow — main shrinks as terminal grows */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <main className="flex-1 overflow-y-auto min-h-0 relative">
              {/* All pages are always mounted — CSS hidden preserves state on tab switch */}
              <div className={path === '/passwords' ? 'flex flex-col h-full' : 'hidden'}>
                <PasswordsPage theme={theme} />
              </div>
              <div className={path === '/generator' ? 'block' : 'hidden'}>
                <GeneratorPage />
              </div>
              <div className={path === '/card' ? 'block' : 'hidden'}>
                <CardPage isNfcConnected={isNfcConnected} />
              </div>
              <div className={path === '/nfc' ? 'block' : 'hidden'}>
                <NfcReaderPage
                  isTerminalOpen={isTerminalOpen}
                  onToggleTerminal={() => setIsTerminalOpen(p => !p)}
                  isConnected={isNfcConnected}
                  onConnectionChange={setIsNfcConnected}
                  terminalEnabled={terminalEnabled}
                />
              </div>
              <div className={path === '/settings' ? 'block' : 'hidden'}>
                <SettingsPage
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  terminalEnabled={terminalEnabled}
                  onToggleTerminalEnabled={toggleTerminalEnabled}
                />
              </div>
              <div className={path === '/about' ? 'block' : 'hidden'}>
                <AboutPage />
              </div>
            </main>

            {terminalEnabled && (
              <DebugTerminal isOpen={isTerminalOpen} onOpenChange={setIsTerminalOpen} />
            )}
          </div>
        </div>
      )}

      {/* Lock transition overlay — fixed, on top of everything */}
      {locking && (
        <LockTransition
          onLock={() => setUnlocked(false)}
          onDone={() => setLocking(false)}
        />
      )}

    </div>
  );
}

export default App;

