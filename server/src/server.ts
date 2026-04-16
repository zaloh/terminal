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
import { spawn as cpSpawn, execSync, execFileSync, ChildProcess } from 'child_process';
import readline from 'readline';
import multer from 'multer';

const app = express();
const PORT = process.env.PORT || 3000;
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(os.homedir(), 'Desktop');
const TMUX_USER = process.env.TMUX_USER || os.userInfo().username;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '6291456', 10); // 6MB default

// Shared tmux socket path - connects to orchestrator sessions
const TMUX_SOCKET = process.env.TMUX_SOCKET || '/tmp/orchestrator-tmux.sock';
const tmuxSocketArg = TMUX_SOCKET ? `-S '${TMUX_SOCKET}'` : '';

// Directory where Claude Code hooks write per-session metadata (status, task, cwd, preview_url).
// See ~/.claude/hooks/terminal-meta.py and ~/.claude/bin/tm-meta.
const META_DIR = process.env.CLAUDE_META_DIR || '/tmp/claude-terminal-meta';

app.use(cors());
app.use(express.json());

// Serve static files in production
const distPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Session management
interface SessionMeta {
  status?: 'working' | 'waiting' | 'finished' | 'idle';
  task?: string;
  cwd?: string;
  preview_url?: string;
  claude_session_id?: string;
  updated_at?: number;
}

interface Session {
  name: string;
  created: Date;
  lastAccess: Date;
  meta?: SessionMeta;
}

function sanitizeSessionName(name: string): string {
  return name.replace(/[/\\]/g, '_');
}

function readSessionMeta(sessionName: string): SessionMeta | undefined {
  try {
    const p = path.join(META_DIR, `${sanitizeSessionName(sessionName)}.json`);
    if (!fs.existsSync(p)) return undefined;
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      status: parsed.status,
      task: parsed.task,
      cwd: parsed.cwd,
      preview_url: parsed.preview_url,
      claude_session_id: parsed.claude_session_id,
      updated_at: parsed.updated_at,
    };
  } catch {
    return undefined;
  }
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
          meta: readSessionMeta(name),
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

