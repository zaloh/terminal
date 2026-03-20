import { useState, useEffect, useRef, useCallback } from 'react';
import ChatMessage from './ChatMessage.tsx';
import ChatComposer from './ChatComposer.tsx';

interface ChatViewProps {
  sessionName: string;
}

interface HistorySession {
  sessionId: string;
  project: string;
  lastMessage: string;
  modifiedAt: string;
}

interface ContentBlock {
  type: string;
  name?: string;
  tool_use_id?: string;
  content?: unknown;
}

type ActivityStatus = null | { type: 'thinking' } | { type: 'tool_use'; tool: string };

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

// Extract tool_result entries from a user message's content blocks
function extractToolResults(msg: Record<string, unknown>): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  const message = msg.message as Record<string, unknown> | undefined;
  const content = message?.content as ContentBlock[] | undefined;
  if (!content) return results;
  for (const block of content) {
    if (block.type === 'tool_result' && block.tool_use_id) {
      results[block.tool_use_id] = block.content;
    }
  }
  return results;
}

// Check if a user message is a real text message (not an internal tool_result)
function isRealUserMessage(msg: Record<string, unknown>): boolean {
  // Locally created user messages have { type: 'user', text: '...' }
  if (msg.text) return true;
  // From Claude stream, check if content has text blocks
  const message = msg.message as Record<string, unknown> | undefined;
  const content = message?.content as ContentBlock[] | undefined;
  if (!content) return false;
  return content.some(b => b.type === 'text');
}

// Shorten a path for display: ~/Desktop/project instead of /home/user/Desktop/project
function shortenPath(p: string): string {
  const home = '/home/';
  if (p.startsWith(home)) {
    const afterHome = p.slice(home.length);
    const slashIdx = afterHome.indexOf('/');
    if (slashIdx >= 0) return '~' + afterHome.slice(slashIdx);
    return '~';
  }
  return p;
}

