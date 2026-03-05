# Addison Panel

Automated admin panel for creating accounts on LA28, Ticketmaster, and UEFA platforms with email verification.

## Features

- **Multi-Platform Account Creation** — LA28 (Olympic ID), UEFA, Ticketmaster
- **Automated Email Verification** — Uses mail.tm for temp emails with auto code extraction
- **Multi-Admin System** — Super admin manages admins with data isolation
- **Wallet System** — TRC20 (USDT) payment support via Binance
- **Account Stock Management** — Track available/used accounts with platform filtering
- **Earnings Dashboard** — Super admin revenue overview per admin and platform
- **Real-time Progress** — WebSocket-based live updates during account creation
- **Dark Red Theme UI** — Modern dark admin panel

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, shadcn/ui, wouter
- **Backend**: Express.js, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Automation**: Playwright with stealth plugin
- **Email**: mail.tm API for temporary emails

## Requirements

- Node.js 18+
- PostgreSQL database
- Chromium (installed automatically via Playwright)

## Quick Setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd addison-panel

# 2. Set environment variables
export DATABASE_URL='postgresql://user:password@localhost:5432/addison_panel'
export SESSION_SECRET=$(openssl rand -hex 32)

# 3. Run the setup script
bash setup-vps.sh

# 4. Start the server
NODE_ENV=production SESSION_SECRET=$SESSION_SECRET PORT=5000 npm run start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes (prod) | Session encryption key |
| `PORT` | No | Server port (default: 5000) |
| `TM_PROXY_URL` | No | Residential proxy for Ticketmaster |

## Development

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Push database schema
npx drizzle-kit push

# Start dev server
npm run dev
```

## Production with PM2

```bash
pm2 start 'NODE_ENV=production SESSION_SECRET=your-secret PORT=5000 npm run start' --name addison-panel
```

## Default Super Admin

- Email: avinashaddison@gmail.com
- Password: @AJAYkn8085123

## Platform Status

| Platform | Status | Notes |
|----------|--------|-------|
| LA28 | Active | Fully automated |
| UEFA | Active | Uses stealth plugin for bot bypass |
| Ticketmaster | Proxy Required | Needs residential proxy (PerimeterX) |
