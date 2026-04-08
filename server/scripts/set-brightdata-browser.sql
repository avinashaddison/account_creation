-- Migration: Switch CDP browser endpoint to Bright Data Scraping Browser
-- Run this script against the Neon database to configure the Bright Data endpoint.
--
-- Bright Data's Scraping Browser (brd.superproxy.io) handles:
--   - reCAPTCHA Enterprise v3 solving internally
--   - Residential IP routing natively (no external proxy= param needed)
--   - Browser integrity fingerprint hardening
--
-- Replace <YOUR_BRIGHT_DATA_WSS_URL> with the actual WebSocket URL from
-- your Bright Data account: Proxies & Scraping > Scraping Browser > Connection settings
-- Format: wss://brd-customer-<CUSTOMER_ID>-zone-<ZONE_NAME>:<PASSWORD>@brd.superproxy.io:9222
--
-- Alternatively, set this via the admin UI: Settings > Proxy Browser URL

INSERT INTO settings (key, value)
VALUES (
  'zenrows_api_url',
  '<YOUR_BRIGHT_DATA_WSS_URL>'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
