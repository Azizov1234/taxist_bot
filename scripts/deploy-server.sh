#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-main}"
APP_NAME="${APP_NAME:-taxi-lead-bot}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[1/8] Pulling latest code from branch: $BRANCH"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo ""
  echo "ERROR: .env was missing, so .env.example copied to .env."
  echo "Please fill .env values and run deploy again."
  exit 1
fi

required_keys=(
  "TELEGRAM_API_ID"
  "TELEGRAM_API_HASH"
  "TELEGRAM_STRING_SESSION"
  "PASSENGER_CHAT_IDS"
  "DRIVER_CHAT_ID"
  "ADMIN_TELEGRAM_ID"
  "DATABASE_URL"
)

missing_keys=()
for key in "${required_keys[@]}"; do
  value="$(grep -E "^${key}=" .env | tail -n1 | cut -d'=' -f2- | tr -d '\r' | xargs || true)"
  if [[ -z "$value" ]]; then
    missing_keys+=("$key")
  fi
done

if [[ ${#missing_keys[@]} -gt 0 ]]; then
  echo ""
  echo "ERROR: .env is missing required keys:"
  printf -- "- %s\n" "${missing_keys[@]}"
  exit 1
fi

echo "[2/8] Installing npm dependencies"
npm ci

echo "[3/8] Generating Prisma client"
npx prisma generate

echo "[4/8] Running Prisma deploy migrations"
npx prisma migrate deploy

echo "[5/8] Building TypeScript"
npm run build

echo "[6/8] Cleaning old local logs"
npm run clean:logs || true

echo "[7/8] Restarting app"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
  else
    pm2 start dist/main.js --name "$APP_NAME"
  fi
  pm2 save
  echo "PM2 process '$APP_NAME' is running."
else
  pkill -f "node dist/main.js" || true
  nohup node dist/main.js > run.log 2> run.err < /dev/null &
  echo "Started with nohup (no pm2 found)."
fi

echo "[8/8] Done."
echo "Tip: check logs with 'tail -f run.log' or 'pm2 logs $APP_NAME'"
