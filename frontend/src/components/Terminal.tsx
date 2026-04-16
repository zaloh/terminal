import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface TerminalProps {
  sessionName: string;
  onReady: (ref: {
    sendInput: (data: string) => void;
    focus: () => void;
    copySelection: () => Promise<void>;
    hasSelection: () => boolean;
    scrollUp: () => void;
    scrollDown: () => void;
  }) => void;
  onConnectionChange?: (connected: boolean, connecting: boolean) => void;
}

const TERMINAL_ROWS = 200; // Tall terminal for scrollback history

export default function Terminal({ sessionName, onReady, onConnectionChange }: TerminalProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const manualScrollRef = useRef(false); // Track if user manually scrolled via buttons
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isUnmountedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);

  // Notify parent of connection state changes
  useEffect(() => {
    onConnectionChange?.(connected, connecting);
  }, [connected, connecting, onConnectionChange]);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
      manualScrollRef.current = false; // Reset manual scroll when user types
    }
  }, []);

  const focus = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const copySelection = useCallback(async () => {
    if (terminalRef.current) {
      const selection = terminalRef.current.getSelection();
      if (selection) {
        try {
          await navigator.clipboard.writeText(selection);
        } catch (e) {
          console.error('Failed to copy:', e);
        }
      }
    }
  }, []);

  const hasSelection = useCallback(() => {
    return terminalRef.current?.hasSelection() || false;
  }, []);

  const scrollUp = useCallback(() => {
    if (scrollContainerRef.current) {
      manualScrollRef.current = true;
      scrollContainerRef.current.scrollBy({ top: -300, behavior: 'smooth' });
    }
  }, []);

  const scrollDown = useCallback(() => {
    if (scrollContainerRef.current) {
      manualScrollRef.current = true;
      scrollContainerRef.current.scrollBy({ top: 300, behavior: 'smooth' });
    }
  }, []);

  // Handle visual viewport changes (keyboard appearing/disappearing)
  useEffect(() => {
    const updateViewportHeight = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportHeight);
      updateViewportHeight();
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewportHeight);
      }
    };
  }, []);

  // Scroll to cursor position when viewport height changes (keyboard appears)
  // Only scroll if needed to keep cursor visible, and scroll to cursor not to bottom
  useEffect(() => {
    // Skip if user manually scrolled via buttons
    if (manualScrollRef.current) return;

    if (scrollContainerRef.current && terminalRef.current && viewportHeight !== null) {
      const container = scrollContainerRef.current;
      const terminal = terminalRef.current;

      // Get cursor position in the terminal buffer
      const cursorY = terminal.buffer.active.cursorY;
      const baseY = terminal.buffer.active.baseY;
      const cursorRow = baseY + cursorY;

      // Calculate row height (font size 14px * ~1.2 line height)
      const rowHeight = 17;
      const cursorPixelPosition = cursorRow * rowHeight;

      // Check if cursor is currently visible
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const cursorVisible = cursorPixelPosition >= scrollTop &&
                           cursorPixelPosition < scrollTop + containerHeight - rowHeight;

      // Only scroll if cursor is not visible (e.g., keyboard pushed it off screen)
      if (!cursorVisible) {
        // Scroll to show cursor well above the bottom of visible area (extra 200px for keyboard)
        const targetScroll = Math.max(0, cursorPixelPosition - containerHeight + rowHeight * 3 + 200);
        container.scrollTop = targetScroll;
      }
    }
  }, [viewportHeight]);

  const connectWebSocket = useCallback(() => {
    if (isUnmountedRef.current) return;

    setConnecting(true);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?session=${sessionName}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);

      if (scrollContainerRef.current) {
        const containerWidth = scrollContainerRef.current.clientWidth - 16;
        const charWidth = 8.4;
        const cols = Math.floor(containerWidth / charWidth);
        ws.send(JSON.stringify({ type: 'resize', cols: Math.max(cols, 40), rows: TERMINAL_ROWS }));
      }
    };

    ws.onmessage = (event) => {
      if (terminalRef.current) {
        terminalRef.current.write(event.data);
      }
    };

    ws.onerror = () => {
      setConnected(false);
      setConnecting(false);
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);

      if (isUnmountedRef.current) return;

      // Flat 2-second reconnect (simpler, more responsive for local server)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (!isUnmountedRef.current) {
          connectWebSocket();
        }
      }, 2000);
    };
  }, [sessionName]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      rows: TERMINAL_ROWS,
      cols: 80,
      scrollback: 0, // Disable internal scrollback since we're using container scroll
      theme: {
        background: '#1a1a2e',
        foreground: '#e2e8f0',
        cursor: '#4fd1c5',
        cursorAccent: '#1a1a2e',
        selectionBackground: 'rgba(79, 209, 197, 0.4)',
        selectionForeground: '#ffffff',
        black: '#3f3f46',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#4fd1c5',
        white: '#e2e8f0',
        brightBlack: '#71717a',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#5eead4',
        brightWhite: '#f8fafc',
      },
      allowProposedApi: true,
    });

    terminalRef.current = terminal;

    // Load fit addon
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Load web links addon
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.open(uri, '_blank', 'noopener,noreferrer');
    });
    terminal.loadAddon(webLinksAddon);

    // Open terminal in container
    terminal.open(containerRef.current);

    // Let wheel/scroll events pass through to the outer scroll container
    // instead of being intercepted by xterm (which converts them to arrow keys)
    terminal.attachCustomWheelEventHandler(() => false);

    // WebGL disabled — causes glyph corruption on this system (Playwright Chrome install may have broken GPU context)
    // Using xterm.js DOM renderer instead

    // Get the actual column width based on container
    const updateCols = () => {
      if (scrollContainerRef.current) {
        const containerWidth = scrollContainerRef.current.clientWidth - 16; // padding
        const charWidth = 8.4; // approximate char width for 14px font
        const cols = Math.floor(containerWidth / charWidth);
        terminal.resize(Math.max(cols, 40), TERMINAL_ROWS);
      }
    };

    requestAnimationFrame(updateCols);

    // Connect WebSocket
    connectWebSocket();

    // Handle terminal input
    terminal.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle container resize - also notify server of new size
    const resizeObserver = new ResizeObserver(() => {
      updateCols();
      if (wsRef.current?.readyState === WebSocket.OPEN && scrollContainerRef.current) {
        const containerWidth = scrollContainerRef.current.clientWidth - 16;
        const charWidth = 8.4;
        const cols = Math.floor(containerWidth / charWidth);
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: Math.max(cols, 40), rows: TERMINAL_ROWS }));
      }
    });
    if (scrollContainerRef.current) {
      resizeObserver.observe(scrollContainerRef.current);
    }

    // Expose methods to parent
    onReady({ sendInput, focus, copySelection, hasSelection, scrollUp, scrollDown });

    // Scroll to cursor position initially
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const rowHeight = 17;
      const cursorY = terminal.buffer.active.cursorY;
      const baseY = terminal.buffer.active.baseY;
      const cursorRow = baseY + cursorY;
      const cursorPixelPosition = cursorRow * rowHeight;
      const containerHeight = container.clientHeight;
      const targetScroll = Math.max(0, cursorPixelPosition - containerHeight + rowHeight * 3 + 200);
      container.scrollTop = targetScroll;
    }

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      resizeObserver.disconnect();
      wsRef.current?.close();
      webglAddonRef.current?.dispose();
      terminal.dispose();
    };
  }, [sessionName, onReady, connectWebSocket, sendInput, focus, copySelection, hasSelection, scrollUp, scrollDown]);

  // Calculate container height based on viewport
  const containerStyle: React.CSSProperties = viewportHeight
    ? { height: `${viewportHeight - 140}px` } // Subtract header + control bar + extra padding
    : { height: '100%' };

  return (
    <div
      ref={scrollContainerRef}
      className="terminal-scroll-container"
      style={containerStyle}
    >
      <div
        ref={containerRef}
        className="terminal-inner"
      />
    </div>
  );
}
