#!/usr/bin/env node
// Combined noVNC HTTP + WebSocket-to-TCP proxy server
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const net = require('net');
const WebSocket = require('ws');

const NOVNC_DIR = '/usr/share/novnc';
const VNC_HOST = 'localhost';
const VNC_PORT = 5900;
const PORT = 6901;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

function serveStatic(req, res) {
  let filePath = path.join(NOVNC_DIR, req.url.pathname === '/' ? '/vnc.html' : req.url.pathname);
  if (!filePath.startsWith(NOVNC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + req.url.pathname);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  req.url = parsed;
  serveStatic(req, res);
});

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  console.log('WebSocket connection opened');
  const vnc = net.createConnection(VNC_PORT, VNC_HOST);

  ws.on('message', (data) => {
    if (vnc.writable) vnc.write(data);
  });
  ws.on('close', () => { vnc.end(); });
  ws.on('error', () => vnc.end());

  vnc.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  vnc.on('close', () => ws.close());
  vnc.on('error', (e) => { console.log('VNC error:', e.message); ws.close(); });
});

server.on('upgrade', (req, socket, head) => {
  const pathname = url.parse(req.url).pathname;
  // Handle multiple WebSocket paths: /, /proxy, /websockify
  if (pathname === '/' || pathname === '/proxy' || pathname === '/websockify') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`noVNC server listening on ${PORT} (HTTP + WebSocket proxy)`);
});
