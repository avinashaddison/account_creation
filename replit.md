# LA28 Auto Registration Admin Panel

## Overview
Full admin panel for automated LA28 Olympic account creation. Creates temporary email addresses via mail.tm, fills the LA28 registration form via Playwright browser automation, captures verification codes, and completes registration automatically. Supports batch creation with real-time logs.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js (TypeScript) with WebSocket for real-time logs
- **Database**: PostgreSQL with Drizzle ORM
- **Browser Automation**: Playwright (Chromium headless)
- **Temporary Email**: mail.tm API

## Pages
- **Dashboard** (`/`) - Overview stats: total accounts, verified, failed, pending, total cost
- **Account Stock** (`/accounts`) - Table of all created accounts with email, password, status, verification code. Real-time updates via WebSocket
- **Billing** (`/billing`) - Cost tracking at $0.11 per account creation. Billing history table
- **Auto Create** (`/auto-create`) - Batch account creation. Pick count (1, 5, 10, 20, 30), see real-time terminal logs, progress badges per account

## Key Files
- `server/mailService.ts` - mail.tm API integration
- `server/playwrightService.ts` - Playwright automation for LA28 registration
- `server/routes.ts` - API endpoints + WebSocket for real-time logs
- `server/storage.ts` - Database storage with Drizzle ORM
- `server/db.ts` - Database connection
- `shared/schema.ts` - Database schema (accounts, billingRecords, users tables)
- `client/src/components/Layout.tsx` - Admin panel sidebar layout
- `client/src/lib/ws.ts` - WebSocket client for real-time updates
- `client/src/pages/Dashboard.tsx` - Dashboard page
- `client/src/pages/AccountStock.tsx` - Account stock page
- `client/src/pages/Billing.tsx` - Billing page
- `client/src/pages/AutoCreate.tsx` - Auto create page

## API Endpoints
- `POST /api/create-batch` - Batch create accounts (count, country, language)
- `POST /api/create-single` - Create single account (firstName, lastName, password, country, language)
- `GET /api/accounts` - List all accounts
- `GET /api/accounts/stats` - Account statistics
- `GET /api/accounts/:id` - Single account details
- `GET /api/billing` - Billing records + total
- `GET /api/dashboard` - Dashboard stats
- `WS /ws` - WebSocket for real-time logs and account updates

## Database Tables
- `accounts` - LA28 accounts with temp email, credentials, status, batch tracking
- `billing_records` - Cost records at $0.11 per verified account
- `users` - Admin users with roles (admin/user)

## System Dependencies
glib, nss, nspr, atk, cups, dbus, gtk3, pango, cairo, mesa, alsa-lib, libxkbcommon, and X11 libraries (for Playwright/Chromium)
