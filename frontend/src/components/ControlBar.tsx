import { useState, useCallback } from 'react';

interface ControlBarProps {
  onKey: (key: string) => void;
  onCopy: () => Promise<void>;
  onPaste: () => Promise<void>;
}

type Modifier = 'ctrl' | 'alt' | 'shift';

export default function ControlBar({ onKey, onCopy, onPaste }: ControlBarProps) {
  const [activeModifiers, setActiveModifiers] = useState<Set<Modifier>>(new Set());

  const toggleModifier = useCallback((mod: Modifier) => {
    setActiveModifiers((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) {
        next.delete(mod);
      } else {
        next.add(mod);
      }
      return next;
    });
  }, []);

  const sendKey = useCallback(
    (key: string, clearModifiers = true) => {
      let finalKey = key;

      if (activeModifiers.has('ctrl')) {
        if (key.length === 1 && key >= 'a' && key <= 'z') {
          finalKey = String.fromCharCode(key.charCodeAt(0) - 96);
        } else if (key.length === 1 && key >= 'A' && key <= 'Z') {
          finalKey = String.fromCharCode(key.charCodeAt(0) - 64);
        } else if (key === '[') {
          finalKey = '\x1b';
        } else if (key === '\\') {
          finalKey = '\x1c';
        } else if (key === ']') {
          finalKey = '\x1d';
        } else if (key === '^') {
          finalKey = '\x1e';
        } else if (key === '_') {
          finalKey = '\x1f';
        }
      }

      if (activeModifiers.has('alt')) {
        finalKey = '\x1b' + finalKey;
      }

      onKey(finalKey);

      if (clearModifiers) {
        setActiveModifiers(new Set());
      }
    },
    [activeModifiers, onKey]
  );

  const sendCtrlKey = useCallback(
    (char: string) => {
      const code = char.toUpperCase().charCodeAt(0) - 64;
      onKey(String.fromCharCode(code));
    },
    [onKey]
  );

  const isActive = (mod: Modifier) => activeModifiers.has(mod);

  return (
    <div className="flex items-center gap-1 px-2 py-2 bg-[#252540] border-b border-[#2d2d4a] overflow-x-auto flex-shrink-0">
      {/* Terminate button */}
      <div className="flex gap-1 pr-2 border-r border-[#2d2d4a]">
        <button
          className="control-btn bg-red-900 hover:bg-red-800 border-red-700"
          onClick={() => sendCtrlKey('C')}
          title="Terminate (Ctrl+C)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Arrow keys */}
      <div className="flex gap-1 px-2 border-r border-[#2d2d4a]">
        <button
          className="control-btn"
          onClick={() => sendKey('\x1b[A', false)}
          title="Up arrow (previous command)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          className="control-btn"
          onClick={() => sendKey('\x1b[B', false)}
          title="Down arrow (next command)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Copy/Paste */}
      <div className="flex gap-1 px-2 border-r border-[#2d2d4a]">
        <button
          className="control-btn"
          onClick={onCopy}
          title="Copy selected text"
        >
          Copy
        </button>
        <button
          className="control-btn"
          onClick={onPaste}
          title="Paste from clipboard"
        >
          Paste
        </button>
      </div>

      {/* Special keys */}
      <div className="flex gap-1 px-2 border-r border-[#2d2d4a]">
        <button
          className="control-btn"
          onClick={() => sendKey('\t', false)}
          title="Tab (autocomplete)"
        >
          Tab
        </button>
        <button
          className="control-btn"
          onClick={() => sendKey('\x1b', false)}
          title="Escape"
        >
          Esc
        </button>
      </div>

      {/* Modifiers */}
      <div className="flex gap-1 pl-1">
        <button
          className={`control-btn ${isActive('ctrl') ? 'active' : ''}`}
          onClick={() => toggleModifier('ctrl')}
        >
          Ctrl
        </button>
        <button
          className={`control-btn ${isActive('alt') ? 'active' : ''}`}
          onClick={() => toggleModifier('alt')}
        >
          Alt
        </button>
        <button
          className={`control-btn ${isActive('shift') ? 'active' : ''}`}
          onClick={() => toggleModifier('shift')}
        >
          Shift
        </button>
      </div>
    </div>
  );
}
