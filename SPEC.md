# Prototype: Mobile Terminal for Claude Code

## Summary

A mobile-first web terminal application that provides a polished dark-mode interface for running Claude Code and other CLI tools remotely. Features include a chord-builder for modifier keys (auto-releasing after each chord), virtual arrow keys and shortcuts in a fixed top bar, a two-tab interface (Terminal | Files), tmux-backed session persistence, and multi-session support with session IDs in URL query params. Sessions run as a non-root user with sudo access to support privileged operations safely. Protected by Cloudflare Zero Trust allowing only `makeshifted@gmail.com` via Google OAuth.

## Technical Decisions

### Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Frontend** | React + TypeScript + Vite | Modern, fast builds, good mobile support |
| **Terminal Emulator** | xterm.js + xterm-addon-fit + xterm-addon-webgl | Industry standard, VS Code uses it, WebGL for performance |
| **Backend** | Node.js + Express + ws | Native PTY support via node-pty, WebSocket for terminal I/O |
| **PTY** | node-pty | Spawn pseudo-terminals, works with tmux |
| **Session Persistence** | tmux | Sessions survive disconnects, can reattach |
| **Styling** | Tailwind CSS | Rapid dark-mode styling, mobile-first utilities |
| **Auth** | Cloudflare Access (Zero Trust) | Sits in front of tunnel, Google OAuth to single email |
| **Tunnel** | cloudflared | Exposes local server to terminal.sels.tech |
| **Process Manager** | systemd | Runs server as always-on service, auto-restart on failure |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Mobile Browser                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  React App                                                   │ │
│  │  ┌──────────────┐  ┌──────────────────────────────────────┐ │ │
│  │  │ Tab Bar      │  │ Terminal Tab        │ Files Tab      │ │ │
│  │  │ [Term][Files]│  │ ┌──────────────────┐│ ┌────────────┐ │ │ │
│  │  └──────────────┘  │ │ xterm.js         ││ │ File Tree  │ │ │ │
│  │  ┌──────────────┐  │ │                  ││ │            │ │ │ │
│  │  │ Control Bar  │  │ │                  ││ │────────────│ │ │ │
│  │  │ [Ctrl][Alt]  │  │ │                  ││ │ File View  │ │ │ │
│  │  │ [Shift][Tab] │  │ │                  ││ │ (read-only)│ │ │ │
│  │  │ [Esc][←↑↓→]  │  │ └──────────────────┘│ └────────────┘ │ │ │
│  │  └──────────────┘  └──────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS + WSS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Cloudflare Access                                           │ │
│  │ - Google OAuth                                               │ │
│  │ - Email policy: makeshifted@gmail.com only                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Cloudflare Tunnel (cloudflared)                             │ │
│  │ terminal.sels.tech → localhost:3000                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    This Machine (localhost:3000)                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Node.js Server                                               │ │
│  │                                                              │ │
│  │ REST API:                    WebSocket:                      │ │
│  │ GET  /api/sessions           /ws/terminal?session=xxx        │ │
│  │ POST /api/sessions           - Attaches to tmux session      │ │
│  │ DELETE /api/sessions/:id     - Streams I/O via node-pty     │ │
│  │ GET  /api/files?path=...                                     │ │
│  │ GET  /api/files/content?path=...                             │ │
│  │                                                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ tmux sessions (running as 'terminal' user)                   │ │
│  │ - terminal-session-abc123                                    │ │
│  │ - terminal-session-def456                                    │ │
│  │ - ...                                                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### User Setup

Sessions run as a dedicated non-root user (`terminal`) with:
- Home directory: `/home/terminal`
- Working directory: `/root/workspace` (with appropriate permissions)
- Passwordless sudo access via `/etc/sudoers.d/terminal`
- This allows running `sudo` commands without password prompts

```bash
# Setup commands (run once as root):
useradd -m -s /bin/bash terminal
echo "terminal ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/terminal
chmod 440 /etc/sudoers.d/terminal
# Grant access to workspace:
setfacl -R -m u:terminal:rwx /root/workspace
setfacl -R -d -m u:terminal:rwx /root/workspace
```

### Session Flow

1. User visits `terminal.sels.tech` (no query param)
2. Cloudflare Access prompts Google login → validates email
3. Landing page shows:
   - List of active tmux sessions
   - "New Session" button → prompts for name
4. User clicks session or creates new → redirects to `?session=session-name`
5. Frontend connects WebSocket to `/ws/terminal?session=session-name`
6. Backend creates/attaches to tmux session, spawns PTY
7. If browser disconnects, tmux session persists
8. User can reconnect later and resume

### File Browser Flow

1. User switches to Files tab
2. Frontend calls `GET /api/files?path=/root/workspace`
3. Backend returns directory listing (name, type, size, modified)
4. User clicks file → `GET /api/files/content?path=...`
5. Backend returns file content (text or base64 for images)
6. Frontend renders with syntax highlighting (text) or `<img>` (images)
7. Max file size: 6MB (enforced server-side)

## Design Decisions

### Visual Direction

