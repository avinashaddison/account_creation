#!/bin/bash
set -e

echo "============================================"
echo "  Addison Panel - VPS Setup Script"
echo "============================================"
echo ""

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo ""
  echo "Set it before running this script:"
  echo "  export DATABASE_URL='postgresql://user:password@localhost:5432/addison_panel'"
  echo ""
  exit 1
fi

if [ -z "$SESSION_SECRET" ]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  echo "Generated SESSION_SECRET: $SESSION_SECRET"
  echo "Add this to your environment: export SESSION_SECRET='$SESSION_SECRET'"
fi

export SESSION_SECRET
export NODE_ENV=production
export PORT=${PORT:-5000}

echo "[1/5] Installing Node.js dependencies..."
npm install --production=false

echo "[2/5] Installing Playwright browsers..."
npx playwright install chromium
npx playwright install-deps chromium 2>/dev/null || echo "Note: Install system deps manually if browser fails: sudo npx playwright install-deps chromium"

echo "[3/5] Pushing database schema..."
npx drizzle-kit push --force 2>/dev/null || echo "y" | npx drizzle-kit push || echo "Schema push may need manual confirmation"

echo "[4/5] Building application..."
npm run build

echo "[5/5] Setup complete!"
echo ""
echo "============================================"
echo "  Run the server with:"
echo "  NODE_ENV=production SESSION_SECRET='$SESSION_SECRET' PORT=$PORT npm run start"
echo ""
echo "  Or use PM2 for production:"
echo "  pm2 start 'NODE_ENV=production SESSION_SECRET=$SESSION_SECRET PORT=$PORT npm run start' --name addison-panel"
echo "============================================"
echo ""
echo "  Default login: avinashaddison@gmail.com"
echo "  The app will be available at: http://your-server-ip:$PORT"
echo "============================================"
