# Mobile Terminal - Local Development Notes

## Repository Setup

This is a fork of [zalo/terminal](https://github.com/zalo/terminal).

**Remotes:**
- `origin` → `https://github.com/zaloh/terminal.git` (this fork)
- `upstream` → `https://github.com/zalo/terminal.git` (original)

**To pull updates from original:**
```bash
git pull upstream main
```

## Installation

- Location: `/opt/terminal`
- Runtime: Node.js 22, tmux
- Service port: 3000

## Systemd Service

The service runs as root and starts at boot (before login) via multi-user.target.

**Service file:** `/etc/systemd/system/terminal-server.service`

**Commands:**
```bash
sudo systemctl status terminal-server.service  # check status
sudo systemctl restart terminal-server.service  # restart after changes
sudo systemctl disable terminal-server.service  # disable auto-start
```

## Building After Updates

```bash
cd /opt/terminal/server && npm run build
cd /opt/terminal/frontend && npm run build
sudo systemctl restart terminal-server.service
```

## Development Mode

```bash
cd /opt/terminal
./dev.sh
```
