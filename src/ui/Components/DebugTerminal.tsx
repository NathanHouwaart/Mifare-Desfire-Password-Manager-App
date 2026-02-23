import { useState, useEffect, useRef } from 'react';

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 208;
const CLOSE_THRESHOLD = 40;

interface DebugTerminalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DebugTerminal = ({ isOpen, onOpenChange }: DebugTerminalProps) => {
  const [logs, setLogs] = useState<NfcLogEntry[]>([]);
  const [open, setOpen] = useState(isOpen);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const openRef = useRef(isOpen);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => { setOpen(isOpen); openRef.current = isOpen; }, [isOpen]);

  useEffect(() => {
    const unsubscribe = window.electron.onNfcLog((entry) => {
      setLogs((prev) => [...prev, entry]);
    });
    return unsubscribe;
  }, []);

  const scrollToBottomIfNear = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 40) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  };

  useEffect(() => {
    if (open) scrollToBottomIfNear();
  }, [logs, open, height]);

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
    if (level === 'error') return 'text-red-400';
    if (level === 'warn') return 'text-yellow-400';
    return 'text-green-400';
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-[#1e1e1e] border-t border-[#3c3c3c]"
      style={{ height: open ? height + 32 : 32 }}
    >
      {/* Resize handle — always present at the top edge */}
      <div
        className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors z-10"
        onMouseDown={onMouseDown}
      />

      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 h-8 select-none cursor-pointer hover:bg-[#2a2a2a]"
        onClick={() => { const next = !open; setOpen(next); onOpenChange(next); }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
            NFC Output
          </span>
          {logs.length > 0 && (
            <span className="text-[10px] bg-[#3c3c3c] text-gray-400 px-1.5 py-0.5 rounded-full">
              {logs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLogs([]);
            }}
            className="text-[11px] text-gray-500 hover:text-gray-200 px-1"
          >
            Clear
          </button>
          <span className="text-gray-500 text-xs">{open ? '▼' : '▲'}</span>
        </div>
      </div>

      {/* Log content */}
      {open && (
        <div
          ref={scrollRef}
          className="overflow-y-auto px-3 py-1 font-mono text-[12px]"
          style={{ height: height }}
        >
          {logs.length === 0 ? (
            <span className="text-[#555]">No output yet. Connect to a PN532 device to see logs.</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="flex gap-2 leading-5">
                <span className="text-[#555] shrink-0">{log.timestamp}</span>
                <span className={`shrink-0 ${levelStyle(log.level)}`}>
                  [{log.level.toUpperCase()}]
                </span>
                <span className="text-[#d4d4d4]">{log.message}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};
