import { useState, useCallback, useEffect, useRef } from 'react';
import Terminal from './Terminal';
import ControlBar from './ControlBar';
import FileBrowser from './FileBrowser';
import ChatView from './ChatView.tsx';

interface TerminalViewProps {
  sessionName: string;
  onBack: () => void;
}

type Tab = 'terminal' | 'files' | 'chat' | 'preview';

interface TerminalRef {
  sendInput: (data: string) => void;
  focus: () => void;
  copySelection: () => Promise<void>;
  hasSelection: () => boolean;
  scrollUp: () => void;
  scrollDown: () => void;
}

interface SessionMeta {
  status?: 'working' | 'waiting' | 'finished' | 'idle';
  task?: string;
  cwd?: string;
  preview_url?: string;
  claude_session_id?: string;
  updated_at?: number;
}

const STATUS_STYLES: Record<string, { color: string; label: string; pulse: boolean }> = {
  working:  { color: '#f6ad55', label: 'working',  pulse: true  },
  waiting:  { color: '#4fd1c5', label: 'waiting',  pulse: false },
  finished: { color: '#68d391', label: 'finished', pulse: false },
  idle:     { color: '#718096', label: 'idle',     pulse: false },
};

export default function TerminalView({ sessionName, onBack }: TerminalViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('terminal');
  const [terminalRef, setTerminalRef] = useState<TerminalRef | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [meta, setMeta] = useState<SessionMeta>({});
  const [inputVisible, setInputVisible] = useState(false);
  const [inputText, setInputText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Poll session metadata every 2s while this view is open.
  useEffect(() => {
    let cancelled = false;
    const fetchMeta = async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/meta`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setMeta(data || {});
      } catch {}
    };
    fetchMeta();
    const id = setInterval(fetchMeta, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionName]);

  // If the user was on the Preview tab and the preview URL disappears, fall back to Terminal.
  useEffect(() => {
    if (activeTab === 'preview' && !meta.preview_url) setActiveTab('terminal');
  }, [activeTab, meta.preview_url]);

  const handleConnectionChange = useCallback((conn: boolean, conning: boolean) => {
    setConnected(conn);
    setConnecting(conning);
  }, []);

  const handleControlKey = (key: string) => {
    if (terminalRef) {
      terminalRef.sendInput(key);
      terminalRef.focus();
    }
  };

  const handlePaste = async () => {
    if (terminalRef) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          terminalRef.sendInput(text);
          terminalRef.focus();
        }
      } catch (e) {
        console.error('Failed to paste:', e);
      }
    }
  };

  const handleToggleInput = () => {
    setInputVisible(prev => {
      if (!prev) {
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
      return !prev;
    });
  };

  const handleInputSubmit = () => {
    if (terminalRef && inputText) {
      terminalRef.sendInput(inputText);
      setInputText('');
      terminalRef.focus();
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInputSubmit();
    }
  };

  const status = meta.status && STATUS_STYLES[meta.status] ? STATUS_STYLES[meta.status] : null;
  const showPreview = Boolean(meta.preview_url);

  return (
    <div className="h-dvh flex flex-col bg-[#1a1a2e]">
      {/* Header with back button and tabs */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-[#2d2d4a] bg-[#252540] flex-shrink-0">
        <button
          onClick={onBack}
          className="p-2 text-slate-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex gap-1 bg-[#1a1a2e] rounded-lg p-1">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'terminal'
                ? 'bg-[#4fd1c5] text-[#1a1a2e]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Terminal
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'files'
                ? 'bg-[#4fd1c5] text-[#1a1a2e]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Files
          </button>
          {showPreview && (
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'preview'
                  ? 'bg-[#4fd1c5] text-[#1a1a2e]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Preview
            </button>
          )}
        </div>

        <div className="flex flex-col items-end gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`status-dot ${connected ? 'status-connected' : connecting ? 'status-connecting' : 'status-disconnected'}`} />
            <span className="text-xs text-slate-500 font-mono truncate max-w-[120px]">
              {sessionName}
            </span>
          </div>
          {status && (
            <div
              className="flex items-center gap-1.5 text-[10px] max-w-[200px]"
              title={meta.task ? `${status.label}: ${meta.task}` : status.label}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${status.pulse ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: status.color }}
              />
              <span
                className="font-semibold uppercase tracking-wide flex-shrink-0"
                style={{ color: status.color }}
              >
                {status.label}
              </span>
              {meta.task && (
                <span className="text-slate-400 truncate min-w-0">
                  {meta.task}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Control bar - only show on terminal tab */}
      {activeTab === 'terminal' && (
        <ControlBar
          onKey={handleControlKey}
          onPaste={handlePaste}
          onToggleInput={handleToggleInput}
          inputVisible={inputVisible}
        />
      )}

      {/* Rich text input area */}
      {activeTab === 'terminal' && inputVisible && (
        <div className="flex items-stretch gap-2 px-2 py-2 bg-[#1e1e38] border-b border-[#2d2d4a] flex-shrink-0">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type or dictate text..."
            rows={2}
            className="flex-1 bg-[#252540] text-white rounded-lg px-3 py-2 text-sm resize-none border border-[#3d3d5c] focus:border-[#4fd1c5] focus:outline-none placeholder-slate-500"
          />
          <button
            onClick={handleInputSubmit}
            disabled={!inputText}
            className="px-4 bg-[#4fd1c5] text-[#1a1a2e] rounded-lg font-medium text-sm hover:bg-[#38b2ac] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'terminal' && (
          <Terminal
            sessionName={sessionName}
            onReady={setTerminalRef}
            onConnectionChange={handleConnectionChange}
          />
        )}
        {activeTab === 'files' && <FileBrowser sessionCwd={meta.cwd} />}
        {activeTab === 'chat' && <ChatView sessionName={sessionName} />}
        {activeTab === 'preview' && meta.preview_url && (
          <iframe
            src={meta.preview_url}
            className="w-full h-full border-0 bg-white"
            allow="fullscreen; clipboard-read; clipboard-write"
          />
        )}
      </div>
    </div>
  );
}
