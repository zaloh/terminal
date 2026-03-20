import 'dotenv/config';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'node-pty';
import type { IPty } from 'node-pty';

const app = express();
const PORT = process.env.PORT || 3000;
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || os.homedir();
const TMUX_USER = process.env.TMUX_USER || os.userInfo().username;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '6291456', 10); // 6MB default

// Shared tmux socket path - connects to orchestrator sessions
const TMUX_SOCKET = process.env.TMUX_SOCKET || '/tmp/orchestrator-tmux.sock';
const tmuxSocketArg = TMUX_SOCKET ? `-S '${TMUX_SOCKET}'` : '';

app.use(cors());
app.use(express.json());

// Serve static files in production
const distPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Session management
interface Session {
  name: string;
  created: Date;
  lastAccess: Date;
}

function getTmuxSessions(): Session[] {
  try {
    const result = require('child_process').execSync(
      `tmux ${tmuxSocketArg} list-sessions -F '#{session_name}|#{session_created}|#{session_activity}' 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    return result
      .trim()
      .split('\n')
      .filter((line: string) => line.length > 0)
      .map((line: string) => {
        const [name, created, lastAccess] = line.split('|');
        return {
          name,
          created: new Date(parseInt(created) * 1000),
          lastAccess: new Date(parseInt(lastAccess) * 1000),
        };
      });
  } catch {
    return [];
  }
}

function sessionExists(sessionName: string): boolean {
  try {
    require('child_process').execSync(
      `tmux ${tmuxSocketArg} has-session -t '${sessionName}' 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    return true;
  } catch {
    return false;
  }
}

function createTmuxSession(sessionName: string): boolean {
  try {
    require('child_process').execSync(
      `cd ${WORKSPACE_ROOT} && tmux ${tmuxSocketArg} new-session -d -s '${sessionName}'`,
      { encoding: 'utf-8' }
    );
    return true;
  } catch (e) {
    console.error('Failed to create tmux session:', e);
    return false;
  }
}

// API Routes
app.get('/api/sessions', (_req, res) => {
  const sessions = getTmuxSessions();
  res.json(sessions);
});

app.post('/api/sessions', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Session name is required' });
  }

  const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 50);
  if (!sanitized) {
    return res.status(400).json({ error: 'Invalid session name' });
  }

  if (sessionExists(sanitized)) {
    return res.status(409).json({ error: 'Session already exists' });
  }

  if (createTmuxSession(sanitized)) {
    res.json({ name: sanitized });
  } else {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.delete('/api/sessions/:name', (req, res) => {
  const { name } = req.params;
  try {
    require('child_process').execSync(
      `tmux ${tmuxSocketArg} kill-session -t '${name}' 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Session not found' });
  }
});

// File browser API
function isPathSafe(requestedPath: string): boolean {
  const resolved = path.resolve(requestedPath);
  return resolved.startsWith(WORKSPACE_ROOT);
}

app.get('/api/files', (req, res) => {
  const requestedPath = (req.query.path as string) || WORKSPACE_ROOT;

  if (!isPathSafe(requestedPath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const entries = fs.readdirSync(requestedPath, { withFileTypes: true });
    const files = entries.map(entry => {
      const fullPath = path.join(requestedPath, entry.name);
      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        stats = null;
      }
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats?.size || 0,
        modified: stats?.mtime || new Date(),
      };
    });

    // Sort: directories first, then files, both alphabetically
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json({
      path: requestedPath,
      parent: requestedPath !== WORKSPACE_ROOT ? path.dirname(requestedPath) : null,
      files,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

app.get('/api/files/content', (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath || !isPathSafe(filePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read directory content' });
    }

    if (stats.size > MAX_FILE_SIZE) {
      return res.status(413).json({ error: 'File too large (max 6MB)' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];

    if (imageExts.includes(ext)) {
      const content = fs.readFileSync(filePath);
      const base64 = content.toString('base64');
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
      };
      res.json({
        type: 'image',
        mimeType: mimeTypes[ext] || 'application/octet-stream',
        content: base64,
      });
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({
        type: 'text',
        content,
        extension: ext,
      });
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server for terminal
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

interface TerminalConnection {
  pty: IPty;
  ws: WebSocket;
}

const connections = new Map<string, TerminalConnection>();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionName = url.searchParams.get('session');

  if (!sessionName) {
    ws.close(1008, 'Session name required');
    return;
  }

  // Allow alphanumeric, dash, underscore for session names
  const sanitized = sessionName.replace(/[^a-zA-Z0-9-_]/g, '');

  console.log(`Connecting to session: ${sanitized}`);

  // Create session if it doesn't exist
  if (!sessionExists(sanitized)) {
    if (!createTmuxSession(sanitized)) {
      ws.close(1011, 'Failed to create session');
      return;
    }
  }

  // Spawn PTY that attaches to tmux session
  const tmuxArgs = TMUX_SOCKET
    ? ['-S', TMUX_SOCKET, 'attach-session', '-t', sanitized]
    : ['attach-session', '-t', sanitized];
  const pty = spawn('tmux', tmuxArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
    },
  });

  const connectionId = `${sanitized}-${Date.now()}`;
  connections.set(connectionId, { pty, ws });

  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  pty.onExit(() => {
    connections.delete(connectionId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'resize' && data.cols && data.rows) {
        pty.resize(data.cols, data.rows);
      } else if (data.type === 'input' && data.data) {
        pty.write(data.data);
      }
    } catch {
      // Plain text input
      pty.write(message.toString());
    }
  });

  ws.on('close', () => {
    connections.delete(connectionId);
    pty.kill();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    connections.delete(connectionId);
    pty.kill();
  });
});

// SPA fallback - use middleware instead of wildcard route for Express 5 compatibility
app.use((_req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using tmux socket: ${TMUX_SOCKET || 'default'}`);
});
