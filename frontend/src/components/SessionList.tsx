import { useState, useEffect } from 'react';

interface Session {
  name: string;
  created: string;
  lastAccess: string;
}

interface SessionListProps {
  onSelectSession: (name: string) => void;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export default function SessionList({ onSelectSession }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSessionName, setNewSessionName] = useState('');
  const [showNewSession, setShowNewSession] = useState(false);
  const [error, setError] = useState('');

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) {
      setError('Please enter a session name');
      return;
    }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSessionName.trim() }),
      });

      if (res.ok) {
        const { name } = await res.json();
        onSelectSession(name);
      } else {
        const { error } = await res.json();
        setError(error || 'Failed to create session');
      }
    } catch (e) {
      setError('Failed to create session');
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex flex-col items-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-white text-center mb-2 mt-8">
          Terminal Sessions
        </h1>
        <p className="text-slate-400 text-center mb-8 text-sm">
          Select a session or create a new one
        </p>

        {loading ? (
          <div className="text-slate-400 text-center py-8">Loading...</div>
        ) : (
          <div className="bg-[#252540] rounded-lg overflow-hidden border border-[#2d2d4a]">
            {sessions.length === 0 ? (
              <div className="text-slate-400 text-center py-8 px-4">
                No active sessions
              </div>
            ) : (
              <ul className="divide-y divide-[#2d2d4a]">
                {sessions.map((session) => (
                  <li key={session.name}>
                    <button
                      onClick={() => onSelectSession(session.name)}
                      className="w-full px-4 py-4 flex items-center justify-between hover:bg-[#2d2d4a] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-[#4fd1c5]"></span>
                        <span className="text-white font-medium">
                          {session.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500 text-sm">
                          {formatTimeAgo(session.lastAccess)}
                        </span>
                        <svg
                          className="w-5 h-5 text-slate-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-6">
          {showNewSession ? (
            <div className="bg-[#252540] rounded-lg p-4 border border-[#2d2d4a]">
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => {
                  setNewSessionName(e.target.value);
                  setError('');
                }}
                placeholder="Session name"
                className="w-full px-4 py-3 bg-[#1a1a2e] border border-[#2d2d4a] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-[#4fd1c5]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateSession();
                  if (e.key === 'Escape') {
                    setShowNewSession(false);
                    setNewSessionName('');
                    setError('');
                  }
                }}
              />
              {error && (
                <p className="text-red-400 text-sm mt-2">{error}</p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    setShowNewSession(false);
                    setNewSessionName('');
                    setError('');
                  }}
                  className="flex-1 px-4 py-3 bg-[#2d2d4a] text-slate-300 rounded-lg font-medium hover:bg-[#353555] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSession}
                  className="flex-1 px-4 py-3 bg-[#4fd1c5] text-[#1a1a2e] rounded-lg font-medium hover:bg-[#38b2a8] transition-colors"
                >
                  Create
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewSession(true)}
              className="w-full px-4 py-4 bg-[#4fd1c5] text-[#1a1a2e] rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-[#38b2a8] transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New Session
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
