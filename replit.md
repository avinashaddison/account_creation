# Addison Panel - LA28 Account Management

## Overview
Full admin panel for automated LA28 Olympic account creation. Creates Addison email addresses via mail.tm, fills the LA28 registration form via Playwright browser automation, captures verification codes, and completes registration automatically. Supports batch creation with real-time logs, multi-admin with data isolation, wallet system with TRC20 payments, and free account limits.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js (TypeScript) with WebSocket for real-time logs
- **Database**: PostgreSQL with Drizzle ORM
- **Sessions**: PostgreSQL-backed via connect-pg-simple (`user_sessions` table)
- **Browser Automation**: Playwright (Chromium headless)
- **Email**: mail.tm API (branded as "Addison Mail")
- **Auth**: Session-based with SHA-256 password hashing, role-based (superadmin/admin)

## Roles
- **superadmin** - Can see all data, manage admins, add funds, approve/reject payments, unlimited accounts (avinashaddison@gmail.com / @AJAYkn8085123)
- **admin** - Can only see own data, every account costs $0.11 from wallet balance (no free accounts)

## Wallet System
- Every account costs $0.11 — charged from admin's wallet balance at creation time (no free tier)
- Admins can submit TRC20 (USDT) payment requests via Binance to address `TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB`
- Admin submits TX hash + amount, superadmin approves/rejects the request
- On approval, the amount is added to the admin's wallet balance
- After submitting payment, WhatsApp opens automatically to message the super admin at +91 9142647797 for quick approval
- Superadmin can also directly add funds to any admin wallet from Manage Admins page

## Pages
- **Login** (`/`) - Email/password authentication
- **Dashboard** (`/admin`) - Overview stats + wallet balance + free account usage bar
- **Account Stock** (`/admin/accounts`) - Table of created accounts with CSV export
- **Email Server** (`/admin/email-server`) - Browse Addison emails, copy addresses, view real-time inbox
- **Billing** (`/admin/billing`) - Cost tracking at $0.11 per account
- **Wallet** (`/admin/wallet`) - View balance, submit TRC20 payment requests, see payment history
- **LA28 Registration** (`/admin/home`) - Single account registration with form, auto-fill, live progress logs, and registration history table
- **Account Create Server** (`/admin/create-server`) - Platform selection page with LA28 card
- **LA28 Account Creator** (`/admin/la28-create`) - Batch account creation (1-30) with live terminal logs
- **Manage Admins** (`/admin/manage-admins`) - Superadmin only: create/delete admins, add funds, approve/reject payment requests

## Key Files
- `server/index.ts` - Express app, session middleware, startup
- `server/routes.ts` - API endpoints + WebSocket + auth/role middleware
- `server/mailService.ts` - mail.tm API integration
- `server/playwrightService.ts` - Playwright automation for LA28 registration (includes Gigya SDK profile completion: birth year, favorite sports, favorite teams, draw registration)
- `server/storage.ts` - Database storage with Drizzle ORM (owner-scoped queries)
- `server/db.ts` - Database connection pool
- `shared/schema.ts` - Database schema (accounts, billingRecords, users, paymentRequests tables)
- `client/src/components/Layout.tsx` - Admin panel sidebar layout with role-based nav
- `client/src/lib/ws.ts` - WebSocket client with userId-scoped connections
- `client/src/pages/Wallet.tsx` - Wallet page with TRC20 payment submission
- `client/src/pages/EmailServer.tsx` - Email account browser with real-time inbox
- `client/src/pages/ManageAdmins.tsx` - Admin CRUD, fund management, payment request approval

## API Endpoints
### Auth (public)
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Destroy session
- `GET /api/auth/me` - Current user info (includes role, freeAccountsUsed, walletBalance)

### Protected (require auth, data scoped by owner)
- `POST /api/register` - Create single account with validated input (firstName, lastName, password, country, language)
- `GET /api/registrations` - List registrations (safe DTO without emailPassword, owner-scoped)
- `POST /api/create-batch` - Batch create accounts (checks free limit + wallet balance)
- `POST /api/create-single` - Create single account
- `GET /api/accounts` - List accounts (owner-scoped for admin, all for superadmin)
- `GET /api/accounts/stats` - Account statistics (owner-scoped)
- `GET /api/billing` - Billing records + total (owner-scoped)
- `GET /api/dashboard` - Dashboard stats + wallet + free usage info
- `GET /api/emails` - List Addison email accounts
- `GET /api/emails/:id/inbox` - Fetch inbox messages for an email
- `GET /api/wallet` - Wallet info + payment history
- `POST /api/wallet/payment-request` - Submit TRC20 payment request
- `WS /ws` - WebSocket (session-cookie authenticated server-side)

### Superadmin Only
- `GET /api/admin/users` - List all users (with walletBalance)
- `POST /api/admin/users` - Create new admin
- `DELETE /api/admin/users/:id` - Delete admin
- `POST /api/admin/add-funds` - Directly add funds to admin wallet
- `GET /api/admin/payment-requests` - List all payment requests
- `POST /api/admin/payment-requests/:id/approve` - Approve payment (adds to wallet)
- `POST /api/admin/payment-requests/:id/reject` - Reject payment

## Database Tables
- `users` - Users with email, hashed password, role, freeAccountsUsed, walletBalance, createdBy
- `accounts` - LA28 accounts with Addison email, credentials, status, ownerId for data isolation
- `billing_records` - Cost records at $0.11 per verified account, ownerId
- `payment_requests` - TRC20 payment requests with userId, amount, txHash, status (pending/approved/rejected), adminNote
- `user_sessions` - PostgreSQL session store (auto-created by connect-pg-simple)

## Deployment
- **Target**: VM (required for Playwright + persistent WebSocket connections)
- **Build**: `npm run build` (Vite client + esbuild server)
- **Start**: `npm run start` (NODE_ENV=production)
- **Env vars**: DATABASE_URL (required), SESSION_SECRET (required in production)

## System Dependencies
glib, nss, nspr, atk, cups, dbus, gtk3, pango, cairo, mesa, alsa-lib, libxkbcommon, and X11 libraries (for Playwright/Chromium)