export default function ChatView({ sessionName }: ChatViewProps) {
  const [messages, setMessages] = useState<Record<string, unknown>[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [historySessions, setHistorySessions] = useState<HistorySession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>(null);
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<string>>(new Set());
  const [toolResults, setToolResults] = useState<Record<string, unknown>>({});
  const [cwd, setCwd] = useState<string>('');
  const [editingCwd, setEditingCwd] = useState(false);
  const [cwdInput, setCwdInput] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isUnmountedRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activityStatus, scrollToBottom]);

  const connectWebSocket = useCallback(() => {
    if (isUnmountedRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat?session=${sessionName}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'history') {
          const allMsgs = msg.messages || [];
          // Extract tool results from user messages, filter for display
          const displayMsgs: Record<string, unknown>[] = [];
          const results: Record<string, unknown> = {};
          for (const m of allMsgs) {
            if (m.type === 'user') {
              // Extract tool results from internal user messages
              Object.assign(results, extractToolResults(m));
              // Only display real user text messages
              if (isRealUserMessage(m)) displayMsgs.push(m);
            } else if (m.type === 'assistant') {
              displayMsgs.push(m);
            }
            // Skip system/result messages for display
          }
          setMessages(displayMsgs);
          setToolResults(prev => ({ ...prev, ...results }));
          // Check if last message in full history is a result (streaming done)
          const lastMsg = allMsgs[allMsgs.length - 1];
          setIsStreaming(lastMsg?.type === 'assistant');
          setActivityStatus(null);
          // Set cwd from history message
          if (msg.cwd) setCwd(msg.cwd);
          return;
        }

        if (msg.type === 'session_resumed') {
          setMessages([]);
          setIsStreaming(false);
          setResumed(true);
          setShowSessionPicker(false);
          setActivityStatus(null);
          setAnsweredQuestions(new Set());
          setToolResults({});
          return;
        }

        if (msg.type === 'cwd_changed') {
          setCwd(msg.cwd);
          setMessages([]);
          setIsStreaming(false);
          setActivityStatus(null);
          setToolResults({});
          return;
        }

        if (msg.type === 'assistant') {
          setIsStreaming(true);
          setMessages(prev => [...prev, msg]);

          // Update activity status based on last content block
          const content = (msg.message as Record<string, unknown>)?.content as ContentBlock[] | undefined;
          if (content && content.length > 0) {
            const lastBlock = content[content.length - 1];
            if (lastBlock.type === 'thinking') {
              setActivityStatus({ type: 'thinking' });
            } else if (lastBlock.type === 'tool_use') {
              setActivityStatus({ type: 'tool_use', tool: lastBlock.name || 'tool' });
            } else if (lastBlock.type === 'text') {
              setActivityStatus(null);
            }
          }
        } else if (msg.type === 'result') {
          setIsStreaming(false);
          setActivityStatus(null);
        } else if (msg.type === 'system') {
          // Skip system init messages
        } else if (msg.type === 'process_exit') {
          setIsStreaming(false);
          setActivityStatus(null);
          setMessages(prev => [...prev, msg]);
        } else if (msg.type === 'user') {
          // Extract tool results from internal user messages
          const results = extractToolResults(msg);
          if (Object.keys(results).length > 0) {
            setToolResults(prev => ({ ...prev, ...results }));
          }
          // Only add real user text messages to display
          if (isRealUserMessage(msg)) {
            setMessages(prev => [...prev, msg]);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      if (isUnmountedRef.current) return;

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
    isUnmountedRef.current = false;
    connectWebSocket();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connectWebSocket]);

  const handleSend = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Add user message locally
    const userMsg = { type: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setResumed(false);
    setActivityStatus({ type: 'thinking' });

    wsRef.current.send(JSON.stringify(userMsg));
  }, []);

  const handleQuestionResponse = useCallback((toolUseId: string, answers: Record<string, string>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setAnsweredQuestions(prev => new Set(prev).add(toolUseId));
    setActivityStatus({ type: 'thinking' });

    wsRef.current.send(JSON.stringify({
      type: 'question_response',
      toolUseId,
      answers,
    }));
  }, []);

  const handleInterrupt = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
  }, []);

  const handleSetCwd = useCallback((newCwd: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'set_cwd', cwd: newCwd }));
    setEditingCwd(false);
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/chat/history');
      const data = await res.json();
      setHistorySessions(data);
    } catch {
      setHistorySessions([]);
    }
    setLoadingHistory(false);
  }, []);

  const handleResumeSession = useCallback((sessionId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'resume', sessionId }));
  }, []);

  const handleOpenPicker = useCallback(() => {
    setShowSessionPicker(true);
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="flex flex-col h-full">
      {/* Working directory bar */}
      {cwd && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#2d2d4a] bg-[#1e1e35] text-xs">
          <svg className="w-3 h-3 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          {editingCwd ? (
            <form
              className="flex-1 flex gap-1"
              onSubmit={(e) => { e.preventDefault(); handleSetCwd(cwdInput); }}
            >
              <input
                autoFocus
                value={cwdInput}
                onChange={(e) => setCwdInput(e.target.value)}
                onBlur={() => setEditingCwd(false)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingCwd(false); }}
                className="flex-1 bg-[#1a1a2e] text-slate-300 border border-[#4fd1c5]/50 rounded px-2 py-0.5 outline-none text-xs font-mono"
              />
            </form>
          ) : (
            <button
              onClick={() => { setCwdInput(cwd); setEditingCwd(true); }}
              className="text-slate-400 hover:text-slate-200 font-mono truncate transition-colors text-left"
              title={`Working directory: ${cwd}\nClick to change`}
            >
              {shortenPath(cwd)}
            </button>
          )}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Empty state with resume option */}
        {messages.length === 0 && connected && !showSessionPicker && !resumed && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-slate-500 text-sm">
              Send a message to start chatting with Claude
            </div>
            <button
              onClick={handleOpenPicker}
              className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              or resume a past conversation
            </button>
          </div>
        )}

        {/* Resumed session indicator */}
        {resumed && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <div className="text-xs text-slate-500 bg-slate-800/50 border border-slate-700 rounded px-3 py-1.5">
              Resumed session — Claude has full context
            </div>
            <div className="text-slate-500 text-sm">
              Send a message to continue the conversation
            </div>
          </div>
        )}

        {/* Session picker overlay */}
        {showSessionPicker && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-slate-400 font-medium">Resume a conversation</span>
              <button
                onClick={() => setShowSessionPicker(false)}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
            {loadingHistory ? (
              <div className="text-sm text-slate-500 text-center py-8">Loading sessions...</div>
            ) : historySessions.length === 0 ? (
              <div className="text-sm text-slate-500 text-center py-8">No past sessions found</div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-1">
                {historySessions.map((s) => (
                  <button
                    key={s.sessionId}
                    onClick={() => handleResumeSession(s.sessionId)}
                    className="w-full text-left px-3 py-2 rounded bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 hover:border-slate-600 transition-colors group"
                  >
                    <div className="text-sm text-slate-300 group-hover:text-slate-100 truncate">
                      {s.lastMessage}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                      <span className="bg-slate-700/50 px-1.5 py-0.5 rounded text-slate-400">{s.project}</span>
                      <span>{formatRelativeTime(s.modifiedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!connected && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Connecting...
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            message={msg}
            isStreaming={isStreaming && i === messages.length - 1 && (msg.type as string) === 'assistant'}
            onQuestionResponse={handleQuestionResponse}
            answeredQuestions={answeredQuestions}
            toolResults={toolResults}
          />
        ))}

        {/* Activity indicator */}
        {activityStatus && (
          <div className="flex items-center gap-2 mb-3 px-1 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4fd1c5] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#4fd1c5]" />
            </span>
            <span className="text-xs text-slate-400">
              {activityStatus.type === 'thinking'
                ? 'Thinking...'
                : `Using ${activityStatus.tool}...`}
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <ChatComposer
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        disabled={!connected}
        isStreaming={isStreaming}
        sessionName={sessionName}
      />
    </div>
  );
}
