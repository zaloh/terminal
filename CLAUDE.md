# Terminal Project

Read `README.md` for project overview, setup, and service management instructions.

## Known Issues

- **WebGL renderer disabled (2026-04-08):** xterm.js WebGL addon causes glyph corruption (only top-left corner of each character renders). Likely caused by an iOS Safari WebGL regression. The WebGL addon is commented out in `frontend/src/components/Terminal.tsx` (~line 244) in favor of the DOM renderer. If a future iOS update fixes this, re-enable WebGL there for better rendering performance.

## Claude Code status hooks

`install.sh` wires `scripts/hooks/terminal-meta.py` into `~/.claude/settings.json`
for `UserPromptSubmit`, `Stop`, `SessionStart`, and `SessionEnd`. The hook writes
per-session JSON (status, task, cwd, preview_url) to `$CLAUDE_META_DIR`
(default `/tmp/claude-terminal-meta`), which the server reads for
`/api/sessions/:name/meta`. `TerminalView` polls that endpoint every 2s so the
session list shows live working/waiting/finished/idle badges.

If a session is stuck showing the wrong status, delete the matching file in
`$CLAUDE_META_DIR` and trigger a new hook event (e.g. submit a prompt).

## VNC tab (optional)

When `VNC_URL` is set in `.env`, `/api/config` returns it and the frontend adds
a "VNC" tab that loads the URL in an iframe.

Install path:

```bash
sudo apt install novnc            # provides /usr/share/novnc
./install.sh --with-vnc           # installs scripts/ deps + novnc-proxy.service
```

Stack:

1. A VNC server on `localhost:5900` — `wayvnc` (Wayland/labwc) or `x11vnc` (X11).
2. `scripts/novnc-server.js` (systemd unit `novnc-proxy.service`) serves
   `/usr/share/novnc` over HTTP and proxies WebSocket → TCP on port 6901.
3. The browser loads `http://localhost:6901/vnc.html` in the "VNC" iframe.

Set in `.env`:

```
VNC_URL=http://localhost:6901/vnc.html
```

or a tunnel URL (see below).

## Cloudflared tunnel (remote access)

The terminal UI and noVNC are local services; expose them via a Cloudflare
tunnel for remote / mobile access. Install once per machine, authenticate
once per Cloudflare account.

```bash
# One-time install (Debian/Ubuntu):
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# One-time auth (opens a browser):
cloudflared tunnel login

# Create a named tunnel:
cloudflared tunnel create terminal
```

Then write `~/.cloudflared/config.yml`:

```yaml
tunnel: <UUID from `cloudflared tunnel list`>
credentials-file: /home/<user>/.cloudflared/<UUID>.json

ingress:
  - hostname: terminal.example.com
    service: http://localhost:3000
  - hostname: vnc.example.com
    service: http://localhost:6901
  - service: http_status:404
```

Route DNS and install as a system service:

```bash
cloudflared tunnel route dns terminal terminal.example.com
cloudflared tunnel route dns terminal vnc.example.com
sudo cloudflared service install
```

Update `.env` so the VNC tab uses the tunnel URL end-to-end:

```
VNC_URL=https://vnc.example.com/vnc.html
VITE_ALLOWED_HOSTS=terminal.example.com
```

Cloudflare Zero Trust Access policies (recommended) gate both hostnames behind
email-OTP or a GitHub identity provider — noVNC has no authentication of its
own, so without Access anyone with the URL can drive the desktop.
