#!/usr/bin/env python3
"""Claude Code hook: write per-tmux-session metadata the terminal UI reads.

Fires on UserPromptSubmit / Stop / SessionStart / SessionEnd. Looks up the
current tmux session via $TMUX and writes /tmp/claude-terminal-meta/<session>.json
with status, task summary, cwd, and claude session id. Preserves any fields
set by `tm-meta` (like preview_url) across turns.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

META_DIR = Path("/tmp/claude-terminal-meta")
# Preserve fields the agent sets manually via tm-meta — the hook must never clobber them.
AGENT_OWNED_FIELDS = ("preview_url",)


def tmux_session():
    t = os.environ.get("TMUX")
    if not t:
        return None
    sock = t.split(",", 1)[0]
    try:
        r = subprocess.run(
            ["tmux", "-S", sock, "display-message", "-p", "#S"],
            capture_output=True, text=True, timeout=2,
        )
        name = r.stdout.strip()
        if not name:
            return None
        # Defensive: strip path separators so the session name is safe as a filename.
        return re.sub(r"[/\\]", "_", name)
    except Exception:
        return None


def shorten(text, n=140):
    return " ".join((text or "").split())[:n]


def main():
    sess = tmux_session()
    if not sess:
        return 0

    META_DIR.mkdir(exist_ok=True)
    path = META_DIR / f"{sess}.json"

    meta = {}
    if path.exists():
        try:
            meta = json.loads(path.read_text())
        except Exception:
            meta = {}

    try:
        event = json.loads(sys.stdin.read() or "{}")
    except Exception:
        event = {}

    hook = event.get("hook_event_name", "")
    meta["session"] = sess
    meta["cwd"] = event.get("cwd") or meta.get("cwd") or os.getcwd()
    meta["claude_session_id"] = event.get("session_id") or meta.get("claude_session_id")
    meta["updated_at"] = int(time.time())

    if hook == "UserPromptSubmit":
        meta["status"] = "working"
        task = shorten(event.get("prompt", ""))
        if task:
            meta["task"] = task
    elif hook == "Stop":
        meta["status"] = "waiting"
    elif hook == "SessionStart":
        meta.setdefault("status", "idle")
        meta.setdefault("task", "")
    elif hook == "SessionEnd":
        meta["status"] = "finished"

    # Agent-owned fields are preserved implicitly (we never write them here),
    # but if the file was hand-wiped ensure they aren't stale.
    for f in AGENT_OWNED_FIELDS:
        if f in meta and not meta[f]:
            meta.pop(f, None)

    try:
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(meta, indent=2))
        tmp.replace(path)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
