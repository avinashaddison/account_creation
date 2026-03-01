# LA28 Auto Registration Admin Panel

## Overview
Full admin panel for automated LA28 Olympic account creation. Creates temporary email addresses via mail.tm, fills the LA28 registration form via Playwright browser automation, captures verification codes, and completes registration automatically. Supports batch creation with real-time logs.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js (TypeScript) with WebSocket for real-time logs
- **Database**: PostgreSQL with Drizzle ORM
- **Sessions**: PostgreSQL-backed via connect-pg-simple (`user_sessions` table)
- **Browser Automation**: Playwright (Chromium headless)
- **Temporary Email**: mail.tm API
- **Auth**: Session-based with SHA-256 password hashing

## Pages
- **Login** (`/`) - Email/password authentication (default: admin@la28panel.com / admin123)
- **Dashboard** (`/admin`) - Overview stats: total accounts, verified, failed, pending, total cost
- **Account Stock** (`/admin/accounts`) - Table of all created accounts with email/password/code, CSV export
- **Billing** (`/admin/billing`) - Cost tracking at $0.11 per account creation
- **Auto Create** (`/admin/auto-create`) - Batch account creation (1-30) with real-time terminal logs via WebSocket

## Key Files
- `server/index.ts` - Express app, session middleware (connect-pg-simple), startup
- `server/routes.ts` - API endpoints + WebSocket + auth middleware
- `server/mailService.ts` - mail.tm API integration
- `server/playwrightService.ts` - Playwright automation for LA28 registration
- `server/storage.ts` - Database storage with Drizzle ORM
- `server/db.ts` - Database connection pool
- `shared/schema.ts` - Database schema (accounts, billingRecords, users tables)
- `client/src/components/Layout.tsx` - Admin panel sidebar layout with auth
- `client/src/lib/ws.ts` - WebSocket client with auto-reconnect
- `client/src/pages/Login.tsx` - Login page
- `client/src/pages/Dashboard.tsx` - Dashboard page
- `client/src/pages/AccountStock.tsx` - Account stock page with CSV export
- `client/src/pages/Billing.tsx` - Billing page
- `client/src/pages/AutoCreate.tsx` - Auto create page with live logs

## API Endpoints
### Auth (public)
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Destroy session
- `GET /api/auth/me` - Current user info

### Protected (require auth)
- `POST /api/create-batch` - Batch create accounts (count, country, language)
- `POST /api/create-single` - Create single account (firstName, lastName, password)
- `GET /api/accounts` - List all accounts
- `GET /api/accounts/stats` - Account statistics
- `GET /api/accounts/:id` - Single account details
- `GET /api/billing` - Billing records + total
- `GET /api/dashboard` - Dashboard stats
- `WS /ws` - WebSocket for real-time logs and account updates

## Database Tables
- `users` - Admin users with email, hashed password, role (admin/user)
- `accounts` - LA28 accounts with temp email, credentials, status, batch tracking
- `billing_records` - Cost records at $0.11 per verified account
- `user_sessions` - PostgreSQL session store (auto-created by connect-pg-simple)

## Deployment
- **Target**: VM (required for Playwright + persistent WebSocket connections)
- **Build**: `npm run build` (Vite client + esbuild server)
- **Start**: `npm run start` (NODE_ENV=production)
- **Env vars**: DATABASE_URL (required), SESSION_SECRET (recommended)

## System Dependencies
glib, nss, nspr, atk, cups, dbus, gtk3, pango, cairo, mesa, alsa-lib, libxkbcommon, and X11 libraries (for Playwright/Chromium)
