import { useState, useEffect, useRef, useCallback } from 'react';

interface ChatComposerProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  disabled: boolean;
  isStreaming: boolean;
  sessionName: string;
}

export default function ChatComposer({ onSend, onInterrupt, disabled, isStreaming, sessionName }: ChatComposerProps) {
  const storageKey = `chat-draft-${sessionName}`;
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Restore draft when sessionName changes
  useEffect(() => {
    try { setText(localStorage.getItem(storageKey) || ''); } catch { setText(''); }
  }, [storageKey]);

  // Auto-resize textarea whenever text changes (including draft restore)
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
    }
  }, [text]);

  // Persist draft on every change
  useEffect(() => {
    try {
      if (text) {
        localStorage.setItem(storageKey, text);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch { /* ignore */ }
  }, [text, storageKey]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [text, disabled, onSend, storageKey]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="flex items-end gap-2 p-3 border-t border-[#2d2d4a] bg-[#252540]">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Connecting...' : isStreaming ? 'Send a follow-up...' : 'Message Claude...'}
        disabled={disabled}
        rows={1}
        className="flex-1 bg-[#1a1a2e] text-slate-200 border border-[#2d2d4a] rounded-lg px-3 py-2 resize-none outline-none focus:border-[#4fd1c5] placeholder-slate-500 disabled:opacity-50"
        style={{ fontSize: '16px', lineHeight: '1.5' }}
      />
      {/* Show stop button when streaming and no text typed, send button otherwise */}
      {isStreaming && !hasText && onInterrupt ? (
        <button
          onClick={onInterrupt}
          className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-red-500/80 hover:bg-red-500 text-white transition-colors"
          title="Interrupt Claude"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={disabled || !hasText}
          className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#4fd1c5] text-[#1a1a2e] disabled:opacity-30 disabled:bg-[#2d2d4a] disabled:text-slate-500 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}
    </div>
  );
}
