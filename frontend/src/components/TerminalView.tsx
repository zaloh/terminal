import { useState, useCallback, useEffect } from 'react';
import Terminal from './Terminal';
import ControlBar from './ControlBar';
import FileBrowser from './FileBrowser';
// import GhosttyTerminal from './GhosttyTerminal';
import ChatView from './ChatView.tsx';

interface TerminalViewProps {
  sessionName: string;
  onBack: () => void;
}

type Tab = 'terminal' | 'files' | 'chat' | 'vnc';

interface TerminalRef {
  sendInput: (data: string) => void;
  focus: () => void;
  copySelection: () => Promise<void>;
  hasSelection: () => boolean;
  scrollUp: () => void;
  scrollDown: () => void;
}

export default function TerminalView({ sessionName, onBack }: TerminalViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('terminal');
  const [terminalRef, setTerminalRef] = useState<TerminalRef | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [vncUrl, setVncUrl] = useState<string>('https://sunshine.sels.tech/play');

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => { if (cfg.vncUrl) setVncUrl(cfg.vncUrl); })
      .catch(() => {});
  }, []);

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

  const handleCopy = async () => {
    if (terminalRef) {
      await terminalRef.copySelection();
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
          <button
            onClick={() => setActiveTab('vnc')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'vnc'
                ? 'bg-[#4fd1c5] text-[#1a1a2e]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            VNC
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className={`status-dot ${connected ? 'status-connected' : connecting ? 'status-connecting' : 'status-disconnected'}`} />
          <span className="text-xs text-slate-500 font-mono truncate max-w-[80px]">
            {sessionName}
          </span>
        </div>
      </div>

      {/* Control bar - only show on terminal tab */}
      {activeTab === 'terminal' && (
        <ControlBar
          onKey={handleControlKey}
          onCopy={handleCopy}
          onPaste={handlePaste}
        />
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
        {activeTab === 'files' && <FileBrowser />}
        {activeTab === 'chat' && <ChatView sessionName={sessionName} />}
        {activeTab === 'vnc' && (
          <iframe
            src={vncUrl}
            className="w-full h-full border-0"
            allow="fullscreen; clipboard-read; clipboard-write"
          />
        )}
      </div>
    </div>
  );
}
