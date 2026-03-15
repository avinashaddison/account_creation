# Addison Panel - LA28 Account Management

## Overview
Full admin panel for automated LA28 Olympic account creation with complete ticket draw registration. Creates Addison email addresses via mail.tm, fills the LA28 registration form via Playwright browser automation, captures verification codes, and completes draw registration via Gigya REST API (primary) — setting profile (birthYear, zip, country), favorites (disciplines, countries), and draw flags (l2028_ticketing, l2028_fan28) without touching tickets.la28.org. Browser-based OIDC/ZenRows flow available as fallback. Supports batch creation with real-time logs, multi-admin with data isolation, wallet system with TRC20 payments.

## Account Status Flow
`pending` → `registering` → `waiting_code` → `verifying` → `verified` → `profile_saving` → `draw_registering` → `completed`
- **pending**: Account record created, waiting to start
- **registering**: Filling LA28 registration form
- **waiting_code**: Waiting for email verification code
- **verifying**: Submitting verification code
- **verified**: Email verified, LA28 ID created
- **profile_saving**: Saving Gigya profile (birth year, sports, teams)
- **draw_registering**: Setting draw registration via Gigya REST API (primary) or browser fallback
- **completed**: Full flow done — draw registered with all 3 checkmarks (registered, profile, favorites)
- **failed**: Error at any stage

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js (TypeScript) with WebSocket for real-time logs
- **Database**: PostgreSQL with Drizzle ORM
- **Sessions**: PostgreSQL-backed via connect-pg-simple (`user_sessions` table)
- **Browser Automation**: Playwright (Chromium headless, ZenRows Browser API via `connectOverCDP` for tickets.la28.org form fill, Bright Data for other automation)
- **Email**: mail.tm API (branded as "Addison Mail")
- **Auth**: Session-based with SHA-256 password hashing, role-based (superadmin/admin)

## Roles
- **superadmin** - Can see all data, manage admins, add funds, approve/reject payments, unlimited accounts (avinashaddison@gmail.com / @AJAYkn8085123)
- **admin** - Can only see own data, account cost charged from wallet balance (no free accounts)

## Wallet System
- Account creation cost is configurable by superadmin (default $0.11) — charged from admin's wallet balance at creation time (no free tier)
- Superadmin can update the per-account price from the Manage Admins page (stored in `settings` table)
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
- **Account Create Server** (`/admin/create-server`) - Platform selection page with LA28, Ticketmaster, UEFA, Bruno Mars cards
- **LA28 Account Creator** (`/admin/la28-create`) - Batch account creation (1-30) with live terminal logs
- **Ticketmaster Creator** (`/admin/tm-create`) - TM account creation with email+phone verification, per-account log filtering, wallet display, batch-scoped real-time logs
- **Bruno Mars Presale** (`/admin/brunomars-create`) - Bruno Mars presale signup on ticketmaster.ca, per-account log filtering, wallet display, batch-scoped real-time logs
- **UEFA Creator** (`/admin/uefa-create`) - UEFA account creation with email verification
- **Manage Admins** (`/admin/manage-admins`) - Superadmin only: create/delete admins, add funds, approve/reject payment requests

## Key Files
- `server/index.ts` - Express app, session middleware, startup
- `server/routes.ts` - API endpoints + WebSocket + auth/role middleware
- `server/mailService.ts` - mail.tm API integration
- `server/playwrightService.ts` - Playwright automation for LA28 registration + Gigya REST API draw completion. **Primary draw flow**: `completeDrawRegistrationViaApi()` — pure REST API using `accounts.login` → `accounts.setAccountInfo` (profile: birthYear/zip/country) → `accounts.setAccountInfo` (data: favoritesDisciplines/favoritesCountries + l2028_ticketing/l2028_fan28 flags) → `accounts.getAccountInfo` (validation). Completes in ~1-2s. **Fallback**: `completeDrawViaGigyaBrowser()` — browser-based Gigya SDK login + OIDC linking + ZenRows for tickets.la28.org form fill. Browser fallback only runs if REST API fails.
- `server/curl_chrome116` + `server/curl-impersonate-chrome` - curl-impersonate binaries that mimic Chrome 116's exact TLS fingerprint (JA3/JA4 hash). This bypasses Akamai's TLS fingerprinting which blocked all standard curl/Node.js/Playwright requests to tickets.la28.org.
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
- `PUT /api/admin/account-price` - Update per-account creation price
- `GET /api/settings/account-price` - Get current account creation price (all authenticated users)

## Database Tables
- `users` - Users with email, hashed password, role, freeAccountsUsed, walletBalance, createdBy
- `accounts` - LA28 accounts with Addison email, credentials, status, ownerId for data isolation
- `billing_records` - Cost records per verified account (dynamic price), ownerId
- `payment_requests` - TRC20 payment requests with userId, amount, txHash, status (pending/approved/rejected), adminNote
- `settings` - Key-value settings store (e.g., `account_price` for per-account cost)
- `user_sessions` - PostgreSQL session store (auto-created by connect-pg-simple)