- **Dark mode**: Deep charcoal background (#1a1a2e), not pure black
- **Accent color**: Soft cyan (#4fd1c5) for interactive elements
- **Typography**:
  - Terminal: JetBrains Mono or Fira Code (monospace)
  - UI: Inter or system sans-serif
- **Corners**: Subtle rounding (4-8px) for polished feel
- **Spacing**: Generous touch targets (44px minimum for buttons)

### Key UI Elements

#### Control Bar (Fixed Top)
```
┌──────────────────────────────────────────────────────────────┐
│ [Ctrl] [Alt] [Shift] │ [Tab] [Esc] [Paste] │ [←] [↑] [↓] [→] │
└──────────────────────────────────────────────────────────────┘
```
- Modifier keys (Ctrl, Alt, Shift) are **toggles** - tap to activate, tap again to deactivate
- Active modifiers show highlighted state (e.g., glowing border or filled background)
- When modifier active + regular key pressed → sends chord (e.g., Ctrl+C)
- **Modifiers auto-release after chord is sent** (tap Ctrl → tap C → Ctrl+C sent → Ctrl deactivates)
- Can stack multiple modifiers before pressing final key (Ctrl+Alt+Delete)
- Arrow keys, Tab, Esc send immediately (no modifier stacking needed)
- **Paste button**: Reads from clipboard (via `navigator.clipboard.readText()`) and sends to terminal
  - Requires HTTPS (provided by Cloudflare)
  - Browser will prompt for clipboard permission on first use

#### Tab Bar
```
┌─────────────────────┐
│ [Terminal] [Files]  │
└─────────────────────┘
```
- Simple two-tab interface
- Active tab visually distinct
- Swipe gesture to switch? (stretch goal)

#### Session List (Landing Page)
```
┌────────────────────────────────────────┐
│         Active Sessions                 │
├────────────────────────────────────────┤
│ ● claude-project    2 min ago     [→]  │
│ ● server-debug      1 hour ago    [→]  │
│ ● experiments       3 days ago    [→]  │
├────────────────────────────────────────┤
│        [+ New Session]                  │
└────────────────────────────────────────┘
```

#### File Browser
```
┌────────────────────────────────────────┐
│ /root/workspace                    [↑] │
├────────────────────────────────────────┤
│ 📁 .git/                               │
│ 📁 terminal/                           │
│ 📁 other-project/                      │
│ 📄 .gitignore                    128B  │
│ 📄 PROTOTYPE_GUIDELINES.md      12KB   │
└────────────────────────────────────────┘
```
- Breadcrumb or path display at top
- Up button to navigate parent
- Icons for folders vs files
- File size displayed
- **Shows hidden files (dotfiles)** - sorted with directories first, then files
- Tap folder to enter, tap file to view

#### File Viewer
- Syntax highlighting for code (highlight.js or Prism)
- Line numbers
- Image rendering for PNG, JPG, GIF, SVG, WebP
- "Too large" message for files > 6MB
- Back button to return to browser

## Scope

### In Scope (MVP)

- [x] Two-tab interface (Terminal | Files)
- [x] xterm.js terminal with WebSocket backend
- [x] tmux session persistence per named session
- [x] Session ID in URL query param
- [x] Session list landing page
- [x] New session creation with name prompt
- [x] Control bar with chord builder (Ctrl, Alt, Shift toggles)
- [x] Virtual keys: Tab, Esc, Arrow keys, Paste button
- [x] File browser for /root/workspace (shows hidden files)
- [x] Read-only file viewing (text + images)
- [x] 6MB file size limit
- [x] Sessions run as non-root user with sudo access
- [x] Dark mode polished UI
- [x] Mobile-first responsive design
- [x] cloudflared tunnel to terminal.sels.tech
- [x] Cloudflare Access with Google OAuth (makeshifted@gmail.com only)
- [x] systemd service for always-on server

### Explicitly Out of Scope

- File editing/writing (read-only for now)
- File upload/download
- Multiple terminals in split view
- Terminal themes/customization
- Session sharing between users
- Audio/notification alerts
- Clipboard sync (rely on browser)
- Offline mode
- Kill session button (use `exit` command in terminal instead)

## Known Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| tmux per session | More processes, but clean isolation and persistence |
| xterm.js over textual-web | More work, but full control over mobile UX |
| Node.js backend | Not Cloudflare Worker (can't run PTY), but necessary for terminal |
| Chord builder over gestures | Less discoverable, but more precise control |
| Read-only files | Simpler, safer; editing can be done in terminal |
| Non-root user with sudo | Extra setup, but safer default + supports `visudo` and similar tools |

## Resolved Questions

1. ~~Should modifiers auto-release after a chord?~~ **Yes, auto-release after each chord**
2. ~~Should there be a "kill session" button?~~ **No, use `exit` command**
3. ~~Should file browser show hidden files?~~ **Yes, show dotfiles**

## Open Questions

1. Rate limiting on file API to prevent abuse?
2. Session timeout/cleanup for abandoned sessions?

## Security Considerations

- Cloudflare Access handles authentication before traffic reaches server
- No direct exposure of server to internet (tunnel only)
- **tmux sessions run as dedicated non-root user (`terminal`)** with sudo access
- Principle of least privilege: non-root by default, sudo when needed
- File API restricted to /root/workspace (no path traversal)
- WebSocket validates session parameter

## Subdomain

- **URL**: https://terminal.sels.tech
- **Tunnel**: `terminal` (to be created)
- **Backend**: localhost:3000

## Service Configuration

The server runs as a systemd service for always-on availability:

```ini
# /etc/systemd/system/terminal-server.service
[Unit]
Description=Mobile Terminal Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/workspace/terminal
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start:
systemctl daemon-reload
systemctl enable terminal-server
systemctl start terminal-server

# View logs:
journalctl -u terminal-server -f
```

The cloudflared tunnel should also run as a service (installed via `cloudflared service install`).

---
*Generated from interview on 2026-01-01*
