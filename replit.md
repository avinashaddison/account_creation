# Addison Panel - LA28 Account Management

## Overview
This project is a comprehensive admin panel designed for automated account creation and management for the LA28 Olympic Games, Ticketmaster, UEFA, and Bruno Mars presales. Its primary purpose is to streamline the process of registering user accounts and managing their participation in various events, specifically focusing on LA28 Olympic ticket draw registrations. The system automates email creation, form filling, verification, and API interactions to ensure efficient and high-volume account processing. It includes a robust multi-admin system with data isolation, a wallet system for managing account creation costs, and real-time logging. The business vision is to provide a reliable and scalable solution for large-scale event registration, maximizing market potential by enabling users to quickly and effectively secure participation in popular events.

## User Preferences
I want to prioritize concise communication. When explaining concepts, please use simple language and avoid overly technical jargon unless absolutely necessary. I prefer an iterative development approach, where features are built and tested in small, manageable increments. Before implementing any major architectural changes or new features, please ask for my approval. Ensure that the development workflow includes thorough testing at each stage.

## System Architecture
The application features a modern full-stack architecture.

**Frontend:**
-   **Frameworks:** React, Vite
-   **Styling:** Tailwind CSS, shadcn/ui components
-   **Design:** Premium dark UI with glass-morphism panels, Inter font, violet/purple accent theme, subtle animations.
-   **Layout:** Admin panel sidebar with role-based navigation.

**Backend:**
-   **Framework:** Express.js (TypeScript)
-   **Real-time Communication:** WebSocket for live logs and status updates.
-   **Authentication:** Session-based with SHA-256 password hashing and role-based access control (superadmin/admin).

**Database:**
-   **Type:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Session Storage:** PostgreSQL-backed via `connect-pg-simple`.

**Browser Automation & API Interaction:**
-   **Core Automation:** Playwright (Chromium headless) for form filling and browser-based interactions.
-   **LA28 Automation:**
    -   **Primary Draw Registration:** Gigya REST API for setting profile information (birthYear, zip, country), favorites (disciplines, countries), and draw flags (`l2028_ticketing`, `l2028_fan28`). This method avoids direct interaction with `tickets.la28.org`.
    -   **Fallback:** Browser-based OIDC/ZenRows flow via `connectOverCDP` for `tickets.la28.org` form fill, used if the REST API fails.
-   **Bot Detection Bypass:** Utilizes `curl-impersonate` binaries (mimicking Chrome 116 TLS fingerprint) to bypass Akamai bot detection for direct HTTP requests.
-   **Proxy Management:** Integrates with ZenRows Browser API and Bright Data for robust browser automation and proxy rotation.

**Wallet System:**
-   **Functionality:** Tracks account creation costs, configurable by superadmin.
-   **Payments:** Supports TRC20 (USDT) payment requests from admins, approved by superadmin.

**Feature Specifications:**
-   **Account Status Flow:** `pending` → `registering` → `waiting_code` → `verifying` → `verified` → `profile_saving` → `draw_registering` → `completed` / `failed`.
    -   **Draw Confirmation Email Check:** After draw registration succeeds ("completed"), the system polls the inbox (up to ~100 seconds) for the official "Confirmed! You are registered for the LA28 Ticket Draw" email from LA28 Tickets. Implemented via `pollForDrawConfirmation()` in `server/mailService.ts`. Applied in both the initial `processAccount` flow and the `retry-draw` endpoint in `server/routes.ts`.
-   **Multi-Admin Support:** Superadmin can manage admins, while admins have isolated data views and account creation limits based on wallet balance.
    -   **Service Access Control:** Superadmin can toggle which services (la28, ticketmaster, uefa, brunomars, outlook, zenrows) each admin can access via the "Service Access" tab in Manage Admins. Enforced at both frontend (route guards via `useServiceGuard` hook, locked cards in CreateServer) and backend (`requireServiceAccess` middleware on all service API endpoints). The `allowedServices` text array column on the `users` table stores permitted services per admin.
-   **Email Workspace:** Unified interface for generating temporary emails, viewing inboxes, and real-time status updates.
-   **Batch Creation:** Supports batch account creation with real-time logging.
-   **Specific Platform Integrations:**
    -   **Ticketmaster:** Account creation with email and phone verification. Addresses specific challenges like password field manipulation and CAPTCHA solving.
    -   **Bruno Mars Presale:** Combined flow with Ticketmaster account creation to register for presales.
    -   **UEFA:** Account creation with email verification.

## External Dependencies
-   **Email Service:** mail.tm API (branded as "Addison Mail") for temporary email address generation and inbox access.
-   **Browser Automation Proxies:**
    -   ZenRows Browser API
    -   Bright Data (for general automation and residential proxies)
    -   Oxylabs Web Unblocker (for specific Akamai bypass on `tickets.la28.org` for HTTP requests)
-   **CAPTCHA Solving:** CapSolver API (`https://api.capsolver.com`) for reCAPTCHA (v2, v3, Enterprise), hCaptcha, FunCaptcha, and Anti-Turnstile challenges.
-   **SMS Verification:** SMSPool API (`https://api.smspool.net`) for phone number provisioning and SMS code retrieval, primarily for Ticketmaster phone verification.
-   **Payment Processing:** Binance (implied for TRC20 USDT transactions).
-   **Communication:** WhatsApp (for quick payment approval notifications to superadmin).
-   **System Libraries (for Playwright/Chromium):** `glib`, `nss`, `nspr`, `atk`, `cups`, `dbus`, `gtk3`, `pango`, `cairo`, `mesa`, `alsa-lib`, `libxkbcommon`, and X11 libraries.