## TM + Bruno Mars Combined Flow
- **Combined route**: `POST /api/brunomars-create-batch` creates TM accounts then immediately navigates to Bruno Mars presale
- **Phase 1**: Full TM registration with email+phone verification (using `keepBrowserOpen=true` to preserve authenticated session)
- **Phase 2**: Uses the same authenticated browser/page to navigate to `https://signup.ticketmaster.ca/brunomars`, select ALL event checkboxes, check consent boxes, click Sign Up
- **Success**: "YOUR SELECTIONS" page visible after submission
- **Session handoff**: `tmFullRegistrationFlow` returns `{ browser, page }` on success when `keepBrowserOpen=true`; `brunoMarsPresaleStep` receives and uses them; browser is always closed in `finally` block
- **Browser cleanup**: On TM failure/retry, browser is closed even if `keepBrowserOpen` was requested (prevents CDP session leaks)
- **Key files**: `server/ticketmasterService.ts` (TM registration), `server/brunoMarsService.ts` (presale step), `client/src/pages/BrunoMarsCreate.tsx`

## Ticketmaster Account Creation
- **Flow**: Navigate to `https://www.ticketmaster.com/member/create_account` → redirects to `auth.ticketmaster.com` with `client_id=8bf7204a7e97.web.ticketmaster.us`
- **Two-step form**: Step 1: email → Continue. Step 2: password, firstName, lastName, countryCode (US), postalCode, privacyPolicyCheckbox → Submit
- **Password bypass**: ContentSquare analytics overrides `HTMLInputElement.prototype.value` setter and Bright Data blocks CDP `Input.dispatchKeyEvent` on password fields. Solution: create hidden iframe → get clean native setter from `iframe.contentWindow.HTMLInputElement.prototype.value.set` → use it to set password value
- **Verification**: After registration, page shows "ALMOST THERE" → click "Verify My Email" → poll for email code → enter code → verify → then phone verification via SMSPool
- **Phone Verification**: Ticketmaster requires phone verification after email. After email OTP code is entered and checkmark appears, the email OTP overlay is dismissed (Escape key). Then "Add My Phone" button opens phone dialog. Phone number filled via `input[type="tel"]`, "Add Number" button submits the phone. Phone OTP appears, SMS code from SMSPool entered via `input[id*="otp"]`, "Confirm Code" button (found via form:has(input[id*="otp"]) query) submits verification. Phone verification retries up to 3 times with new SMSPool numbers if SMS doesn't arrive. Account requires both email AND phone verified to succeed.
- **Key files**: `server/ticketmasterService.ts`, `server/smspoolService.ts`

## SMSPool Integration
- **API**: `https://api.smspool.net` with `SMSPOOL_API_KEY` env secret
- **Service**: `server/smspoolService.ts` — orderSMSNumber, checkSMSCode, pollForSMSCode, cancelSMSOrder, getSMSPoolBalance
- **Endpoints**: `GET /api/smspool/balance` — check SMSPool balance (shown on dashboard)
- **Usage**: Automatically orders US phone number for Ticketmaster service during TM registration flow

## CapSolver Integration
- **API**: `https://api.capsolver.com` with `CAPSOLVER_API_KEY` env secret
- **Service**: `server/capsolverService.ts` — solveRecaptchaV2Enterprise, solveRecaptchaV3Enterprise, solveRecaptchaV2, solveHCaptcha, solveFunCaptcha, solveAntiTurnstile, getCapSolverBalance, injectRecaptchaToken
- **Endpoints**: `GET /api/capsolver/balance` — check CapSolver balance (shown on dashboard)
- **LA28 Integration**: When Gigya login returns error 400006 (CAPTCHA required), CapSolver automatically solves reCAPTCHA Enterprise and retries login with the token
- **Ticketmaster Integration**: When browser auto-solver times out on CAPTCHA challenges, CapSolver attempts to solve reCAPTCHA/hCaptcha and inject the token
- **Dashboard**: CapSolver balance displayed in purple card alongside SMSPool balance

## Proxy Status (as of March 11, 2026)
- **Oxylabs Web Unblocker** (`unblock.oxylabs.io:60000`): Only proxy that passes Akamai bot detection on tickets.la28.org. Works for single HTTP requests (curl). Cannot maintain sessions or run interactive JS. Free trial limits apply (3 rendered requests per window).
- **Bright Data scraping_browser1**: Blocked by robots.txt on tickets.la28.org. JS navigation bypass gets 403 from Akamai.
- **Bright Data residential_proxy1**: US residential IPs but gets 403 from Akamai bot detection (headless Chrome fingerprinting detected).
- **Queue-it on tickets.la28.org**: 100% server-side (zero client JS). `/mycustomerdata/` always returns Queue-it redirect. No known bypass — queue may open at specific time windows.
- **Primary approach**: Pure Gigya REST API sets all draw registration data (profile + favorites + l2028_ticketing flag) without needing tickets.la28.org access at all.

## Deployment
- **Target**: VM (required for Playwright + persistent WebSocket connections)
- **Build**: `npm run build` (Vite client + esbuild server)
- **Start**: `npm run start` (NODE_ENV=production)
- **Env vars**: DATABASE_URL (required), SESSION_SECRET (required in production), LA28_PROXY_URL (optional, residential proxy for LA28), TM_PROXY_URL (optional, residential proxy for Ticketmaster)

## System Dependencies
glib, nss, nspr, atk, cups, dbus, gtk3, pango, cairo, mesa, alsa-lib, libxkbcommon, and X11 libraries (for Playwright/Chromium)
