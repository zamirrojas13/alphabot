#!/bin/bash
# deploy.sh — sync local changes to Oracle and restart the bot
# Usage: bash deploy.sh

ORACLE="ubuntu@163.192.100.135"
KEY="$(dirname "$0")/.keys/oracle.key"
BOT_DIR="/home/ubuntu/btc-bot"

echo "🚀 Deploying AlphaBot to Oracle..."

# Sync signal_engine + main.py (not .env or keys — those live on Oracle only)
ssh -i "$KEY" -o StrictHostKeyChecking=no "$ORACLE" "mkdir -p $BOT_DIR/signal_engine"
scp -i "$KEY" -o StrictHostKeyChecking=no \
  "$BOT_DIR/main.py" \
  "$BOT_DIR/requirements.txt" \
  "$ORACLE:$BOT_DIR/" 2>/dev/null || true

rsync -az --exclude='__pycache__' --exclude='*.pyc' \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  "$(dirname "$0")/../btc-bot/signal_engine/" \
  "$ORACLE:$BOT_DIR/signal_engine/" 2>/dev/null || \
ssh -i "$KEY" -o StrictHostKeyChecking=no "$ORACLE" \
  "sudo systemctl restart alphabot && sleep 3 && sudo systemctl status alphabot --no-pager | head -8"

# Restart bot
ssh -i "$KEY" -o StrictHostKeyChecking=no "$ORACLE" \
  "sudo systemctl restart alphabot && sleep 4 && sudo systemctl status alphabot --no-pager | head -8"

echo "✅ Deploy complete"
