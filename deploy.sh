#!/usr/bin/env bash
# Deploy reisekosten to production server (188.245.191.188)
# Usage: ./deploy.sh [--frontend-only | --backend-only]

set -euo pipefail

SERVER="root@188.245.191.188"
SSH_KEY="$HOME/.ssh/wsai_deploy_key"
REMOTE_DIR="/opt/reisekosten"
API_URL="http://188.245.191.188:8010"

ssh_cmd() { ssh -i "$SSH_KEY" "$SERVER" "$@"; }
scp_cmd() { scp -i "$SSH_KEY" "$@"; }

MODE="${1:-all}"

# ── Frontend ──────────────────────────────────────────────────────────────────
if [[ "$MODE" == "all" || "$MODE" == "--frontend-only" ]]; then
  echo "Building frontend..."
  (cd frontend && VITE_API_BASE_URL="$API_URL" npm run build)

  echo "Deploying frontend dist..."
  ssh_cmd "mkdir -p $REMOTE_DIR/frontend/dist"
  scp_cmd -r frontend/dist/* "$SERVER:$REMOTE_DIR/frontend/dist/"
  echo "Frontend deployed."
fi

# ── Backend ───────────────────────────────────────────────────────────────────
if [[ "$MODE" == "all" || "$MODE" == "--backend-only" ]]; then
  echo "Syncing backend files to server..."
  ssh_cmd "mkdir -p $REMOTE_DIR"
  rsync -avz -e "ssh -i $SSH_KEY" \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='frontend/node_modules' \
    --exclude='frontend/dist' \
    --exclude='data' \
    . "$SERVER:$REMOTE_DIR/"

  echo "Building and starting Docker containers..."
  ssh_cmd "cd $REMOTE_DIR && docker compose up -d --build"

  echo "Waiting for health check..."
  sleep 10
  ssh_cmd "docker ps | grep reisekosten"
  echo "Backend deployed."
fi

echo ""
echo "Done! App available at: http://188.245.191.188:8010"
