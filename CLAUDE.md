# Terminal Project

Read `README.md` for project overview, setup, and service management instructions.

## Known Issues

- **WebGL renderer disabled (2026-04-08):** xterm.js WebGL addon causes glyph corruption (only top-left corner of each character renders). Likely caused by an iOS Safari WebGL regression. The WebGL addon is commented out in `frontend/src/components/Terminal.tsx` (~line 244) in favor of the DOM renderer. If a future iOS update fixes this, re-enable WebGL there for better rendering performance.
