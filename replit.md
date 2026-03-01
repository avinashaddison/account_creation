# LA28 Auto Registration

## Overview
Automated LA28 Olympic account registration system that creates temporary email addresses, fills the LA28 registration form via Playwright browser automation, captures verification codes from emails, and completes the verification process automatically.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js (TypeScript)
- **Browser Automation**: Playwright (Chromium headless)
- **Temporary Email**: mail.tm API
- **Storage**: In-memory (MemStorage)

## Key Files
- `server/mailService.ts` - mail.tm API integration (create temp emails, poll for verification codes)
- `server/playwrightService.ts` - Playwright automation for LA28 registration form
- `server/routes.ts` - API endpoints (`POST /api/register`, `GET /api/registrations`)
- `server/storage.ts` - In-memory storage for registration records
- `shared/schema.ts` - Data types (Registration, User)
- `client/src/pages/Home.tsx` - Main UI with form inputs and live status tracking

## API Endpoints
- `POST /api/register` - Start automated registration (firstName, lastName, password, country, language)
- `GET /api/registrations` - List all registration attempts
- `GET /api/registrations/:id` - Get single registration status

## Flow
1. User fills in name/password/country on the web UI
2. Backend creates a temp email via mail.tm
3. Playwright fills the LA28 registration form and submits
4. Backend polls mail.tm for the verification code email
5. Playwright enters the code to complete verification
6. Status updates in real-time on the frontend

## System Dependencies
- glib, nss, nspr, atk, cups, dbus, gtk3, pango, cairo, mesa, alsa-lib, libxkbcommon, and various X11 libraries (required for Playwright/Chromium)
