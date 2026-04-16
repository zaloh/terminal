# Scripts

Supporting assets installed by `install.sh` at the repo root.

## `hooks/terminal-meta.py`

Claude Code hook that writes per-tmux-session metadata (status / task / cwd /
preview URL / Claude session id) to `$CLAUDE_META_DIR/<session>.json` (default
`/tmp/claude-terminal-meta`). Fires on `UserPromptSubmit`, `Stop`,
`SessionStart`, `SessionEnd`. The terminal server reads these files to populate
the session list and the per-session header in the UI.

Installed to `~/.claude/hooks/terminal-meta.py` and registered in
`~/.claude/settings.json`.

## `bin/tm-meta`

CLI agents use from inside a tmux session to write fields the hook doesn't
derive automatically — mainly `preview_url`:

```sh
tm-meta preview http://localhost:5173   # register a dev-server URL
tm-meta clear preview_url               # remove it
tm-meta set task "..."                  # override auto-derived task
tm-meta get                             # dump current metadata
```

Installed to `~/.claude/bin/tm-meta`. `install.sh` adds a one-line hint
reminding you to put `~/.claude/bin` on your `PATH` if it isn't already.

## `terminal-server.service.template`

Systemd user-unit template. `install.sh` substitutes `__REPO_DIR__`,
`__NODE_BIN__`, `__TMUX_SOCKET__`, `__PORT__` and writes the result to
`~/.config/systemd/user/terminal-server.service`.