// Read the current working directory of a tmux session's active pane
function getTmuxPaneCwd(sessionName: string): string | null {
  try {
    const result = execSync(
      `tmux ${tmuxSocketArg} display-message -p -t '${sessionName}' '#{pane_current_path}' 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    const cwd = result.trim();
    if (cwd && fs.existsSync(cwd)) return cwd;
  } catch { /* ignore */ }
  return null;
}

// API Routes
app.get('/api/config', (_req, res) => {
  res.json({ rootPath: WORKSPACE_ROOT });
});

// Lightweight per-session metadata endpoint — polled by TerminalView while attached.
app.get('/api/sessions/:name/meta', (req, res) => {
  const meta = readSessionMeta(req.params.name);
  if (!meta) return res.json({});
  res.json(meta);
});

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
    // Drop any metadata file so the session fully disappears from the UI.
    try {
      const metaPath = path.join(META_DIR, `${sanitizeSessionName(name)}.json`);
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    } catch {}
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Session not found' });
  }
});

// File browser API — allow browsing anywhere within the user's home directory
const HOME_DIR = os.homedir();
function isPathSafe(requestedPath: string): boolean {
  const resolved = path.resolve(requestedPath);
  return resolved === HOME_DIR || resolved.startsWith(HOME_DIR + path.sep);
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
      const isDir = entry.isDirectory();
      let size: number | null = null;
      let modified: Date = new Date();
      try {
        const stats = fs.statSync(fullPath);
        modified = stats.mtime;
        if (!isDir) size = stats.size;
      } catch {}
      return {
        name: entry.name,
        type: isDir ? 'directory' : 'file',
        size,
        modified,
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
      parent: path.resolve(requestedPath) !== HOME_DIR ? path.dirname(requestedPath) : null,
      files,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// Async directory sizes — returns { sizes: { name: bytes, ... } }
app.get('/api/files/dir-sizes', (req, res) => {
  const requestedPath = (req.query.path as string) || WORKSPACE_ROOT;

  if (!isPathSafe(requestedPath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    // du -b --max-depth=1 on the directory, with a timeout
    const result = execSync(
      `du -b --max-depth=1 ${JSON.stringify(requestedPath)} 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const sizes: Record<string, number> = {};
    for (const line of result.trim().split('\n')) {
      if (!line) continue;
      const [sizeStr, dirPath] = line.split('\t');
      if (!dirPath) continue;
      const name = path.basename(dirPath);
      // Skip the parent directory entry itself
      if (path.resolve(dirPath) === path.resolve(requestedPath)) continue;
      sizes[name] = parseInt(sizeStr, 10) || 0;
    }
    res.json({ sizes });
  } catch {
    res.json({ sizes: {} });
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
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ type: 'text', content, extension: ext });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

app.put('/api/files/content', (req, res) => {
  const filePath = req.body?.path as string;
  const content = req.body?.content as string;

  if (!filePath || typeof content !== 'string' || !isPathSafe(filePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot write to directory' });
    }
  } catch {
    // File doesn't exist yet — that's OK, we'll create it
  }

  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Create a new directory
app.post('/api/files/mkdir', (req, res) => {
  const dirPath = req.body?.path as string;

  if (!dirPath || !isPathSafe(dirPath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (fs.existsSync(dirPath)) {
    return res.status(409).json({ error: 'Already exists' });
  }

  try {
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// Create a new empty file
app.post('/api/files/create', (req, res) => {
  const filePath = req.body?.path as string;

  if (!filePath || !isPathSafe(filePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (fs.existsSync(filePath)) {
    return res.status(409).json({ error: 'Already exists' });
  }

  try {
    fs.writeFileSync(filePath, '', 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to create file' });
  }
});

// Move / rename a file or directory
app.post('/api/files/move', (req, res) => {
  const src = req.body?.src as string;
  const dest = req.body?.dest as string;

  if (!src || !dest || !isPathSafe(src) || !isPathSafe(dest)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(src)) {
    return res.status(404).json({ error: 'Source not found' });
  }

  if (fs.existsSync(dest)) {
    return res.status(409).json({ error: 'Destination already exists' });
  }

  try {
    fs.renameSync(src, dest);
    res.json({ success: true });
  } catch {
    // rename may fail across filesystems
    try {
      execSync(`mv ${JSON.stringify(src)} ${JSON.stringify(dest)}`);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to move' });
    }
  }
});

app.get('/api/files/stream', (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath || !isPathSafe(filePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) return res.status(400).end();

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
      '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    const fileSize = stats.size;
    const range = req.headers.range;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', end - start + 1);
      res.status(206);
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (e) {
    res.status(500).end();
  }
});

// Download directory as zip
app.get('/api/files/download-zip', (req, res) => {
  const dirPath = req.query.path as string;

  if (!dirPath || !isPathSafe(dirPath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
  } catch {
    return res.status(404).json({ error: 'Directory not found' });
  }

  const dirName = path.basename(dirPath);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${dirName}.zip"`);

  const { spawn: cpSpawnLocal } = require('child_process');
  const zipProc = cpSpawnLocal('zip', ['-r', '-q', '-', '.'], { cwd: dirPath, stdio: ['ignore', 'pipe', 'pipe'] });
  zipProc.stdout.pipe(res);
  zipProc.stderr.on('data', (data: Buffer) => {
    console.error(`[zip] ${data.toString()}`);
  });
  zipProc.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create zip' });
  });
  req.on('close', () => { zipProc.kill(); });
});

// File upload API — multer stores to a temp dir, then we move to the target directory
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit

app.post('/api/files/upload', upload.array('files'), (req, res) => {
  const targetDir = (req.body?.path as string) || WORKSPACE_ROOT;

  if (!isPathSafe(targetDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return res.status(400).json({ error: 'Target directory does not exist' });
  }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  const results: { name: string; size: number; error?: string }[] = [];

  for (const file of files) {
    const destPath = path.join(targetDir, file.originalname);
    try {
      fs.renameSync(file.path, destPath);
      results.push({ name: file.originalname, size: file.size });
    } catch (e) {
      // rename may fail across filesystems, fall back to copy
      try {
        fs.copyFileSync(file.path, destPath);
        fs.unlinkSync(file.path);
        results.push({ name: file.originalname, size: file.size });
      } catch (e2) {
        // Clean up temp file
        try { fs.unlinkSync(file.path); } catch {}
        results.push({ name: file.originalname, size: file.size, error: 'Failed to save' });
      }
    }
  }

  res.json({ uploaded: results });
});

// Chat session management - persist session mapping to disk for auto-resume
// Map format: { sessionName: { sessionId, cwd } }
const SESSION_MAP_PATH = path.join(WORKSPACE_ROOT, '.terminal-chat-sessions.json');

interface SessionMapEntry {
  sessionId: string;
  cwd: string;
}

function loadSessionMap(): Record<string, SessionMapEntry | string> {
  try {
    return JSON.parse(fs.readFileSync(SESSION_MAP_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSessionMap(map: Record<string, SessionMapEntry | string>): void {
  fs.writeFileSync(SESSION_MAP_PATH, JSON.stringify(map, null, 2));
}

// Get a resumable session ID for a given name+cwd combo
function getResumableSession(name: string, cwd: string): string | null {
  const map = loadSessionMap();
  const entry = map[name];
  if (!entry) return null;
  // Handle old format (plain string) — can't verify cwd, skip
  if (typeof entry === 'string') return null;
  // Only resume if cwd matches
  if (entry.cwd === cwd) return entry.sessionId;
  return null;
}

function saveSession(name: string, sessionId: string, cwd: string): void {
  const map = loadSessionMap();
  map[name] = { sessionId, cwd };
  saveSessionMap(map);
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: unknown;
  timestamp: number;
}

// Helper: run tmux commands without shell escaping issues
function tmux(...args: string[]): string {
  const fullArgs = TMUX_SOCKET ? ['-S', TMUX_SOCKET, ...args] : args;
  return execFileSync('tmux', fullArgs, { encoding: 'utf-8' }).trim();
}

// Strip ANSI escape sequences from pipe-pane output
function stripAnsi(s: string): string {
  return s.replace(/[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|\x1b\][^\x07]*\x07/g, '');
}

class ChatSession {
  name: string;
  messages: ChatMessage[] = [];
  browsers: Set<WebSocket> = new Set();
  isStreaming = false;
  claudeSessionId: string | null = null;
  cwd: string;
  private resumedSessionId: string | null = null;
  private outputFile: string;
  private inputFile: string;
  private tailProcess: ChildProcess | null = null;
  private exitCheckInterval: ReturnType<typeof setInterval> | null = null;
  private claudeRunning = false;
  private startGeneration = 0;

  constructor(name: string, resumeSessionId?: string, cwd?: string) {
    this.name = name;
    this.cwd = cwd || getTmuxPaneCwd(name) || WORKSPACE_ROOT;
    this.outputFile = `/tmp/claude-chat-${name}-output.ndjson`;
    this.inputFile = `/tmp/claude-chat-${name}-stdin`;
    console.log(`[chat:${this.name}] Working directory: ${this.cwd}`);

    if (resumeSessionId) {
      this.resumedSessionId = resumeSessionId;
    } else {
      const savedId = getResumableSession(name, this.cwd);
      if (savedId) {
        this.resumedSessionId = savedId;
        console.log(`[chat:${this.name}] Auto-resuming session ${this.resumedSessionId}`);
      }
    }

    // Ensure tmux session exists
    if (!sessionExists(name)) {
      createTmuxSession(name);
    }

    this.startClaude();
  }

  private startClaude() {
    this.startGeneration++;
    const gen = this.startGeneration;

    // Cleanup previous reader
    this.stopReader();

    // Clear output file and input file
    fs.writeFileSync(this.outputFile, '');
    fs.writeFileSync(this.inputFile, '');

    // Stop any existing pipe-pane, then start fresh
    try { tmux('pipe-pane', '-t', this.name); } catch {}
    tmux('pipe-pane', '-O', '-t', this.name, `cat >> '${this.outputFile}'`);

    // Start reading output via tail -f
    this.startOutputReader(gen);

    // Build the claude command — pipe stdin from input file so Claude sees a pipe, not a TTY
    const args = ['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
    if (this.resumedSessionId) {
      args.push('--resume', this.resumedSessionId);
    }
    // tail -f on the input file feeds stdin to Claude via pipe (not TTY)
    const cmd = `cd '${this.cwd}' && tail -f '${this.inputFile}' | ${args.join(' ')}`;

    // Wait for any previous Claude to exit, then inject command
    this.waitAndInject(cmd, gen);
  }

  private waitAndInject(cmd: string, gen: number) {
    if (gen !== this.startGeneration) return;

    let paneCmd = '';
    try {
      paneCmd = tmux('display-message', '-p', '-t', this.name, '#{pane_current_command}');
    } catch {}

    if (paneCmd === 'claude' || paneCmd === 'tail') {
      setTimeout(() => this.waitAndInject(cmd, gen), 300);
      return;
    }

    console.log(`[chat:${this.name}] Injecting Claude into tmux${this.resumedSessionId ? ` (resume ${this.resumedSessionId})` : ''}`);
    tmux('send-keys', '-l', '-t', this.name, cmd);
    tmux('send-keys', '-t', this.name, 'Enter');

    this.startExitCheck(gen);
  }

  private startOutputReader(gen: number) {
    this.tailProcess = cpSpawn('tail', ['-f', '-n', '+1', this.outputFile]);
    const rl = readline.createInterface({ input: this.tailProcess.stdout! });
    rl.on('line', (rawLine) => {
      if (gen !== this.startGeneration) return;
      // Strip ANSI escape codes from pipe-pane output
      const line = stripAnsi(rawLine).trim();
      if (!line) return;
      // Try to find JSON in the line (may be preceded by shell noise)
      const jsonStart = line.indexOf('{');
      if (jsonStart < 0) return;
      try {
        const msg = JSON.parse(line.slice(jsonStart));
        this.handleClaudeMessage(msg);
      } catch {
        // Not valid JSON — skip
      }
    });
    this.tailProcess.on('exit', () => {
      if (this.tailProcess?.pid === undefined) this.tailProcess = null;
    });
  }

  private startExitCheck(gen: number) {
    if (this.exitCheckInterval) clearInterval(this.exitCheckInterval);

    this.exitCheckInterval = setInterval(() => {
      if (gen !== this.startGeneration) {
        clearInterval(this.exitCheckInterval!);
        this.exitCheckInterval = null;
        return;
      }
      try {
        const cmd = tmux('display-message', '-p', '-t', this.name, '#{pane_current_command}');
        // The pane_current_command is 'tail' when `tail -f | claude` is running
        // (tail is the pipeline leader). Claude exiting makes tail get SIGPIPE and exit too.
        const running = cmd === 'claude' || cmd === 'tail';
        if (!this.claudeRunning && running) {
          this.claudeRunning = true;
          console.log(`[chat:${this.name}] Claude is running in tmux`);
        } else if (this.claudeRunning && !running) {
          this.claudeRunning = false;
          this.isStreaming = false;
          console.log(`[chat:${this.name}] Claude exited in tmux`);
          this.broadcast({ type: 'process_exit', code: 0 });
          clearInterval(this.exitCheckInterval!);
          this.exitCheckInterval = null;
        }
      } catch {}
    }, 1500);
  }

  private stopReader() {
    if (this.tailProcess) {
      this.tailProcess.kill();
      this.tailProcess = null;
    }
    if (this.exitCheckInterval) {
      clearInterval(this.exitCheckInterval);
      this.exitCheckInterval = null;
    }
  }

  private handleClaudeMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;
    const subtype = msg.subtype as string | undefined;

    if (type === 'system' && subtype === 'init') {
      if (msg.session_id) {
        this.claudeSessionId = msg.session_id as string;
        saveSession(this.name, this.claudeSessionId, this.cwd);
        console.log(`[chat:${this.name}] Session ID captured: ${this.claudeSessionId}`);
      }
      this.broadcast(msg);
    } else if (type === 'assistant') {
      this.isStreaming = true;
      const chatMsg: ChatMessage = { role: 'assistant', content: msg, timestamp: Date.now() };
      this.messages.push(chatMsg);
      this.broadcast(msg);
    } else if (type === 'result') {
      this.isStreaming = false;
      const chatMsg: ChatMessage = { role: 'system', content: msg, timestamp: Date.now() };
      this.messages.push(chatMsg);
      this.broadcast(msg);
    } else if (type === 'user') {
      const chatMsg: ChatMessage = { role: 'user', content: msg, timestamp: Date.now() };
      this.messages.push(chatMsg);
      this.broadcast(msg);
    } else if (type === 'system') {
      this.broadcast(msg);
    } else {
      this.broadcast(msg);
    }
  }

  // Send a JSON line to Claude by appending to the input file (tail -f feeds it to stdin)
  private writeToStdin(ndjson: string) {
    try {
      fs.appendFileSync(this.inputFile, ndjson + '\n');
    } catch (e) {
      console.error(`[chat:${this.name}] Failed to write to stdin file:`, e);
    }
  }

  resumeSession(sessionId: string) {
    // Send Ctrl+C to stop current Claude
    try { tmux('send-keys', '-t', this.name, 'C-c'); } catch {}
    this.messages = [];
    this.isStreaming = false;
    this.claudeRunning = false;
    this.resumedSessionId = sessionId;
    this.broadcast({ type: 'session_resumed', sessionId });
    // Wait for Claude to exit, then restart
    setTimeout(() => this.startClaude(), 500);
  }

  setCwd(newCwd: string) {
    if (!fs.existsSync(newCwd) || !fs.statSync(newCwd).isDirectory()) return;
    this.cwd = newCwd;
    console.log(`[chat:${this.name}] Working directory changed to: ${this.cwd}`);
    try { tmux('send-keys', '-t', this.name, 'C-c'); } catch {}
    this.messages = [];
    this.isStreaming = false;
    this.claudeRunning = false;
    this.resumedSessionId = null;
    this.broadcast({ type: 'cwd_changed', cwd: this.cwd });
    setTimeout(() => this.startClaude(), 500);
  }

  interrupt() {
    console.log(`[chat:${this.name}] Sending Ctrl+C to tmux pane`);
    try { tmux('send-keys', '-t', this.name, 'C-c'); } catch {}
  }

  sendUserMessage(text: string) {
    const userMsg: ChatMessage = {
      role: 'user',
      content: { type: 'user', text },
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);

    const ndjson = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    });
    this.writeToStdin(ndjson);
    this.isStreaming = true;
  }

  sendToolResult(toolUseId: string, content: string) {
    const ndjson = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
      },
    });
    this.writeToStdin(ndjson);
    this.isStreaming = true;
    console.log(`[chat:${this.name}] Sent tool_result for ${toolUseId}`);
  }

  attachBrowser(ws: WebSocket) {
    this.browsers.add(ws);
    ws.send(JSON.stringify({
      type: 'history',
      messages: this.messages.map(m => m.content),
      cwd: this.cwd,
    }));
  }

  detachBrowser(ws: WebSocket) {
    this.browsers.delete(ws);
  }

  private broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const ws of this.browsers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  stop() {
    this.startGeneration++; // invalidate all pending callbacks
    try { tmux('send-keys', '-t', this.name, 'C-c'); } catch {}
    try { tmux('pipe-pane', '-t', this.name); } catch {} // stop pipe-pane
    this.stopReader();
    for (const ws of this.browsers) {
      ws.close();
    }
    this.browsers.clear();
  }
}

const chatSessions = new Map<string, ChatSession>();

// Chat REST endpoints
app.get('/api/chat/sessions', (_req, res) => {
  const sessions = Array.from(chatSessions.entries()).map(([name, session]) => ({
    name,
    messageCount: session.messages.length,
    isStreaming: session.isStreaming,
    browserCount: session.browsers.size,
  }));
  res.json(sessions);
});

// Extract last real user message from a JSONL session file
// For large files, only reads the last 100KB to avoid loading entire file
const SKIP_PREFIXES = [
  '[Request interrupted',
  'Base directory for this skill:',
  'Continue from where you left off',
];

function extractUserText(line: string): string | null {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'user' && obj.message?.content) {
      for (const c of obj.message.content) {
        if (c.type === 'text' && c.text) {
          const text = c.text.trim();
          if (SKIP_PREFIXES.some(p => text.startsWith(p))) return null;
          return text.slice(0, 200);
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

function readChunkMessages(filePath: string, startByte: number, skipFirst: boolean): Promise<string> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8', start: startByte });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lastMsg = '';
    let first = skipFirst;
    rl.on('line', (line) => {
      if (first) { first = false; return; }
      if (!line.trim()) return;
      const text = extractUserText(line);
      if (text) lastMsg = text;
    });
    rl.on('close', () => resolve(lastMsg));
    rl.on('error', () => resolve(''));
  });
}

async function extractLastUserMessage(filePath: string, fileSize: number): Promise<string> {
  // For large files, read the last 500KB (most likely has the last real message)
  const TAIL_BYTES = 500 * 1024;
  if (fileSize > TAIL_BYTES) {
    const result = await readChunkMessages(filePath, fileSize - TAIL_BYTES, true);
    if (result) return result;
  }
  // For small files or if tail had no messages, read entire file
  return readChunkMessages(filePath, 0, false);
}

// Convert dir name like "-home-selstad-Desktop-CascadeStudio" to readable project label
// Since hyphens are ambiguous (path sep vs part of name), reconstruct actual path
function projectLabel(dirName: string): string {
  const home = os.homedir();
  // The dir name is the absolute path with / replaced by -
  // Reconstruct by trying to find the actual directory
  const candidate = '/' + dirName.replace(/^-/, '').replace(/-/g, '/');
  // Strip home prefix to get relative path, then take last 2 segments
  const rel = candidate.startsWith(home) ? candidate.slice(home.length + 1) : candidate;
  const segments = rel.split('/').filter(Boolean);
  if (segments.length <= 2) return segments.join('/');
  return segments.slice(-2).join('/');
}

// List resumable Claude sessions from all project directories
app.get('/api/chat/history', async (_req, res) => {
  try {
    const projectsRoot = path.join(os.homedir(), '.claude', 'projects');

    if (!fs.existsSync(projectsRoot)) {
      return res.json([]);
    }

    // Scan all project directories for JSONL session files
    const projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory());

    interface SessionEntry {
      sessionId: string;
      project: string;
      filePath: string;
      lastMessage: string;
      modifiedAt: string;
      modifiedMs: number;
      fileSize: number;
    }

    const allSessions: SessionEntry[] = [];

    for (const dir of projectDirs) {
      const dirPath = path.join(projectsRoot, dir.name);
      const project = projectLabel(dir.name);
      let jsonlFiles: string[];
      try {
        jsonlFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
      } catch { continue; }

      for (const f of jsonlFiles) {
        const fullPath = path.join(dirPath, f);
        const sessionId = f.replace('.jsonl', '');
        let stats;
        try { stats = fs.statSync(fullPath); } catch { continue; }

        allSessions.push({
          sessionId,
          project,
          filePath: fullPath,
          lastMessage: '',
          modifiedAt: stats.mtime.toISOString(),
          modifiedMs: stats.mtimeMs,
          fileSize: stats.size,
        });
      }
    }

    // Sort by file mtime (= last write = last message time), take top candidates
    allSessions.sort((a, b) => b.modifiedMs - a.modifiedMs);
    const top = allSessions.slice(0, 100); // grab extra since some won't have messages

    await Promise.all(top.map(async (s) => {
      s.lastMessage = await extractLastUserMessage(s.filePath, s.fileSize);
    }));

    const result = top
      .filter(s => s.lastMessage)
      .slice(0, 50)
      .map(({ modifiedMs, fileSize, filePath, ...rest }) => rest);

    res.json(result);
  } catch (e) {
    console.error('Failed to list chat history:', e);
    res.status(500).json({ error: 'Failed to list chat history' });
  }
});

app.delete('/api/chat/:name', (req, res) => {
  const { name } = req.params;
  const session = chatSessions.get(name);
  if (session) {
    session.stop();
    chatSessions.delete(name);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Chat session not found' });
  }
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket servers (noServer mode for path-based routing)
const terminalWss = new WebSocketServer({ noServer: true });
const chatWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/ws/terminal') {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/chat') {
    chatWss.handleUpgrade(request, socket, head, (ws) => {
      chatWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Terminal WebSocket handler
interface TerminalConnection {
  pty: IPty;
  ws: WebSocket;
}

const connections = new Map<string, TerminalConnection>();

terminalWss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionName = url.searchParams.get('session');

  if (!sessionName) {
    ws.close(1008, 'Session name required');
    return;
  }

  const sanitized = sessionName.replace(/[^a-zA-Z0-9-_]/g, '');
  console.log(`Connecting to session: ${sanitized}`);

  if (!sessionExists(sanitized)) {
    if (!createTmuxSession(sanitized)) {
      ws.close(1011, 'Failed to create session');
      return;
    }
  }

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

// Chat WebSocket handler
chatWss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionName = url.searchParams.get('session');

  if (!sessionName) {
    ws.close(1008, 'Session name required');
    return;
  }

  const sanitized = sessionName.replace(/[^a-zA-Z0-9-_]/g, '');
  console.log(`[chat] Browser connected for session: ${sanitized}`);

  // Get or create chat session
  let chatSession = chatSessions.get(sanitized);
  if (!chatSession) {
    chatSession = new ChatSession(sanitized);
    chatSessions.set(sanitized, chatSession);
  }

  chatSession.attachBrowser(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'user' && data.text) {
        chatSession!.sendUserMessage(data.text);
      } else if (data.type === 'resume' && data.sessionId) {
        console.log(`[chat:${sanitized}] Resuming session ${data.sessionId}`);
        chatSession!.resumeSession(data.sessionId);
      } else if (data.type === 'question_response' && data.toolUseId && data.answers) {
        chatSession!.sendToolResult(data.toolUseId, JSON.stringify({ answers: data.answers }));
      } else if (data.type === 'set_cwd' && data.cwd) {
        chatSession!.setCwd(data.cwd);
      } else if (data.type === 'interrupt') {
        chatSession!.interrupt();
      }
    } catch (e) {
      console.error(`[chat:${sanitized}] Failed to parse browser message:`, e);
    }
  });

  ws.on('close', () => {
    console.log(`[chat] Browser disconnected from session: ${sanitized}`);
    chatSession!.detachBrowser(ws);
  });

  ws.on('error', (err) => {
    console.error(`[chat:${sanitized}] WebSocket error:`, err);
    chatSession!.detachBrowser(ws);
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
