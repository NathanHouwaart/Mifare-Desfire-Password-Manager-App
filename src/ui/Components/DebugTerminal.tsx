import { useState, useEffect, useRef } from 'react';

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 208;
const CLOSE_THRESHOLD = 40;
const AUTO_SCROLL_THRESHOLD = 40;

interface DebugTerminalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DebugTerminal = ({ isOpen, onOpenChange }: DebugTerminalProps) => {
  const [logs, setLogs] = useState<NfcLogEntry[]>([]);
  const [open, setOpen] = useState(isOpen);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const openRef = useRef(isOpen);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const stickToBottomRef = useRef(true);
  const pendingAutoScrollRef = useRef(false);

  useEffect(() => { setOpen(isOpen); openRef.current = isOpen; }, [isOpen]);

  useEffect(() => {
    const isNearBottom = () => {
      const el = scrollRef.current;
      if (!el) return true;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      return distanceFromBottom <= AUTO_SCROLL_THRESHOLD;
    };

    const unsubscribe = window.electron.onNfcLog((entry) => {
      const wasNearBottom = stickToBottomRef.current || isNearBottom();
      if (wasNearBottom) pendingAutoScrollRef.current = true;
      setLogs((prev) => [...prev, entry]);
    });
    return unsubscribe;
  }, []);

  const syncStickToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD;
  };

  useEffect(() => {
    if (!open || !pendingAutoScrollRef.current) return;
    pendingAutoScrollRef.current = false;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
    });
  }, [logs, open, height]);

  useEffect(() => {
    if (!open || !stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [open, height]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      // Derive content height purely from cursor distance to window bottom.
      // 32px is the fixed title bar. This is the only calculation needed.
      const contentHeight = window.innerHeight - e.clientY - 32;
      if (contentHeight < CLOSE_THRESHOLD) {
        setOpen(false);
        openRef.current = false;
      } else {
        const clamped = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, contentHeight));
        setHeight(clamped);
        setOpen(true);
        openRef.current = true;
      }
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onOpenChange(openRef.current);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onOpenChange]);

  const levelStyle = (level: NfcLogEntry['level']) => {
    if (level === 'error') return 'text-err';
    if (level === 'warn') return 'text-warn';
    return 'text-ok';
  };

  const handleExport = async () => {
    if (logs.length === 0) return;
    const header = [
      'SecurePass — NFC Output Log',
      `Exported: ${new Date().toLocaleString()}`,
      `Entries:  ${logs.length}`,
      '─'.repeat(60),
      '',
    ].join('\n');
    const body = logs
      .map(l => `${l.timestamp}  [${l.level.toUpperCase().padEnd(5)}]  ${l.message}`)
      .join('\n');
    const filename = `nfc-log-${new Date().toISOString().slice(0, 10)}.txt`;
    await window.electron.saveFile(filename, header + body);
  };

  return (
    <div
      className="terminal-panel relative shrink-0 w-full bg-well border-t border-edge2"
      style={{ height: open ? height + 32 : 32 }}
    >
      {/* Resize handle */}
      <div
        className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-accent-soft active:bg-accent-edge transition-colors z-10"
        onMouseDown={onMouseDown}
      />

      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 h-8 select-none cursor-pointer hover:bg-input"
        onClick={() => { const next = !open; setOpen(next); onOpenChange(next); }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-lo uppercase tracking-widest">
            NFC Output
          </span>
          {logs.length > 0 && (
            <span className="text-[11px] bg-edge2 text-mid px-1.5 py-0.5 rounded-full">
              {logs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {logs.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleExport(); }}
              className="text-[12px] text-dim hover:text-hi px-1"
            >
              Export
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setLogs([]); }}
            className="text-[12px] text-dim hover:text-hi px-1"
          >
            Clear
          </button>
          <span className="text-dim text-xs">{open ? '▼' : '▲'}</span>
        </div>
      </div>

      {/* Log content */}
      {open && (
        <div
          ref={scrollRef}
          onScroll={syncStickToBottom}
          className="overflow-y-auto px-3 py-1 font-mono text-[13px]"
          style={{ height: height }}
        >
          {logs.length === 0 ? (
            <span className="text-lo">No output yet. Connect to a PN532 device to see logs.</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="flex gap-2 leading-5">
                <span className="text-lo shrink-0">{log.timestamp}</span>
                <span className={`shrink-0 ${levelStyle(log.level)}`}>
                  [{log.level.toUpperCase()}]
                </span>
                <span className="text-bright">{log.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
