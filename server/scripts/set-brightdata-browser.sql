-- Migration: Switch CDP browser endpoint to Bright Data Scraping Browser
-- Run this script against the Neon database to configure the Bright Data endpoint.
--
-- Bright Data's Scraping Browser (brd.superproxy.io) handles:
--   - reCAPTCHA Enterprise v3 solving internally
--   - Residential IP routing natively (no external proxy= param needed)
--   - Browser integrity fingerprint hardening
--
-- This replaces the previous Addison Proxy CDP endpoint.

INSERT INTO settings (key, value)
VALUES (
  'zenrows_api_url',
  'wss://brd-customer-hl_86b34e68-zone-scraping_browser1:xov21cay1g29@brd.superproxy.io:9222'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
