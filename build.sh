#!/bin/bash
# Build both server and frontend, then restart the service
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building server..."
cd "$DIR/server" && npx tsc

echo "Building frontend..."
cd "$DIR/frontend" && npm run build

echo "Restarting terminal-server..."
systemctl --user restart terminal-server

echo "Done. Checking status..."
sleep 1
systemctl --user status terminal-server --no-pager | head -5
