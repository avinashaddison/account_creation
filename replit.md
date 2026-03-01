# Addison Panel - LA28 Account Management

## Overview
Full admin panel for automated LA28 Olympic account creation. Creates Addison email addresses via mail.tm, fills the LA28 registration form via Playwright browser automation, captures verification codes, and completes registration automatically. Supports batch creation with real-time logs, multi-admin with data isolation, and free account limits.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js (TypeScript) with WebSocket for real-time logs
- **Database**: PostgreSQL with Drizzle ORM
- **Sessions**: PostgreSQL-backed via connect-pg-simple (`user_sessions` table)
- **Browser Automation**: Playwright (Chromium headless)
- **Email**: mail.tm API (branded as "Addison Mail")
- **Auth**: Session-based with SHA-256 password hashing, role-based (superadmin/admin)

## Roles
- **superadmin** - Can see all data, manage admins, unlimited accounts (default: admin@la28panel.com / admin123)
- **admin** - Can only see own data, 30 free account limit

## Pages
- **Login** (`/`) - Email/password authentication
- **Dashboard** (`/admin`) - Overview stats + free account usage bar
- **Account Stock** (`/admin/accounts`) - Table of created accounts with CSV export
- **Email Server** (`/admin/email-server`) - Browse Addison emails, copy addresses, view real-time inbox
- **Billing** (`/admin/billing`) - Cost tracking at $0.11 per account
- **Auto Create** (`/admin/auto-create`) - Batch account creation (1-30) with live terminal logs
- **Manage Admins** (`/admin/manage-admins`) - Superadmin only: create/delete admin accounts

## Key Files
- `server/index.ts` - Express app, session middleware, startup
- `server/routes.ts` - API endpoints + WebSocket + auth/role middleware
- `server/mailService.ts` - mail.tm API integration
- `server/playwrightService.ts` - Playwright automation for LA28 registration
- `server/storage.ts` - Database storage with Drizzle ORM (owner-scoped queries)
- `server/db.ts` - Database connection pool
- `shared/schema.ts` - Database schema (accounts, billingRecords, users tables)
- `client/src/components/Layout.tsx` - Admin panel sidebar layout with role-based nav
- `client/src/lib/ws.ts` - WebSocket client with userId-scoped connections
- `client/src/pages/EmailServer.tsx` - Email account browser with real-time inbox
- `client/src/pages/ManageAdmins.tsx` - Admin CRUD for superadmins

## API Endpoints
### Auth (public)
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Destroy session
- `GET /api/auth/me` - Current user info (includes role, freeAccountsUsed)

### Protected (require auth, data scoped by owner)
- `POST /api/create-batch` - Batch create accounts (checks free limit for non-superadmin)
- `POST /api/create-single` - Create single account
- `GET /api/accounts` - List accounts (owner-scoped for admin, all for superadmin)
- `GET /api/accounts/stats` - Account statistics (owner-scoped)
- `GET /api/billing` - Billing records + total (owner-scoped)
- `GET /api/dashboard` - Dashboard stats + free usage info
- `GET /api/emails` - List Addison email accounts
- `GET /api/emails/:id/inbox` - Fetch inbox messages for an email
- `WS /ws?userId=X` - WebSocket scoped by userId

### Superadmin Only
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create new admin
- `DELETE /api/admin/users/:id` - Delete admin

## Database Tables
- `users` - Users with email, hashed password, role (superadmin/admin/user), freeAccountsUsed, createdBy
- `accounts` - LA28 accounts with Addison email, credentials, status, ownerId for data isolation
- `billing_records` - Cost records at $0.11 per verified account, ownerId
- `user_sessions` - PostgreSQL session store (auto-created by connect-pg-simple)

## Deployment
- **Target**: VM (required for Playwright + persistent WebSocket connections)
- **Build**: `npm run build` (Vite client + esbuild server)
- **Start**: `npm run start` (NODE_ENV=production)
- **Env vars**: DATABASE_URL (required), SESSION_SECRET (required in production)

## System Dependencies
glib, nss, nspr, atk, cups, dbus, gtk3, pango, cairo, mesa, alsa-lib, libxkbcommon, and X11 libraries (for Playwright/Chromium)
