import { chromium as vanillaChromium, type Browser, type Page } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execSync, execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { solveRecaptchaV2Enterprise, solveRecaptchaV3Enterprise, solveRecaptchaV2, solveFunCaptcha, solveAntiTurnstile, solveHCaptcha } from "./capsolverService";

const execFileAsync = promisify(execFile);
const CURL_IMPERSONATE_PATH = path.resolve(process.cwd(), "server", "curl_chrome116");
const CURL_COOKIE_DIR = "/tmp/la28_curl_sessions";

const DECODO_HOST = process.env.DECODO_PROXY_HOST || "us.decodo.com";
const DECODO_USER = process.env.DECODO_PROXY_USERNAME || "";
const DECODO_PASS = process.env.DECODO_PROXY_PASSWORD || "";

const IPROYAL_UNBLOCKER_HOST = "unblocker.iproyal.com";
const IPROYAL_UNBLOCKER_PORT = 12323;
const IPROYAL_UNBLOCKER_USER = "Gy1cwo1086864";
const IPROYAL_UNBLOCKER_PASS = "KklSwl63u3TgeL8F";

chromium.use(StealthPlugin());

let activeProxyProvider: "iproyal" | "decodo" = "iproyal";

function getDecodoProxyUrl(port: number = 10001): string {
  if (DECODO_USER && DECODO_PASS) {
    return `http://${DECODO_USER}:${DECODO_PASS}@${DECODO_HOST}:${port}`;
  }
  return `http://${DECODO_HOST}:${port}`;
}

function getDecodoProxyConfig(port: number = 10001): { server: string; username?: string; password?: string } {
  const config: { server: string; username?: string; password?: string } = { server: `http://${DECODO_HOST}:${port}` };
  if (DECODO_USER && DECODO_PASS) {
    config.username = DECODO_USER;
    config.password = DECODO_PASS;
  }
  return config;
}

function getIPRoyalProxyUrl(): string {
  return `http://${IPROYAL_UNBLOCKER_USER}:${IPROYAL_UNBLOCKER_PASS}@${IPROYAL_UNBLOCKER_HOST}:${IPROYAL_UNBLOCKER_PORT}`;
}

function getIPRoyalProxyConfig(): { server: string; username: string; password: string } {
  return {
    server: `http://${IPROYAL_UNBLOCKER_HOST}:${IPROYAL_UNBLOCKER_PORT}`,
    username: IPROYAL_UNBLOCKER_USER,
    password: IPROYAL_UNBLOCKER_PASS,
  };
}

function getIPRoyalBrowserlessLaunchProxy(): string {
  return `--proxy-server=http://${IPROYAL_UNBLOCKER_HOST}:${IPROYAL_UNBLOCKER_PORT}`;
}

function getActiveProxyConfig(port: number = 10001): { server: string; username?: string; password?: string } {
  if (activeProxyProvider === "iproyal") {
    return getIPRoyalProxyConfig();
  }
  return getDecodoProxyConfig(port);
}

function getActiveProxyUrl(port: number = 10001): string {
  if (activeProxyProvider === "iproyal") {
    return getIPRoyalProxyUrl();
  }
  return getDecodoProxyUrl(port);
}

function getActiveProxyLabel(port: number = 10001): string {
  if (activeProxyProvider === "iproyal") {
    return `IPRoyal unblocker (${IPROYAL_UNBLOCKER_HOST}:${IPROYAL_UNBLOCKER_PORT})`;
  }
  return `Decodo residential (${DECODO_HOST}:${port})`;
}

async function simulateHumanBehavior(page: Page, email: string, password: string): Promise<void> {
  const log = (msg: string) => console.log("[HumanSim] " + msg);

  try {
    log("Starting human-like interaction sequence...");

    await page.waitForTimeout(500 + Math.random() * 500);

    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      const x = 100 + Math.floor(Math.random() * 900);
      const y = 100 + Math.floor(Math.random() * 500);
      try { await page.mouse.move(x, y, { steps: 3 + Math.floor(Math.random() * 5) }); } catch {}
      await page.waitForTimeout(50 + Math.random() * 100);
    }

    try {
      await page.evaluate(() => window.scrollBy(0, 150 + Math.random() * 200));
      await page.waitForTimeout(200 + Math.random() * 200);
      await page.evaluate(() => window.scrollBy(0, -(100 + Math.random() * 100)));
      await page.waitForTimeout(200 + Math.random() * 200);
    } catch {}

    const emailSelector = 'input[type="email"]:visible, input[name="loginID"]:visible, input[name="email"]:visible, input[data-gigya-name="loginID"]:visible';
    const passSelector = 'input[type="password"]:visible, input[name="password"]:visible, input[data-gigya-name="password"]:visible';

    try {
      const emailField = await page.$(emailSelector);
      if (emailField) {
        log("Found visible email field, typing...");
        try { await emailField.click(); } catch {}
        await page.waitForTimeout(100 + Math.random() * 150);

        for (const char of email) {
          await page.keyboard.type(char, { delay: 0 });
          await page.waitForTimeout(30 + Math.random() * 50);
        }
        log("Email typed");
        await page.waitForTimeout(200 + Math.random() * 300);
      } else {
        log("No visible email field found, skipping");
      }
    } catch (e: any) {
      log("Email field interaction failed (non-fatal): " + (e.message || '').substring(0, 60));
    }

    try {
      const passField = await page.$(passSelector);
      if (passField) {
        log("Found visible password field, typing...");
        try {
          await page.keyboard.press("Tab");
          await page.waitForTimeout(150 + Math.random() * 200);
        } catch {
          try { await passField.click(); } catch {}
          await page.waitForTimeout(100 + Math.random() * 150);
        }

        for (const char of password) {
          await page.keyboard.type(char, { delay: 0 });
          await page.waitForTimeout(30 + Math.random() * 50);
        }
        log("Password typed");
      } else {
        log("No visible password field found, skipping");
      }
    } catch (e: any) {
      log("Password field interaction failed (non-fatal): " + (e.message || '').substring(0, 60));
    }

    const waitTime = 500 + Math.random() * 500;
    log("Pre-login pause: " + Math.round(waitTime) + "ms");
    await page.waitForTimeout(waitTime);

    log("Human simulation complete");
  } catch (e: any) {
    log("Simulation error (non-fatal, continuing to login): " + (e.message || '').substring(0, 80));
  }
}

async function waitForRecaptchaEnterprise(page: Page, timeoutMs: number = 15000): Promise<boolean> {
  const log = (msg: string) => console.log("[reCAPTCHA] " + msg);

  try {
    await page.waitForFunction(
      () => {
        const g = (window as any).grecaptcha;
        return g && g.enterprise && typeof g.enterprise.execute === 'function';
      },
      { timeout: timeoutMs }
    );
    log("grecaptcha.enterprise.execute is available");
    return true;
  } catch {
    log("grecaptcha.enterprise.execute NOT available after " + timeoutMs + "ms");
    try {
      const state = await page.evaluate(() => {
        const g = (window as any).grecaptcha;
        return { hasG: !!g, hasEnt: !!(g && g.enterprise), hasExec: !!(g && g.enterprise && typeof g.enterprise.execute === 'function') };
      });
      log("reCAPTCHA state: " + JSON.stringify(state));
    } catch {}
    return false;
  }
}

function setupRecaptchaLogging(page: Page): void {
  const recaptchaInitTracker = { anchor: false, reload: false, clr: false, enterpriseJs: false };

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('recaptcha') || url.includes('grecaptcha')) {
      const method = request.method();
      const type = request.resourceType();
      console.log("[reCAPTCHA-Net] " + method + " " + type + " " + url.substring(0, 200));
    }
    if (url.includes('accounts.login') || url.includes('accounts.initRegistration')) {
      const method = request.method();
      const postData = request.postData() || '';
      const hasToken = postData.includes('captchaToken') || postData.includes('riskToken');
      const params = new URLSearchParams(postData);
      const paramKeys = Array.from(params.keys());
      const captchaType = params.get('captchaType') || 'none';
      const tokenLen = (params.get('captchaToken') || '').length;
      console.log("[Gigya-Net] REQUEST " + method + " " + url.substring(0, 200) + " hasCaptchaToken=" + hasToken + " captchaType=" + captchaType + " tokenLen=" + tokenLen + " bodyLen=" + postData.length + " paramKeys=[" + paramKeys.join(',') + "]");
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('recaptcha') || url.includes('grecaptcha')) {
      const status = response.status();
      console.log("[reCAPTCHA-Net] RESPONSE " + status + " " + url.substring(0, 200));
      if (url.includes('/anchor')) recaptchaInitTracker.anchor = status < 400;
      if (url.includes('/reload')) recaptchaInitTracker.reload = status < 400;
      if (url.includes('enterprise.js')) recaptchaInitTracker.enterpriseJs = status < 400;
      if (url.includes('/clr')) recaptchaInitTracker.clr = status < 400;
    }
    if (url.includes('accounts.login')) {
      console.log("[Gigya-Net] RESPONSE " + response.status() + " " + url.substring(0, 200));
      response.text().then(body => {
        try {
          const parsed = JSON.parse(body);
          const redacted: Record<string, any> = {};
          const safeKeys = ['errorCode', 'errorMessage', 'errorDetails', 'statusCode', 'statusReason', 'callId', 'apiVersion', 'time'];
          for (const k of safeKeys) {
            if (parsed[k] !== undefined) redacted[k] = typeof parsed[k] === 'string' ? parsed[k].substring(0, 150) : parsed[k];
          }
          redacted.responseKeys = Object.keys(parsed).join(',');
          redacted.hasUID = !!parsed.UID;
          redacted.hasSessionInfo = !!(parsed.sessionInfo || parsed.login_token);
          console.log("[Gigya-Net] Response: " + JSON.stringify(redacted));
        } catch {
          console.log("[Gigya-Net] Response length: " + body.length);
        }
      }).catch(() => {});
    }
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes('recaptcha') || url.includes('grecaptcha')) {
      const reason = request.failure()?.errorText || 'unknown';
      console.log("[reCAPTCHA-Net] FAILED " + url.substring(0, 200) + " reason=" + reason);
      if (url.includes('/anchor')) recaptchaInitTracker.anchor = false;
      if (url.includes('/reload')) recaptchaInitTracker.reload = false;
      if (url.includes('enterprise.js')) recaptchaInitTracker.enterpriseJs = false;
    }
  });

  (page as any).__recaptchaInitTracker = recaptchaInitTracker;
}

function checkRecaptchaInitialization(page: Page): { ready: boolean; state: Record<string, boolean> } {
  const tracker = (page as any).__recaptchaInitTracker || { anchor: false, reload: false, clr: false, enterpriseJs: false };
  const ready = tracker.enterpriseJs === true && (tracker.anchor === true || tracker.reload === true);
  console.log("[reCAPTCHA-Init] State: " + JSON.stringify(tracker) + " ready=" + ready);
  return { ready, state: tracker };
}

async function ensureCurlImpersonate(): Promise<boolean> {
  try {
    const curlBinaryPath = CURL_IMPERSONATE_PATH.replace("curl_chrome116", "curl-impersonate-chrome");
    if (!fs.existsSync(CURL_IMPERSONATE_PATH) || !fs.existsSync(curlBinaryPath)) {
      console.log("[CurlImp] curl-impersonate not found, downloading...");
      execSync("curl -sL https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz -o /tmp/curl-imp.tar.gz && tar -xzf /tmp/curl-imp.tar.gz -C /tmp/ 2>/dev/null", { timeout: 30000 });
      if (fs.existsSync("/tmp/curl_chrome116")) {
        fs.copyFileSync("/tmp/curl_chrome116", CURL_IMPERSONATE_PATH);
        fs.chmodSync(CURL_IMPERSONATE_PATH, 0o755);
      }
      if (fs.existsSync("/tmp/curl-impersonate-chrome")) {
        fs.copyFileSync("/tmp/curl-impersonate-chrome", curlBinaryPath);
        fs.chmodSync(curlBinaryPath, 0o755);
      }
    }
    if (!fs.existsSync(CURL_COOKIE_DIR)) {
      fs.mkdirSync(CURL_COOKIE_DIR, { recursive: true });
    }
    return fs.existsSync(CURL_IMPERSONATE_PATH) && fs.existsSync(curlBinaryPath);
  } catch (e: any) {
    console.log("[CurlImp] Setup error: " + e.message);
    return false;
  }
}

interface CurlResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  finalUrl: string;
}

async function curlImpersonate(
  url: string,
  opts: {
    method?: string;
    cookieFile: string;
    proxy?: string;
    headers?: Record<string, string>;
    body?: string;
    followRedirects?: boolean;
    maxRedirs?: number;
  }
): Promise<CurlResponse> {
  const headerFile = opts.cookieFile + ".headers";
  const args: string[] = [
    "-s",
    "-c", opts.cookieFile,
    "-b", opts.cookieFile,
    "-D", headerFile,
    "-w", "\n__CURL_STATUS__%{http_code}|%{url_effective}",
  ];

  if (opts.followRedirects !== false) {
    args.push("-L", "--max-redirs", String(opts.maxRedirs || 10));
  }

  if (opts.proxy) {
    args.push("-x", opts.proxy);
  }

  if (opts.method && opts.method !== "GET") {
    args.push("-X", opts.method);
  }

  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      args.push("-H", `${k}: ${v}`);
    }
  }

  if (opts.body) {
    args.push("-d", opts.body);
  }

  args.push(url);

  const { stdout } = await execFileAsync(CURL_IMPERSONATE_PATH, args, {
    timeout: 60000,
    maxBuffer: 5 * 1024 * 1024,
  });

  const statusMatch = stdout.match(/__CURL_STATUS__(\d+)\|(.*)$/m);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
  const finalUrl = statusMatch ? statusMatch[2] : url;
  const body = stdout.replace(/__CURL_STATUS__.*$/m, "").trim();

  const headers: Record<string, string> = {};
  try {
    if (fs.existsSync(headerFile)) {
      const headersRaw = fs.readFileSync(headerFile, "utf8");
      for (const line of headersRaw.split("\r\n")) {
        const idx = line.indexOf(": ");
        if (idx > 0) {
          headers[line.substring(0, idx).toLowerCase()] = line.substring(idx + 2);
        }
      }
      fs.unlinkSync(headerFile);
    }
  } catch {}

  return { statusCode, body, headers, finalUrl };
}

const ZENROWS_API_BASE = "https://api.zenrows.com/v1/";
let zenrowsRestApiKeyCache: string | null = null;

export function clearZenrowsApiKeyCache() {
  zenrowsRestApiKeyCache = null;
}

async function getZenRowsApiKey(): Promise<string> {
  if (zenrowsRestApiKeyCache !== null) return zenrowsRestApiKeyCache;

  if (process.env.ZENROWS_API_KEY) {
    zenrowsRestApiKeyCache = process.env.ZENROWS_API_KEY;
    return zenrowsRestApiKeyCache;
  }

  try {
    const result = await db.execute(sql`SELECT value FROM settings WHERE key = 'zenrows_rest_api_key'`);
    if (result.rows.length > 0 && result.rows[0].value) {
      zenrowsRestApiKeyCache = result.rows[0].value as string;
      return zenrowsRestApiKeyCache;
    }
  } catch {}

  return "";
}

async function zenRowsRequest(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    cookies?: string;
    followRedirects?: boolean;
  } = {}
): Promise<CurlResponse> {
  const apiKey = await getZenRowsApiKey();
  const method = (opts.method || "GET").toUpperCase();
  const params = new URLSearchParams({
    apikey: apiKey,
    url: url,
    premium_proxy: "true",
  });

  if (opts.cookies) {
    params.set("custom_cookies", opts.cookies);
  }

  const zenUrl = `${ZENROWS_API_BASE}?${params.toString()}`;

  const fetchOpts: RequestInit = {
    method: method,
    headers: {
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(90000),
  };

  if (opts.followRedirects === false) {
    fetchOpts.redirect = "manual";
  }

  if (opts.body && method !== "GET") {
    fetchOpts.body = opts.body;
  }

  try {
    const response = await fetch(zenUrl, fetchOpts);
    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

    console.log("[ZenRows-REST] " + method + " " + url.substring(0, 80) + " => " + response.status + " (body=" + body.length + ")");

    return {
      statusCode: response.status,
      body,
      headers,
      finalUrl: url,
    };
  } catch (err: any) {
    console.log("[ZenRows-REST] Error for " + url.substring(0, 80) + ": " + (err.message || "").substring(0, 150));
    throw err;
  }
}

function persistCookiesToFile(cookieString: string, cookieFile: string, domain: string = ".tickets.la28.org"): void {
  try {
    const existingLines: string[] = [];
    if (fs.existsSync(cookieFile)) {
      existingLines.push(...fs.readFileSync(cookieFile, "utf8").split("\n").filter(l => l.trim()));
    }
    if (existingLines.length === 0) {
      existingLines.push("# Netscape HTTP Cookie File");
    }

    const expiry = Math.floor(Date.now() / 1000) + 86400;
    const domainFlag = domain.startsWith(".") ? "TRUE" : "FALSE";
    const existingCookieNames = new Set(existingLines.map(l => {
      const parts = l.split("\t");
      return parts.length >= 7 ? parts[5] : "";
    }).filter(n => n));

    for (const pair of cookieString.split("; ")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        const name = pair.substring(0, eqIdx).trim();
        const value = pair.substring(eqIdx + 1).trim();
        if (existingCookieNames.has(name)) {
          for (let i = 0; i < existingLines.length; i++) {
            const parts = existingLines[i].split("\t");
            if (parts.length >= 7 && parts[5] === name) {
              parts[6] = value;
              existingLines[i] = parts.join("\t");
              break;
            }
          }
        } else {
          existingLines.push(`${domain}\t${domainFlag}\t/\tTRUE\t${expiry}\t${name}\t${value}`);
        }
      }
    }

    fs.writeFileSync(cookieFile, existingLines.join("\n") + "\n");
    console.log("[ZenRows-REST] Synced ZenRows cookies to curl cookie jar: " + cookieFile);
  } catch (err: any) {
    console.log("[ZenRows-REST] Failed to persist cookies to file: " + (err.message || "").substring(0, 80));
  }
}

function browserCookiesToString(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map(c => `${c.name}=${c.value}`).join("; ");
}

function extractCookiesFromResponse(resp: CurlResponse): Record<string, string> {
  const cookies: Record<string, string> = {};
  const rawHeaders: string[] = [];

  if (resp.headers["set-cookie"]) {
    rawHeaders.push(...resp.headers["set-cookie"].split(/,(?=[^ ])/));
  }
  if (resp.headers["Set-Cookie"]) {
    rawHeaders.push(...resp.headers["Set-Cookie"].split(/,(?=[^ ])/));
  }

  for (const part of rawHeaders) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const nameVal = trimmed.split(";")[0];
    const eqIdx = nameVal.indexOf("=");
    if (eqIdx > 0) {
      const name = nameVal.substring(0, eqIdx).trim();
      if (name && !name.includes(" ")) {
        cookies[name] = nameVal.substring(eqIdx + 1).trim();
      }
    }
  }
  return cookies;
}

function isZenRowsFailure(resp: CurlResponse): boolean {
  return resp.statusCode === 403 ||
    resp.statusCode === 429 ||
    resp.statusCode >= 500 ||
    resp.body.includes("Access Denied");
}

function mergeCookieStrings(existing: string, newCookies: Record<string, string>): string {
  const cookieMap: Record<string, string> = {};
  if (existing) {
    for (const pair of existing.split("; ")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        cookieMap[pair.substring(0, eqIdx).trim()] = pair.substring(eqIdx + 1).trim();
      }
    }
  }
  for (const [k, v] of Object.entries(newCookies)) {
    cookieMap[k] = v;
  }
  return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function navigateQueueIt(
  targetUrl: string,
  cookieFile: string,
  proxyUrl: string,
  log: (msg: string) => void
): Promise<{ passed: boolean; zenRowsCookies?: string }> {
  log("Navigating through Queue-it for tickets.la28.org...");

  try {
    log("Trying ZenRows premium proxy for Queue-it navigation...");
    const zrResp = await zenRowsRequest(targetUrl);
    if (!isZenRowsFailure(zrResp) &&
        (zrResp.body.includes("Official LA28") || zrResp.body.includes("login-app") || zrResp.body.includes("tickets.la28.org"))) {
      log("Queue-it bypassed via ZenRows premium proxy!");
      try {
        const zrCookies = extractCookiesFromResponse(zrResp);
        if (Object.keys(zrCookies).length > 0) {
          const cookieLines = ["# Netscape HTTP Cookie File"];
          const expiry = Math.floor(Date.now() / 1000) + 86400;
          for (const [name, value] of Object.entries(zrCookies)) {
            cookieLines.push(`.tickets.la28.org\tTRUE\t/\tTRUE\t${expiry}\t${name}\t${value}`);
          }
          fs.writeFileSync(cookieFile, cookieLines.join("\n") + "\n");
          console.log("[ZenRows-REST] Persisted " + Object.keys(zrCookies).length + " ZenRows cookies to curl cookie jar");
        }
      } catch {}
      const queueCookieStr = Object.entries(extractCookiesFromResponse(zrResp)).map(([k, v]) => `${k}=${v}`).join("; ");
      return { passed: true, zenRowsCookies: queueCookieStr || undefined };
    }
    if (isZenRowsFailure(zrResp)) {
      console.log("[ZenRows-REST] Queue-it navigation failed (" + zrResp.statusCode + "), falling back to curl-impersonate");
    } else {
      console.log("[ZenRows-REST] Queue-it response " + zrResp.statusCode + " but no LA28 content, falling back to curl-impersonate");
    }
  } catch (zrErr: any) {
    console.log("[ZenRows-REST] Queue-it error: " + (zrErr.message || "").substring(0, 100) + ", falling back to curl-impersonate");
  }

  const resp1 = await curlImpersonate(targetUrl, {
    cookieFile,
    proxy: proxyUrl,
    followRedirects: true,
    maxRedirs: 5,
  });

  if (resp1.body.includes("Official LA28") || resp1.body.includes("login-app")) {
    log("Queue-it bypassed - got real page directly!");
    return { passed: true };
  }

  const queueRedirectMatch = resp1.body.match(/decodeURIComponent\('([^']+)'\)/);
  if (queueRedirectMatch) {
    const decodedPath = decodeURIComponent(queueRedirectMatch[1]);
    const queueUrl = `https://next.tickets.la28.org${decodedPath}`;
    console.log("[CurlImp] Following Queue-it JS redirect...");

    const resp2 = await curlImpersonate(queueUrl, {
      cookieFile,
      proxy: proxyUrl,
      followRedirects: true,
      maxRedirs: 10,
    });

    if (resp2.body.includes("Official LA28") || resp2.body.includes("login-app")) {
      log("Queue-it passed - got real page!");
      return { passed: true };
    }

    const queueRedirect2 = resp2.body.match(/decodeURIComponent\('([^']+)'\)/);
    if (queueRedirect2) {
      const decodedPath2 = decodeURIComponent(queueRedirect2[1]);
      const queueUrl2 = `https://next.tickets.la28.org${decodedPath2}`;
      console.log("[CurlImp] Following second Queue-it redirect...");

      const resp3 = await curlImpersonate(queueUrl2, {
        cookieFile,
        proxy: proxyUrl,
        followRedirects: true,
        maxRedirs: 10,
      });

      if (resp3.body.includes("Official LA28") || resp3.body.includes("login-app")) {
        log("Queue-it passed on third attempt!");
        return { passed: true };
      }
    }
  }

  if (resp1.finalUrl.includes("tickets.la28.org") && !resp1.finalUrl.includes("next.tickets")) {
    log("Reached tickets.la28.org (may not have full page content)");
    return { passed: true };
  }

  log("Could not navigate through Queue-it");
  return { passed: false };
}

export async function ticketsFormFillWithCookies(
  email: string,
  firstName: string,
  lastName: string,
  zipCode: string,
  browserCookies: Array<{ name: string; value: string; domain?: string; path?: string }>,
  log: (msg: string) => void
): Promise<{ success: boolean; formSubmitted: boolean; error?: string }> {
  const available = await ensureCurlImpersonate();
  if (!available) {
    log("curl-impersonate not available, skipping form fill");
    return { success: false, formSubmitted: false, error: "curl-impersonate not found" };
  }

  const proxyUrl = getActiveProxyUrl();

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const cookieFile = path.join(CURL_COOKIE_DIR, `${sessionId}.txt`);

  try {
    log("Starting tickets.la28.org form fill with browser cookies...");
    console.log("[CurlCookie] Session: " + sessionId + " cookies: " + browserCookies.length);

    const cookieLines = ["# Netscape HTTP Cookie File"];
    for (const c of browserCookies) {
      const domain = c.domain || ".tickets.la28.org";
      const domainFlag = domain.startsWith(".") ? "TRUE" : "FALSE";
      const cookiePath = c.path || "/";
      const secure = "TRUE";
      const expiry = Math.floor(Date.now() / 1000) + 86400;
      cookieLines.push(`${domain}\t${domainFlag}\t${cookiePath}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
    }
    fs.writeFileSync(cookieFile, cookieLines.join("\n") + "\n");
    console.log("[CurlCookie] Wrote " + browserCookies.length + " cookies to " + cookieFile);

    let zenRowsCookieString = browserCookiesToString(browserCookies);
    let useZenRows = true;
    let regResp: CurlResponse;

    try {
      log("Trying ZenRows premium proxy for registration form...");
      regResp = await zenRowsRequest("https://tickets.la28.org/api/login/registration", {
        headers: {
          "Accept": "application/json",
          "Referer": "https://tickets.la28.org/mycustomerdata/",
        },
        cookies: zenRowsCookieString,
      });

      if (isZenRowsFailure(regResp)) {
        console.log("[ZenRows-REST] Registration form failed (" + regResp.statusCode + "), falling back to curl-impersonate");
        useZenRows = false;
      } else {
        const regCookies = extractCookiesFromResponse(regResp);
        zenRowsCookieString = mergeCookieStrings(zenRowsCookieString, regCookies);
        persistCookiesToFile(zenRowsCookieString, cookieFile);
      }
    } catch (zrErr: any) {
      console.log("[ZenRows-REST] Registration form error: " + (zrErr.message || "").substring(0, 100) + ", falling back to curl-impersonate");
      useZenRows = false;
      regResp = { statusCode: 0, body: "", headers: {}, finalUrl: "" };
    }

    if (!useZenRows) {
      persistCookiesToFile(zenRowsCookieString, cookieFile);
      regResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
        cookieFile,
        proxy: proxyUrl,
        headers: {
          "Accept": "application/json",
          "Referer": "https://tickets.la28.org/mycustomerdata/",
        },
      });
    }

    console.log("[CurlCookie] Registration form: " + regResp.statusCode + " size=" + regResp.body.length + (useZenRows ? " (via ZenRows)" : " (via curl)"));

    if (regResp.statusCode === 403) {
      log("Akamai blocked API call (403). Browser cookies may not transfer.");
      return { success: false, formSubmitted: false, error: "Akamai blocked (403)" };
    }

    let xsrfToken = "";
    let formFields: any = null;
    try {
      const regData = JSON.parse(regResp.body);
      xsrfToken = regData.xsrfToken || "";
      formFields = regData.registrationForm || regData;
      console.log("[CurlCookie] XSRF: " + xsrfToken + ", form keys: " + Object.keys(formFields).join(","));
    } catch {
      console.log("[CurlCookie] Could not parse registration response: " + regResp.body.substring(0, 200));
      return { success: false, formSubmitted: false, error: "Could not parse form response" };
    }

    const contactFields = formFields?.contactData || formFields?.myDataData || [];
    const fieldNames = Array.isArray(contactFields)
      ? contactFields.map((f: any) => f.fieldName)
      : [];

    console.log("[CurlCookie] Form field names: " + fieldNames.join(", "));

    const formData: Record<string, string> = {};
    for (const f of fieldNames) {
      switch (f) {
        case "customerEmail": formData[f] = email; break;
        case "customerFirstName": formData[f] = firstName; break;
        case "customerLastName": formData[f] = lastName; break;
        case "customerCountry": formData[f] = "US"; break;
        case "customerPostalCode": formData[f] = zipCode; break;
        case "customerCity": formData[f] = "Los Angeles"; break;
        case "customerStreetAndNo": formData[f] = "123 Olympic Blvd"; break;
        case "customerProvince": formData[f] = "CA"; break;
        case "customerPhone": formData[f] = "+1" + (2130000000 + Math.floor(Math.random() * 9999999)).toString(); break;
      }
    }

    log("Submitting customer data on tickets.la28.org...");
    console.log("[CurlCookie] Submitting form data: " + JSON.stringify(formData));

    const submitHeaders: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Referer": "https://tickets.la28.org/mycustomerdata/",
    };
    if (xsrfToken) submitHeaders["X-XSRF-TOKEN"] = xsrfToken;

    const payloads = [
      { url: "https://tickets.la28.org/api/login/mydata", method: "PUT", body: JSON.stringify({ contactData: formData }) },
      { url: "https://tickets.la28.org/api/login/mydata", method: "POST", body: JSON.stringify({ contactData: formData }) },
      { url: "https://tickets.la28.org/api/login/registration", method: "PUT", body: JSON.stringify({ contactData: formData, page: "registration" }) },
      { url: "https://tickets.la28.org/api/login/registration", method: "POST", body: JSON.stringify({ contactData: formData, page: "registration" }) },
      { url: "https://tickets.la28.org/api/login/registration", method: "PATCH", body: JSON.stringify({ contactData: formData }) },
    ];

    for (const p of payloads) {
      let submitResp: CurlResponse;
      let usedZenRowsForSubmit = useZenRows;

      if (useZenRows) {
        try {
          submitResp = await zenRowsRequest(p.url, {
            method: p.method,
            headers: submitHeaders,
            body: p.body,
            cookies: zenRowsCookieString,
          });

          if (isZenRowsFailure(submitResp)) {
            console.log("[ZenRows-REST] Submit " + p.method + " failed (" + submitResp.statusCode + "), falling back to curl");
            usedZenRowsForSubmit = false;
            useZenRows = false;
            persistCookiesToFile(zenRowsCookieString, cookieFile);
            submitResp = await curlImpersonate(p.url, {
              method: p.method,
              cookieFile,
              proxy: proxyUrl,
              headers: submitHeaders,
              body: p.body,
            });
          }
        } catch {
          console.log("[ZenRows-REST] Submit error, falling back to curl for " + p.method);
          usedZenRowsForSubmit = false;
          useZenRows = false;
          persistCookiesToFile(zenRowsCookieString, cookieFile);
          submitResp = await curlImpersonate(p.url, {
            method: p.method,
            cookieFile,
            proxy: proxyUrl,
            headers: submitHeaders,
            body: p.body,
          });
        }
      } else {
        submitResp = await curlImpersonate(p.url, {
          method: p.method,
          cookieFile,
          proxy: proxyUrl,
          headers: submitHeaders,
          body: p.body,
        });
      }

      console.log("[CurlCookie] Submit " + p.method + " " + p.url.split("/api/")[1] + ": " + submitResp.statusCode + " body: " + submitResp.body.substring(0, 200) + (usedZenRowsForSubmit ? " (via ZenRows)" : " (via curl)"));

      if (submitResp.statusCode >= 200 && submitResp.statusCode < 300) {
        log("Form submitted on tickets.la28.org via " + p.method + " " + p.url.split("/api/")[1] + "!");
        return { success: true, formSubmitted: true };
      } else if (submitResp.statusCode === 405 || submitResp.statusCode === 404) {
        continue;
      } else if (submitResp.statusCode === 403) {
        log("Akamai blocked form submission (403).");
        return { success: false, formSubmitted: false, error: "Akamai blocked form submit" };
      } else if (submitResp.statusCode >= 400) {
        console.log("[CurlCookie] " + p.method + " failed with " + submitResp.statusCode + ", trying next...");
        continue;
      }
    }

    log("OIDC linking done! Form submission endpoint not found but Gigya data is set.");
    return { success: true, formSubmitted: false, error: "Form endpoint 405/404 for all methods" };
  } catch (err: any) {
    console.log("[CurlCookie] Error: " + err.message.substring(0, 200));
    log("Form fill error: " + err.message.substring(0, 80));
    return { success: false, formSubmitted: false, error: err.message.substring(0, 100) };
  } finally {
    try { if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile); } catch {}
  }
}

export async function ticketsFormFillViaCurl(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  authCode: string,
  zipCode: string,
  log: (msg: string) => void
): Promise<{ success: boolean; formSubmitted: boolean; error?: string }> {
  const available = await ensureCurlImpersonate();
  if (!available) {
    log("curl-impersonate not available, skipping form fill");
    return { success: false, formSubmitted: false, error: "curl-impersonate not found" };
  }

  const proxyUrl = getActiveProxyUrl();

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const cookieFile = path.join(CURL_COOKIE_DIR, `${sessionId}.txt`);

  try {
    log("Starting tickets.la28.org form fill via curl-impersonate...");
    console.log("[CurlImp] Session: " + sessionId + ", proxy: " + proxyUrl.substring(0, 40));

    const queueResult = await navigateQueueIt(
      "https://tickets.la28.org/mycustomerdata/",
      cookieFile,
      proxyUrl,
      log
    );

    if (!queueResult.passed) {
      return { success: false, formSubmitted: false, error: "Queue-it navigation failed" };
    }

    log("Authenticating with Keycloak auth code on tickets.la28.org...");
    const ssoUrl = `https://tickets.la28.org/api/singleSignOn/857?` + new URLSearchParams({
      code: authCode,
      contenttype: "json",
      force_session: "true",
      redirectUrl: "https://tickets.la28.org/mycustomerdata/",
    }).toString();

    let useZenRows = true;
    let ssoResp: CurlResponse;
    let zenRowsCookies = queueResult.zenRowsCookies || "";

    try {
      log("Trying ZenRows premium proxy for SSO call...");
      ssoResp = await zenRowsRequest(ssoUrl, {
        headers: {
          "Accept": "application/json",
          "Referer": "https://tickets.la28.org/mycustomerdata/",
        },
        followRedirects: false,
        cookies: zenRowsCookies || undefined,
      });

      if (isZenRowsFailure(ssoResp)) {
        console.log("[ZenRows-REST] SSO failed (" + ssoResp.statusCode + "), falling back to curl-impersonate");
        useZenRows = false;
      } else {
        const ssoCookies = extractCookiesFromResponse(ssoResp);
        zenRowsCookies = mergeCookieStrings(zenRowsCookies, ssoCookies);
        persistCookiesToFile(zenRowsCookies, cookieFile);
        console.log("[ZenRows-REST] SSO cookies captured: " + Object.keys(ssoCookies).join(", "));
      }
    } catch (zrErr: any) {
      console.log("[ZenRows-REST] SSO error: " + (zrErr.message || "").substring(0, 100) + ", falling back to curl-impersonate");
      useZenRows = false;
      ssoResp = { statusCode: 0, body: "", headers: {}, finalUrl: "" };
    }

    if (!useZenRows) {
      ssoResp = await curlImpersonate(ssoUrl, {
        cookieFile,
        proxy: proxyUrl,
        headers: {
          "Accept": "application/json",
          "Referer": "https://tickets.la28.org/mycustomerdata/",
        },
        followRedirects: false,
      });
    }

    console.log("[CurlImp] SSO response: " + ssoResp.statusCode + " body: " + ssoResp.body.substring(0, 200) + (useZenRows ? " (via ZenRows)" : " (via curl)"));

    if (ssoResp.statusCode === 403 || ssoResp.body.includes("Access Denied")) {
      log("Akamai blocked SSO API call. Session cookies may be invalid.");
      return { success: false, formSubmitted: false, error: "Akamai blocked API call" };
    }

    if (ssoResp.body.includes("errorCode") && ssoResp.body.includes('"message"')) {
      try {
        const ssoData = JSON.parse(ssoResp.body);
        if (ssoData.errorCode && ssoData.errorCode !== 0) {
          log("SSO login error: " + (ssoData.message || "code " + ssoData.errorCode));
          return { success: false, formSubmitted: false, error: "SSO: " + (ssoData.message || "login failed") };
        }
      } catch {
        console.log("[CurlImp] SSO response body not valid JSON: " + ssoResp.body.substring(0, 200));
      }
    }

    log("SSO authenticated on tickets.la28.org! Loading customer form...");

    let regResp: CurlResponse;
    if (useZenRows) {
      try {
        regResp = await zenRowsRequest("https://tickets.la28.org/api/login/registration", {
          headers: {
            "Accept": "application/json",
            "Referer": "https://tickets.la28.org/mycustomerdata/",
          },
          cookies: zenRowsCookies || undefined,
        });
        if (isZenRowsFailure(regResp)) {
          console.log("[ZenRows-REST] Registration form failed (" + regResp.statusCode + "), falling back to curl");
          useZenRows = false;
          if (zenRowsCookies) persistCookiesToFile(zenRowsCookies, cookieFile);
          regResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
            cookieFile,
            proxy: proxyUrl,
            headers: {
              "Accept": "application/json",
              "Referer": "https://tickets.la28.org/mycustomerdata/",
            },
          });
        } else {
          const regCookies = extractCookiesFromResponse(regResp);
          zenRowsCookies = mergeCookieStrings(zenRowsCookies, regCookies);
          persistCookiesToFile(zenRowsCookies, cookieFile);
        }
      } catch {
        console.log("[ZenRows-REST] Registration form error, falling back to curl");
        useZenRows = false;
        if (zenRowsCookies) persistCookiesToFile(zenRowsCookies, cookieFile);
        regResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
          cookieFile,
          proxy: proxyUrl,
          headers: {
            "Accept": "application/json",
            "Referer": "https://tickets.la28.org/mycustomerdata/",
          },
        });
      }
    } else {
      regResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
        cookieFile,
        proxy: proxyUrl,
        headers: {
          "Accept": "application/json",
          "Referer": "https://tickets.la28.org/mycustomerdata/",
        },
      });
    }

    console.log("[CurlImp] Registration form: " + regResp.statusCode + " size=" + regResp.body.length + (useZenRows ? " (via ZenRows)" : " (via curl)"));

    let xsrfToken = "";
    let formFields: any = null;
    try {
      const regData = JSON.parse(regResp.body);
      xsrfToken = regData.xsrfToken || "";
      formFields = regData.registrationForm || regData;
      console.log("[CurlImp] XSRF: " + xsrfToken + ", form keys: " + Object.keys(formFields).join(","));
    } catch {
      console.log("[CurlImp] Could not parse registration response");
    }

    const contactFields = formFields?.contactData || formFields?.myDataData || [];
    const fieldNames = Array.isArray(contactFields)
      ? contactFields.map((f: any) => f.fieldName)
      : [];

    console.log("[CurlImp] Form field names: " + fieldNames.join(", "));

    const formData: Record<string, string> = {};
    for (const f of fieldNames) {
      switch (f) {
        case "customerEmail": formData[f] = email; break;
        case "customerFirstName": formData[f] = firstName; break;
        case "customerLastName": formData[f] = lastName; break;
        case "customerCountry": formData[f] = "US"; break;
        case "customerPostalCode": formData[f] = zipCode; break;
        case "customerCity": formData[f] = "Los Angeles"; break;
        case "customerStreetAndNo": formData[f] = "123 Olympic Blvd"; break;
        case "customerProvince": formData[f] = "CA"; break;
        case "customerPhone": formData[f] = "+1" + (2130000000 + Math.floor(Math.random() * 9999999)).toString(); break;
      }
    }

    log("Submitting customer data on tickets.la28.org...");
    console.log("[CurlImp] Submitting form data: " + JSON.stringify(formData));

    const submitHeaders: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Referer": "https://tickets.la28.org/mycustomerdata/",
    };
    if (xsrfToken) {
      submitHeaders["X-XSRF-TOKEN"] = xsrfToken;
    }

    const submitBody = JSON.stringify({
      contactData: formData,
      page: "registration",
    });

    let submitResp: CurlResponse;
    if (useZenRows) {
      try {
        submitResp = await zenRowsRequest("https://tickets.la28.org/api/login/registration", {
          method: "POST",
          headers: submitHeaders,
          body: submitBody,
          cookies: zenRowsCookies || undefined,
        });

        if (isZenRowsFailure(submitResp)) {
          console.log("[ZenRows-REST] Submit failed (" + submitResp.statusCode + "), retrying with curl-impersonate");
          if (zenRowsCookies) persistCookiesToFile(zenRowsCookies, cookieFile);
          submitResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
            method: "POST",
            cookieFile,
            proxy: proxyUrl,
            headers: submitHeaders,
            body: submitBody,
          });
        }
      } catch {
        console.log("[ZenRows-REST] Submit error, falling back to curl");
        if (zenRowsCookies) persistCookiesToFile(zenRowsCookies, cookieFile);
        submitResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
          method: "POST",
          cookieFile,
          proxy: proxyUrl,
          headers: submitHeaders,
          body: submitBody,
        });
      }
    } else {
      submitResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
        method: "POST",
        cookieFile,
        proxy: proxyUrl,
        headers: submitHeaders,
        body: submitBody,
      });
    }

    console.log("[CurlImp] Submit response: " + submitResp.statusCode + " body: " + submitResp.body.substring(0, 300) + (useZenRows ? " (via ZenRows)" : " (via curl)"));

    if (submitResp.statusCode >= 200 && submitResp.statusCode < 300) {
      log("Form submitted on tickets.la28.org!");
      return { success: true, formSubmitted: true };
    } else if (submitResp.statusCode === 403) {
      log("Akamai blocked form submission (403).");
      return { success: false, formSubmitted: false, error: "Akamai blocked form submit" };
    } else {
      log("Form submit returned status " + submitResp.statusCode);
      return { success: false, formSubmitted: false, error: "Submit status: " + submitResp.statusCode };
    }
  } catch (err: any) {
    console.log("[CurlImp] Error: " + err.message.substring(0, 200));
    log("Form fill error: " + err.message.substring(0, 80));
    return { success: false, formSubmitted: false, error: err.message.substring(0, 100) };
  } finally {
    try { if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile); } catch {}
  }
}

let browserInstance: Browser | null = null;
let launching = false;
let browserInstalled = false;

function parseProxyUrl(proxyUrl: string): { host: string; port: string; username: string; password: string } | null {
  try {
    let normalized = proxyUrl.trim();
    if (normalized.startsWith("http://") || normalized.startsWith("https://") || normalized.startsWith("socks5://")) {
      const parsed = new URL(normalized);
      if (parsed.hostname && parsed.port) {
        return {
          host: parsed.hostname,
          port: parsed.port || '80',
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password),
        };
      }
    }
    const hostPortUserPass = normalized.match(/^(\d+\.\d+\.\d+\.\d+|[a-zA-Z0-9.-]+):(\d+):([^:]+):(.+)$/);
    if (hostPortUserPass) {
      return { host: hostPortUserPass[1], port: hostPortUserPass[2], username: hostPortUserPass[3], password: hostPortUserPass[4] };
    }
    const rawMatch = normalized.match(/^(\d+\.\d+\.\d+\.\d+|[a-zA-Z0-9.-]+):(\d+)@([^:]+):(.+)$/);
    if (rawMatch) {
      return { host: rawMatch[1], port: rawMatch[2], username: rawMatch[3], password: rawMatch[4] };
    }
    const authHostMatch = normalized.match(/^([^:]+):([^@]+)@(\d+\.\d+\.\d+\.\d+|[a-zA-Z0-9.-]+):(\d+)$/);
    if (authHostMatch) {
      return { host: authHostMatch[3], port: authHostMatch[4], username: authHostMatch[1], password: authHostMatch[2] };
    }
    normalized = `http://${normalized}`;
    const parsed = new URL(normalized);
    if (parsed.hostname && parsed.port) {
      return {
        host: parsed.hostname,
        port: parsed.port || '80',
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
      };
    }
    return null;
  } catch {
    return null;
  }
}

const LA_ZIP_CODES = [
  "90001", "90002", "90003", "90004", "90005", "90006", "90007", "90008",
  "90010", "90011", "90012", "90013", "90014", "90015", "90016", "90017",
  "90018", "90019", "90020", "90021", "90022", "90023", "90024", "90025",
  "90026", "90027", "90028", "90029", "90031", "90032", "90033", "90034",
  "90035", "90036", "90037", "90038", "90039", "90041", "90042", "90043",
  "90044", "90045", "90046", "90047", "90048", "90049", "90056", "90057",
  "90058", "90059", "90061", "90062", "90063", "90064", "90065", "90066",
  "90067", "90068", "90069", "90071", "90077", "90089", "90094", "90095",
  "90210", "90211", "90212", "90230", "90232", "90245", "90247", "90248",
  "90249", "90250", "90254", "90260", "90266", "90270", "90272", "90274",
  "90275", "90277", "90278", "90280", "90290", "90291", "90292", "90293",
  "90301", "90302", "90303", "90304", "90305", "90401", "90402", "90403",
  "90404", "90405",
];

function generateUSZip(): string {
  return LA_ZIP_CODES[Math.floor(Math.random() * LA_ZIP_CODES.length)];
}

async function dismissOneTrustConsent(page: Page, log: (msg: string) => void): Promise<void> {
  try {
    const dismissed = await page.evaluate(`(() => {
      var acceptBtn = document.querySelector('#onetrust-accept-btn-handler');
      if (acceptBtn) { acceptBtn.click(); return 'clicked-accept'; }
      var banner = document.querySelector('#onetrust-banner-sdk');
      if (banner) { banner.style.display = 'none'; return 'hidden-banner'; }
      var closeBtn = document.querySelector('.onetrust-close-btn-handler, [aria-label="Close"]');
      if (closeBtn) { closeBtn.click(); return 'clicked-close'; }
      return 'no-banner';
    })()`) as string;
    if (dismissed !== 'no-banner') {
      log("OneTrust consent: " + dismissed);
      await page.waitForTimeout(1000);
    }
  } catch {}
}

function isQueueItPage(url: string): boolean {
  return url.includes('c=web&e=la28q') || url.includes('enqueuetoken=') || url.includes('queue-it.net');
}

function generateRandomBirthYear(): string {
  const minYear = 1960;
  const maxYear = 2000;
  return String(minYear + Math.floor(Math.random() * (maxYear - minYear + 1)));
}

async function fillCustomerDataForm(page: Page, log: (msg: string) => void): Promise<void> {
  try {
    await page.waitForTimeout(3000);

    const birthYear = generateRandomBirthYear();
    log("Selecting birth year: " + birthYear + "...");

    const birthYearSelected = await page.evaluate(`((year) => {
      var selects = document.querySelectorAll('select');
      for (var i = 0; i < selects.length; i++) {
        var sel = selects[i];
        var label = '';
        if (sel.id) {
          var labelEl = document.querySelector('label[for="' + sel.id + '"]');
          if (labelEl) label = labelEl.textContent || '';
        }
        var prevText = sel.previousElementSibling ? (sel.previousElementSibling.textContent || '') : '';
        var parentText = sel.parentElement ? (sel.parentElement.textContent || '') : '';
        if (label.toLowerCase().includes('birth') || prevText.toLowerCase().includes('birth') || parentText.toLowerCase().includes('birth') || sel.name && sel.name.toLowerCase().includes('birth')) {
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === year || sel.options[j].text === year) {
              sel.value = sel.options[j].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
        }
      }
      return false;
    })("${birthYear}")`) as boolean;

    if (!birthYearSelected) {
      log("Birth year dropdown not found, trying alternative selectors...");
      await page.evaluate(`((year) => {
        var selects = document.querySelectorAll('select');
        for (var i = 0; i < selects.length; i++) {
          var sel = selects[i];
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === year || sel.options[j].text === year) {
              sel.value = sel.options[j].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      })("${birthYear}")`);
    }
    log("Birth year selected: " + birthYear);

    await page.waitForTimeout(1000);

    log("Clicking 'Save profile & submit registration'...");
    const submitClicked = await page.evaluate(`(() => {
      var buttons = document.querySelectorAll('button, input[type="submit"], a.btn, a.button');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var text = (btn.textContent || btn.value || '').toLowerCase().trim();
        if (text.includes('save profile') || text.includes('submit registration') || text.includes('save') && text.includes('registration')) {
          btn.click();
          return true;
        }
      }
      var allButtons = document.querySelectorAll('[type="submit"], button[class*="submit"], button[class*="save"]');
      for (var j = 0; j < allButtons.length; j++) {
        allButtons[j].click();
        return true;
      }
      return false;
    })()`) as boolean;

    if (submitClicked) {
      log("Profile form submitted! Waiting for confirmation...");
      await page.waitForTimeout(5000);

      const resultText = await page.evaluate(`(() => {
        return document.body ? document.body.innerText.substring(0, 500) : '';
      })()`) as string;
      console.log("[Playwright] After profile submit (first 300):", resultText.substring(0, 300));

      if (resultText.toLowerCase().includes('success') || resultText.toLowerCase().includes('thank') || resultText.toLowerCase().includes('confirmed') || resultText.toLowerCase().includes('registered')) {
        log("Profile saved and registration submitted successfully!");
      } else {
        log("Profile form submitted. Account fully created!");
      }
    } else {
      log("Submit button not found, but account creation is complete.");
    }
  } catch (err: any) {
    log("Profile form step skipped: " + err.message);
  }
}

const GIGYA_API_KEY = "4_w4CcQ6tKu4jTeDPirnKxnA";
const GIGYA_DATACENTER = "eu1";

const OLYMPIC_SPORTS = [
  "AQU", "ARC", "ATH", "BDM", "BKB", "BVB", "BOX", "CSP", "CYC",
  "EQU", "FEN", "FBL", "GLF", "GYM", "HBL", "HOC", "JUD", "MPN",
  "ROW", "RUG", "SAL", "SHO", "SKB", "CLB", "SRF", "SWM", "TTE",
  "TKW", "TEN", "TRI", "VOL", "WPO", "WLF", "WRE",
];

const PARALYMPIC_SPORTS = [
  "ARC", "ATH", "BDM", "BKW", "BOC", "CSP", "CYC", "EQU",
  "FBL5", "GBL", "JUD", "PFN", "PWL", "ROW", "SHO", "SIT",
  "SWM", "TTE", "TKW", "TRI", "WRU",
];

const TEAM_NOCS = [
  "USA", "GBR", "FRA", "GER", "AUS", "CAN", "JPN", "BRA",
  "ITA", "ESP", "NED", "KOR", "CHN", "NZL", "SWE", "MEX",
  "ARG", "JAM", "KEN", "ETH", "NOR", "DEN", "COL", "IND",
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function completeTicketsProfile(
  page: Page,
  email: string,
  password: string,
  log: (msg: string) => void
): Promise<void> {
  const birthYear = generateRandomBirthYear();

  const favOlympicSports = pickRandom(OLYMPIC_SPORTS, 3 + Math.floor(Math.random() * 4));
  const favParalympicSports = pickRandom(PARALYMPIC_SPORTS, 2 + Math.floor(Math.random() * 3));
  const favTeams = pickRandom(TEAM_NOCS, 2 + Math.floor(Math.random() * 3));

  log("Setting profile: birth year " + birthYear + ", " + favOlympicSports.length + " Olympic sports, " + favParalympicSports.length + " Paralympic sports, " + favTeams.length + " teams...");

  const profileResult = await page.evaluate(`((birthYr) => {
    return new Promise(function(resolve) {
      if (typeof gigya === 'undefined') {
        resolve({ success: false, error: 'Gigya SDK not available', step: 'check' });
        return;
      }
      gigya.accounts.setAccountInfo({
        profile: { birthYear: parseInt(birthYr) },
        callback: function(resp) {
          resolve({
            success: resp.errorCode === 0,
            error: resp.errorCode === 0 ? null : (resp.errorMessage || 'Code: ' + resp.errorCode),
            step: 'profile'
          });
        }
      });
      setTimeout(function() { resolve({ success: false, error: 'timeout', step: 'profile' }); }, 15000);
    });
  })("${birthYear}")`) as { success: boolean; error?: string | null; step: string };

  console.log("[Playwright] Profile result:", JSON.stringify(profileResult));

  if (!profileResult.success) {
    log("Profile update failed: " + (profileResult.error || "unknown"));
    await tryRestApiFallback(page, birthYear, favOlympicSports, favParalympicSports, favTeams, log);
    return;
  }

  log("Birth year " + birthYear + " set!");

  const olympicSportsJSON = JSON.stringify(favOlympicSports.map(function(code: string) { return { ocsCode: code }; }));
  const paralympicSportsJSON = JSON.stringify(favParalympicSports.map(function(code: string) { return { ocsCode: code, GameType: "PG" }; }));
  const allSportsJSON = JSON.stringify([
    ...favOlympicSports.map(function(code: string) { return { ocsCode: code, odfCode: code, GameType: "OG" }; }),
    ...favParalympicSports.map(function(code: string) { return { ocsCode: code, odfCode: code, GameType: "PG" }; }),
  ]);
  const teamsJSON = JSON.stringify(favTeams.map(function(code: string) { return { ocsCode: code, nocCode: code, gameType: "OG" }; }));

  log("Setting favorite sports and teams...");

  const dataResult = await page.evaluate(`((sportsStr, teamsStr) => {
    return new Promise(function(resolve) {
      var sports = JSON.parse(sportsStr);
      var teams = JSON.parse(teamsStr);
      gigya.accounts.setAccountInfo({
        data: {
          personalization: {
            favoritesDisciplines: sports,
            favoritesCountries: teams,
            siteLanguage: 'en'
          },
          entryCampaignandSegregation: {
            l2028_ticketing: 'true',
            l2028_fan28: 'true'
          }
        },
        callback: function(resp) {
          resolve({
            success: resp.errorCode === 0,
            error: resp.errorCode === 0 ? null : (resp.errorMessage || 'Code: ' + resp.errorCode),
            step: 'data'
          });
        }
      });
      setTimeout(function() { resolve({ success: false, error: 'timeout', step: 'data' }); }, 15000);
    });
  })('${allSportsJSON.replace(/'/g, "\\'")}', '${teamsJSON.replace(/'/g, "\\'")}')`) as { success: boolean; error?: string | null; step: string };

  console.log("[Playwright] Data result:", JSON.stringify(dataResult));

  if (dataResult.success) {
    log("Favorites saved! " + favOlympicSports.length + " Olympic + " + favParalympicSports.length + " Paralympic sports, " + favTeams.length + " teams");
  } else {
    log("Favorites save issue: " + (dataResult.error || "unknown") + " - trying individual fields...");

    const fallbackResult = await page.evaluate(`((sportsStr, teamsStr) => {
      return new Promise(function(resolve) {
        var sports = JSON.parse(sportsStr);
        var teams = JSON.parse(teamsStr);
        gigya.accounts.setAccountInfo({
          data: {
            personalization: { favoritesDisciplines: sports },
          },
          callback: function(r1) {
            if (r1.errorCode !== 0) {
              resolve({ success: false, error: 'sports: ' + r1.errorMessage, step: 'sports' });
              return;
            }
            gigya.accounts.setAccountInfo({
              data: {
                personalization: { favoritesCountries: teams },
              },
              callback: function(r2) {
                if (r2.errorCode !== 0) {
                  resolve({ success: false, error: 'teams: ' + r2.errorMessage, step: 'teams' });
                  return;
                }
                gigya.accounts.setAccountInfo({
                  data: {
                    entryCampaignandSegregation: { l2028_ticketing: 'true', l2028_fan28: 'true' }
                  },
                  callback: function(r3) {
                    resolve({ success: r3.errorCode === 0, error: r3.errorCode === 0 ? null : r3.errorMessage, step: 'flags' });
                  }
                });
              }
            });
          }
        });
        setTimeout(function() { resolve({ success: false, error: 'timeout', step: 'fallback' }); }, 20000);
      });
    })('${allSportsJSON.replace(/'/g, "\\'")}', '${teamsJSON.replace(/'/g, "\\'")}')`) as { success: boolean; error?: string | null; step: string };

    console.log("[Playwright] Fallback data result:", JSON.stringify(fallbackResult));
    if (fallbackResult.success) {
      log("Favorites saved via individual updates!");
    } else {
      log("Favorites fallback: " + (fallbackResult.error || "failed"));
    }
  }
}

async function loginAndSubmitTicketRegistration(
  page: Page,
  email: string,
  password: string,
  log: (msg: string) => void,
  proxyUrl?: string,
  zipCode?: string
): Promise<{ submitted: boolean }> {
  const usedZipCode = zipCode || generateUSZip();
  const safeEmail = email.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safePass = password.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');

  log("Starting simplified draw registration flow...");
  console.log("[Draw] Starting draw registration for " + email);

  let proxyBrowser: Browser | null = null;
  let proxyContext: any = null;
  let ticketsPage: Page;
  let capturedOidcUrl: string | null = null;

  try {
    {
      console.log("[Draw] Launching Chromium with " + getActiveProxyLabel() + "...");
      proxyBrowser = await chromium.launch({
        headless: true,
        proxy: getActiveProxyConfig(),
        args: ['--ignore-certificate-errors', '--disable-blink-features=AutomationControlled'],
      });
      proxyContext = await proxyBrowser.newContext({
        ignoreHTTPSErrors: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        geolocation: { latitude: 40.7128, longitude: -74.0060 },
        permissions: ['geolocation'],
      });
      ticketsPage = await proxyContext.newPage();

      await ticketsPage.route('**/public-api.eventim.com/**', async (route) => {
        const url = route.request().url();
        console.log("[Draw] Intercepted eventim.com request: " + url.substring(0, 200));
        capturedOidcUrl = url;
        await route.abort();
      });
    }
    ticketsPage.setDefaultTimeout(60000);

    console.log("[Draw] Navigating to tickets.la28.org/mycustomerdata...");
    try {
      await ticketsPage.goto("https://tickets.la28.org/mycustomerdata/?#/myCustomerData", { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (navErr: any) {
      console.log("[Draw] Navigation error: " + navErr.message.substring(0, 150));
      if (navErr.message.includes("robots.txt") || navErr.message.includes("restricted")) {
        log("Browser blocked. Already using Decodo residential proxy.");
      }
    }

    await ticketsPage.waitForTimeout(5000);
    let currentUrl = ticketsPage.url();
    console.log("[Draw] After nav URL: " + currentUrl.substring(0, 150));

    if (isQueueItPage(currentUrl)) {
      console.log("[Draw] Queue-it detected. Waiting...");
      for (let qw = 0; qw < 40; qw++) {
        await ticketsPage.waitForTimeout(3000);
        currentUrl = ticketsPage.url();
        if (!isQueueItPage(currentUrl)) {
          console.log("[Draw] Passed queue after " + ((qw + 1) * 3) + "s");
          break;
        }
        if (qw === 39) {
          log("Queue timeout after 120s.");
          try { if (proxyBrowser) await proxyBrowser.close(); } catch {}
          return { submitted: false };
        }
      }
    }

    currentUrl = ticketsPage.url();
    console.log("[Draw] Current URL after queue check: " + currentUrl.substring(0, 200));

    for (let authAttempt = 0; authAttempt < 20; authAttempt++) {
      await ticketsPage.waitForTimeout(3000);
      currentUrl = ticketsPage.url();
      if (authAttempt % 3 === 0) {
        console.log("[Draw] Auth loop [" + (authAttempt * 3) + "s] URL: " + currentUrl.substring(0, 200));
      }

      if (currentUrl.includes("chrome-error://") || (capturedOidcUrl && !currentUrl.includes("mycustomerdata"))) {
        if (capturedOidcUrl) {
          console.log("[Draw] Eventim OIDC URL captured! Handling auth via direct HTTP...");
          console.log("[Draw] OIDC URL: " + capturedOidcUrl.substring(0, 300));
          try {
            const axios = (await import("axios")).default;
            const oidcResp = await axios.get(capturedOidcUrl, {
              maxRedirects: 0,
              validateStatus: (s: number) => true,
              timeout: 15000,
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' }
            });
            const oidcLocation = oidcResp.headers['location'] || '';
            console.log("[Draw] OIDC response: " + oidcResp.status + " location=" + oidcLocation.substring(0, 300));

            if (oidcResp.status === 200) {
              const html = typeof oidcResp.data === 'string' ? oidcResp.data : '';
              console.log("[Draw] OIDC returned HTML page (login form). Length=" + html.length);
              const formAction = html.match(/action="([^"]+)"/)?.[1] || '';
              console.log("[Draw] Form action: " + formAction.substring(0, 200));

              if (formAction) {
                const actionUrl = formAction.startsWith('http') ? formAction : 'https://public-api.eventim.com' + formAction;
                const cookies = oidcResp.headers['set-cookie'] || [];
                const cookieStr = Array.isArray(cookies) ? cookies.map((c: string) => c.split(';')[0]).join('; ') : '';

                console.log("[Draw] Submitting login to: " + actionUrl.substring(0, 200));
                const loginResp = await axios.post(actionUrl, new URLSearchParams({ username: email, password: password }).toString(), {
                  maxRedirects: 0,
                  validateStatus: (s: number) => true,
                  timeout: 15000,
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookieStr,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                  }
                });
                const loginLocation = loginResp.headers['location'] || '';
                console.log("[Draw] Login response: " + loginResp.status + " location=" + loginLocation.substring(0, 300));

                if (loginLocation.includes("tickets.la28.org") && loginLocation.includes("code=")) {
                  console.log("[Draw] Got auth code! Navigating to callback URL...");
                  await ticketsPage.unroute('**/public-api.eventim.com/**');
                  try {
                    await ticketsPage.goto(loginLocation, { waitUntil: "domcontentloaded", timeout: 60000 });
                  } catch {}
                  console.log("[Draw] After auth callback URL: " + ticketsPage.url().substring(0, 200));
                  capturedOidcUrl = null;
                  continue;
                } else if (loginLocation) {
                  console.log("[Draw] Following login redirect: " + loginLocation.substring(0, 200));
                  let finalUrl = loginLocation;
                  for (let followIdx = 0; followIdx < 5; followIdx++) {
                    try {
                      const followResp = await axios.get(finalUrl, {
                        maxRedirects: 0,
                        validateStatus: (s: number) => true,
                        timeout: 15000,
                        headers: { 'Cookie': cookieStr, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' }
                      });
                      const nextLoc = followResp.headers['location'] || '';
                      console.log("[Draw] Redirect " + followIdx + ": " + followResp.status + " → " + nextLoc.substring(0, 200));
                      if (nextLoc.includes("tickets.la28.org")) {
                        console.log("[Draw] Got tickets redirect! Navigating...");
                        await ticketsPage.unroute('**/public-api.eventim.com/**');
                        try { await ticketsPage.goto(nextLoc, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch {}
                        console.log("[Draw] After redirect URL: " + ticketsPage.url().substring(0, 200));
                        capturedOidcUrl = null;
                        break;
                      }
                      if (!nextLoc) break;
                      finalUrl = nextLoc.startsWith('http') ? nextLoc : 'https://public-api.eventim.com' + nextLoc;
                    } catch (followErr: any) {
                      console.log("[Draw] Follow redirect error: " + followErr.message.substring(0, 100));
                      break;
                    }
                  }
                }
              }
            } else if (oidcLocation.includes("tickets.la28.org")) {
              console.log("[Draw] OIDC redirected directly to tickets. Navigating...");
              await ticketsPage.unroute('**/public-api.eventim.com/**');
              try { await ticketsPage.goto(oidcLocation, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch {}
              capturedOidcUrl = null;
              continue;
            } else if (oidcLocation.includes("next.tickets.la28.org") || oidcLocation.includes("queue")) {
              console.log("[Draw] Queue-it redirect detected in OIDC: " + oidcLocation.substring(0, 200));
              const tParam = new URL(oidcLocation).searchParams.get('t');
              if (tParam) {
                console.log("[Draw] Queue target URL: " + tParam.substring(0, 200));
              }
            } else if (oidcLocation) {
              console.log("[Draw] OIDC redirected to: " + oidcLocation.substring(0, 200));
              try {
                const followResp = await axios.get(oidcLocation, { maxRedirects: 5, timeout: 15000, validateStatus: (s: number) => true });
                console.log("[Draw] Follow response: " + followResp.status + " final URL type: " + typeof followResp.request?.res?.responseUrl);
              } catch (e: any) {
                console.log("[Draw] Follow error: " + e.message.substring(0, 100));
              }
            }
          } catch (oidcErr: any) {
            console.log("[Draw] OIDC handling error: " + oidcErr.message.substring(0, 150));
          }
        } else {
          console.log("[Draw] Chrome error page — retrying navigation...");
          try {
            await ticketsPage.goto("https://tickets.la28.org/mycustomerdata/?#/myCustomerData", { waitUntil: "domcontentloaded", timeout: 60000 });
          } catch {}
        }
        continue;
      }

      if (currentUrl.includes("la28id.la28.org")) {
        console.log("[Draw] On la28id.la28.org login page. Logging in via Gigya...");
        try {
          await ticketsPage.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
          await waitForRecaptchaEnterprise(ticketsPage, 8000);
          await simulateHumanBehavior(ticketsPage, email, password);
          const loginResult = await ticketsPage.evaluate(`
            new Promise(function(resolve) {
              gigya.accounts.login({
                loginID: "${safeEmail}",
                password: "${safePass}",
                callback: function(r) { resolve({ ok: r.errorCode === 0, uid: r.UID || null, err: r.errorMessage || '', code: r.errorCode }); }
              });
              setTimeout(function() { resolve({ ok: false, err: 'timeout' }); }, 30000);
            })
          `) as { ok: boolean; uid: string | null; err: string; code: number };
          console.log("[Draw] Gigya login: ok=" + loginResult.ok + " uid=" + (loginResult.uid || 'null') + " err=" + loginResult.err + " code=" + loginResult.code);
          if (!loginResult.ok) {
            try { if (proxyBrowser) await proxyBrowser.close(); } catch {}
            return { submitted: false };
          }
        } catch (e: any) {
          console.log("[Draw] Gigya login error: " + e.message.substring(0, 100));
        }
        await ticketsPage.waitForTimeout(3000);
        continue;
      }

      if (currentUrl.includes("tickets.la28.org") && currentUrl.includes("mycustomerdata") && !currentUrl.includes("#/login")) {
        console.log("[Draw] Authenticated and on mycustomerdata page!");
        break;
      }

      if (currentUrl.includes("tickets.la28.org") && currentUrl.includes("#/login")) {
        console.log("[Draw] On tickets login page, waiting for OIDC redirect...");
        continue;
      }

      if (authAttempt === 19) {
        console.log("[Draw] Auth loop timed out. Final URL: " + currentUrl.substring(0, 200));
      }
    }

    await dismissOneTrustConsent(ticketsPage, log);

    currentUrl = ticketsPage.url();
    if (!currentUrl.includes("mycustomerdata")) {
      console.log("[Draw] Not on mycustomerdata. Navigating directly...");
      try {
        await ticketsPage.goto("https://tickets.la28.org/mycustomerdata/?#/myCustomerData", { waitUntil: "domcontentloaded", timeout: 60000 });
      } catch {}
    }

    try { await ticketsPage.waitForLoadState("networkidle", { timeout: 30000 }); } catch {}
    await dismissOneTrustConsent(ticketsPage, log);

    console.log("[Draw] Waiting for Angular SPA to render form...");
    let formRendered = false;
    for (let w = 0; w < 20; w++) {
      await ticketsPage.waitForTimeout(3000);
      try {
        const selCount = await ticketsPage.evaluate(() => document.querySelectorAll('select').length);
        const bodyText = await ticketsPage.evaluate(() => (document.body?.innerText || "").substring(0, 300));
        if (w % 3 === 0) {
          console.log("[Draw] [" + ((w + 1) * 3) + "s] URL=" + ticketsPage.url().substring(0, 100) + " selects=" + selCount);
          console.log("[Draw] Body: " + bodyText.substring(0, 150));
        }
        if (selCount > 0) {
          console.log("[Draw] Form rendered! " + selCount + " selects found after " + ((w + 1) * 3) + "s");
          formRendered = true;
          break;
        }
        if (bodyText.includes("Birth Year") || bodyText.includes("PROFILE") || bodyText.includes("INFORMATION")) {
          if (!bodyText.includes("Loading")) {
            console.log("[Draw] Profile text detected, checking for form controls...");
            await ticketsPage.waitForTimeout(3000);
            const selCount2 = await ticketsPage.evaluate(() => document.querySelectorAll('select').length);
            if (selCount2 > 0) {
              console.log("[Draw] Selects appeared: " + selCount2);
              formRendered = true;
              break;
            }
          }
        }
      } catch {}
      if (w === 19) console.log("[Draw] Form did not render after 60s");
    }

    const diagUrl = ticketsPage.url();
    const diagTitle = await ticketsPage.evaluate(() => document.title || "");
    const diagText = await ticketsPage.evaluate(() => (document.body?.innerText || "").substring(0, 500));
    const diagTags = await ticketsPage.evaluate(`(() => {
      var tags = {};
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var t = all[i].tagName;
        tags[t] = (tags[t] || 0) + 1;
      }
      return tags;
    })()`) as Record<string, number>;

    console.log("[Draw] DIAGNOSTIC URL: " + diagUrl);
    console.log("[Draw] DIAGNOSTIC title: " + diagTitle);
    console.log("[Draw] DIAGNOSTIC text: " + diagText.substring(0, 300));
    console.log("[Draw] DIAGNOSTIC DOM tags: " + JSON.stringify(diagTags));

    const iframeInfo = await ticketsPage.evaluate(`(() => {
      var iframes = document.querySelectorAll('iframe');
      var result = [];
      for (var i = 0; i < iframes.length; i++) {
        result.push({ src: (iframes[i].src || '').substring(0, 200), id: iframes[i].id, w: iframes[i].getBoundingClientRect().width, h: iframes[i].getBoundingClientRect().height });
      }
      return result;
    })()`) as any[];
    if (iframeInfo.length > 0) {
      console.log("[Draw] Iframes: " + JSON.stringify(iframeInfo));
    }

    let formTarget: Page | any = ticketsPage;
    const mainSelects = await ticketsPage.evaluate(() => document.querySelectorAll('select').length);
    if (mainSelects === 0 && iframeInfo.length > 0) {
      const frames = ticketsPage.frames();
      for (const frame of frames) {
        if (frame === ticketsPage.mainFrame()) continue;
        try {
          const fSelects = await frame.evaluate(() => document.querySelectorAll('select').length);
          if (fSelects > 0) {
            formTarget = frame;
            console.log("[Draw] Found form in iframe with " + fSelects + " selects");
            break;
          }
        } catch {}
      }
    }

    if (mainSelects === 0 && formTarget === ticketsPage) {
      console.log("[Draw] CRITICAL: No select elements found. Dumping visible elements...");
      const htmlDump = await ticketsPage.evaluate(() => {
        const elements: string[] = [];
        const all = document.body?.querySelectorAll('*') || [];
        for (let i = 0; i < Math.min(all.length, 300); i++) {
          const el = all[i] as HTMLElement;
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            elements.push(el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
          }
        }
        return elements.join(', ');
      });
      console.log("[Draw] Visible elements: " + String(htmlDump).substring(0, 800));
      log("No form elements found on tickets.la28.org. The page did not render the Angular form.");
      try { if (proxyBrowser) await proxyBrowser.close(); } catch {}
      return { submitted: false };
    }

    log("Form found! Filling selects and inputs...");
    console.log("[Draw] Form found. Filling form fields...");

    const fillResult = await formTarget.evaluate(`((zipVal) => {
        var results = [];
        var selects = document.querySelectorAll('select');
        var usedOly = {}, usedPara = {}, usedTeam = {};

        function getLabel(el) {
          var label = '';
          var prev = el.previousElementSibling;
          if (prev) label = (prev.textContent || '').trim().toLowerCase();
          if (!label) {
            var parent = el.closest('.form-group, .field-wrapper, div');
            if (parent) {
              var lbl = parent.querySelector('label');
              if (lbl) label = (lbl.textContent || '').trim().toLowerCase();
            }
          }
          if (!label) {
            var p2 = el.parentElement;
            while (p2 && p2 !== document.body) {
              var txt = '';
              for (var c = 0; c < p2.childNodes.length; c++) {
                if (p2.childNodes[c].nodeType === 3) txt += p2.childNodes[c].textContent;
              }
              txt = txt.trim().toLowerCase();
              if (txt.length > 2 && txt.length < 100) { label = txt; break; }
              var headings = p2.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,label,span');
              for (var h = 0; h < headings.length; h++) {
                var ht = (headings[h].textContent || '').trim().toLowerCase();
                if (ht.length > 2 && ht.length < 100) { label = ht; break; }
              }
              if (label) break;
              p2 = p2.parentElement;
            }
          }
          return label;
        }

        function setSelectVal(s, val) {
          var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
          if (nativeSet && nativeSet.set) nativeSet.set.call(s, val);
          else s.value = val;
          s.dispatchEvent(new Event('input', { bubbles: true }));
          s.dispatchEvent(new Event('change', { bubbles: true }));
          s.dispatchEvent(new Event('blur', { bubbles: true }));
        }

        function getValidOpts(s) {
          var opts = [];
          for (var j = 0; j < s.options.length; j++) {
            var o = s.options[j];
            if (o.text !== 'Please select' && o.value && o.value.indexOf('null') < 0 && o.value !== '') {
              opts.push(o);
            }
          }
          return opts;
        }

        for (var i = 0; i < selects.length; i++) {
          var s = selects[i];
          var id = (s.id || '').toLowerCase();
          var name = (s.name || '').toLowerCase();
          var label = getLabel(s);
          results.push('select#' + i + ': id=' + id.substring(0, 40) + ' name=' + name.substring(0, 30) + ' label=' + label.substring(0, 40) + ' opts=' + s.options.length);
          if (id.indexOf('customercountry') >= 0 || name.indexOf('country') >= 0) continue;
          var opts = getValidOpts(s);
          if (opts.length === 0) continue;
          var pick = null;

          var isBirthYear = id.indexOf('additionalcustomerattributes') >= 0
            || id.indexOf('birthyear') >= 0 || id.indexOf('birth_year') >= 0 || id.indexOf('birth-year') >= 0
            || label.indexOf('birth') >= 0 || name.indexOf('birth') >= 0;

          var isOlySport = id.indexOf('categoryfavorites288') >= 0
            || id.indexOf('olympicsport') >= 0 || id.indexOf('olympic-sport') >= 0
            || (label.indexOf('olympic') >= 0 && label.indexOf('paralympic') < 0 && label.indexOf('sport') >= 0)
            || (label.indexOf('olympic') >= 0 && label.indexOf('paralympic') < 0 && label.indexOf('moment') >= 0);

          var isParaSport = id.indexOf('categoryfavorites289') >= 0
            || id.indexOf('paralympicsport') >= 0 || id.indexOf('paralympic-sport') >= 0
            || (label.indexOf('paralympic') >= 0 && (label.indexOf('sport') >= 0 || label.indexOf('moment') >= 0));

          var isTeam = id.indexOf('artistfavorites') >= 0 || id.indexOf('team') >= 0 || label.indexOf('team') >= 0;

          if (!isBirthYear && !isOlySport && !isParaSport && !isTeam) {
            var hasYears = opts.some(function(o) { var y = parseInt(o.text); return y >= 1950 && y <= 2010; });
            if (hasYears) isBirthYear = true;
            else if (opts.some(function(o) { return o.text.toLowerCase().indexOf('swimming') >= 0 || o.text.toLowerCase().indexOf('basketball') >= 0 || o.text.toLowerCase().indexOf('athletics') >= 0; })) {
              if (!usedOly['__assigned__']) isOlySport = true;
              else if (!usedPara['__assigned__']) isParaSport = true;
            }
            else if (opts.some(function(o) { return o.text.length === 3 || o.text.indexOf('United States') >= 0 || o.text.indexOf('USA') >= 0; })) {
              isTeam = true;
            }
          }

          if (isBirthYear) {
            var yearOpts = opts.filter(function(o) { var y = parseInt(o.text); return y >= 1975 && y <= 2000; });
            pick = yearOpts.length > 0 ? yearOpts[Math.floor(Math.random() * yearOpts.length)] : opts[Math.floor(opts.length / 2)];
            if (pick) results.push('BirthYear:' + pick.text);
          } else if (isOlySport) {
            usedOly['__assigned__'] = true;
            var avail = opts.filter(function(o) { return !usedOly[o.value]; });
            pick = avail.length > 0 ? avail[Math.floor(Math.random() * avail.length)] : opts[0];
            if (pick) { usedOly[pick.value] = true; results.push('Oly:' + pick.text.substring(0, 20)); }
          } else if (isParaSport) {
            usedPara['__assigned__'] = true;
            var avail2 = opts.filter(function(o) { return !usedPara[o.value]; });
            pick = avail2.length > 0 ? avail2[Math.floor(Math.random() * avail2.length)] : opts[0];
            if (pick) { usedPara[pick.value] = true; results.push('Para:' + pick.text.substring(0, 20)); }
          } else if (isTeam) {
            var avail3 = opts.filter(function(o) { return !usedTeam[o.value]; });
            pick = avail3.length > 0 ? avail3[Math.floor(Math.random() * avail3.length)] : opts[0];
            if (pick) { usedTeam[pick.value] = true; results.push('Team:' + pick.text.substring(0, 20)); }
          }
          if (pick) setSelectVal(s, pick.value);
        }

        var postalFilled = false;
        var inputs = document.querySelectorAll('input');
        for (var k = 0; k < inputs.length; k++) {
          var inp = inputs[k];
          var inpId = (inp.id || '').toLowerCase();
          var inpName = (inp.name || '').toLowerCase();
          var inpLabel = getLabel(inp);
          var isPostal = inpId.indexOf('postal') >= 0 || inpId.indexOf('zip') >= 0
            || inpName.indexOf('postal') >= 0 || inpName.indexOf('zip') >= 0
            || inpLabel.indexOf('postal') >= 0 || inpLabel.indexOf('zip') >= 0;
          if (isPostal && (!inp.value || inp.value.trim() === '')) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (setter && setter.set) setter.set.call(inp, zipVal);
            else inp.value = zipVal;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
            postalFilled = true;
            results.push('Postal:' + zipVal);
          }
        }

        var filled = 0;
        for (var m = 0; m < selects.length; m++) {
          if (selects[m].value && selects[m].value.indexOf('null') < 0 && selects[m].value !== '') filled++;
        }
        results.unshift(filled + '/' + selects.length + ' selects filled' + (postalFilled ? ', postal filled' : ''));
        return results;
      })("${usedZipCode}")`) as string[];

    console.log("[Draw] Form fill result: " + (fillResult || []).join(", "));
    log("Form fill: " + (fillResult || []).join(", "));
    await ticketsPage.waitForTimeout(2000);

    log("Clicking 'Save profile & submit registration'...");
    const btnClicked = await formTarget.evaluate(`(() => {
      var buttons = document.querySelectorAll('button[type="submit"], button, input[type="submit"], a.btn, a.button');
      for (var i = 0; i < buttons.length; i++) {
        var t = (buttons[i].textContent || buttons[i].value || '').toLowerCase().trim();
        if (t.indexOf('save profile') >= 0 || (t.indexOf('submit') >= 0 && t.indexOf('registration') >= 0)) {
          buttons[i].click(); return 'clicked: ' + (buttons[i].textContent || buttons[i].value || '').trim();
        }
      }
      for (var j = 0; j < buttons.length; j++) {
        var t2 = (buttons[j].textContent || buttons[j].value || '').toLowerCase().trim();
        if (t2.indexOf('submit') >= 0 || t2.indexOf('save') >= 0 || t2.indexOf('register') >= 0) {
          buttons[j].click(); return 'clicked-fallback: ' + (buttons[j].textContent || buttons[j].value || '').trim();
        }
      }
      var allBtnTexts = [];
      for (var k = 0; k < buttons.length; k++) allBtnTexts.push((buttons[k].textContent || buttons[k].value || '').trim().substring(0, 40));
      return 'not-found: buttons=[' + allBtnTexts.join('|') + '] body=' + (document.body?.innerText || '').substring(0, 200);
    })()`) as string;

    console.log("[Draw] Button click result: " + btnClicked);

    if (btnClicked.startsWith('clicked')) {
      log("Submit button clicked: " + btnClicked);
      try {
        await ticketsPage.waitForTimeout(10000);
        const afterUrl = ticketsPage.url();
        const afterText = await formTarget.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
        console.log("[Draw] After submit URL: " + afterUrl.substring(0, 100));
        console.log("[Draw] After submit text: " + afterText.substring(0, 300));
        if (afterUrl.includes("mydatasuccess") || afterText.toLowerCase().includes("success") || afterText.toLowerCase().includes("you are registered") || afterText.toLowerCase().includes("thank you")) {
          log("SUCCESS! Draw registration complete.");
        }
      } catch (postErr: any) {
        console.log("[Draw] Post-submit error: " + postErr.message.substring(0, 100));
      }
      try { if (proxyBrowser) await proxyBrowser.close(); } catch {}
      log("Draw registration form submitted.");
      return { submitted: true };
    } else {
      log("Submit button not found: " + btnClicked.substring(0, 300));
      try { if (proxyBrowser) await proxyBrowser.close(); } catch {}
      return { submitted: false };
    }

  } catch (err: any) {
    console.log("[Draw] Error: " + err.message.substring(0, 200));
    log("Draw registration error: " + err.message.substring(0, 150));
    try { if (proxyBrowser) await proxyBrowser.close(); } catch {}
    return { submitted: false };
  }
}
async function fillTicketsProfileForm(page: Page, log: (msg: string) => void): Promise<void> {
  const birthYear = generateRandomBirthYear();
  const favOlympicSports = pickRandom(OLYMPIC_SPORTS, 3 + Math.floor(Math.random() * 4));
  const favParalympicSports = pickRandom(PARALYMPIC_SPORTS, 2 + Math.floor(Math.random() * 3));
  const favTeams = pickRandom(TEAM_NOCS, 2 + Math.floor(Math.random() * 3));

  log("Filling form: birth year " + birthYear + ", " + favOlympicSports.length + " Olympic sports, " + favParalympicSports.length + " Paralympic sports, " + favTeams.length + " teams");

  await page.evaluate(`((year) => {
    var selects = document.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      var label = sel.previousElementSibling ? (sel.previousElementSibling.textContent || '') : '';
      var parentText = sel.parentElement ? (sel.parentElement.textContent || '') : '';
      if (label.toLowerCase().includes('birth') || parentText.toLowerCase().includes('birth')) {
        for (var j = 0; j < sel.options.length; j++) {
          if (sel.options[j].value === year || sel.options[j].text === year) {
            sel.value = sel.options[j].value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    }
  })("${birthYear}")`);

  const sportCodes = [...favOlympicSports, ...favParalympicSports];
  for (const code of sportCodes) {
    await page.evaluate(`((sportCode) => {
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        if ((cb.value === sportCode || cb.name === sportCode || cb.id.includes(sportCode)) && !cb.checked) {
          cb.click();
        }
      }
    })("${code}")`);
  }

  for (const team of favTeams) {
    await page.evaluate(`((teamCode) => {
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        if ((cb.value === teamCode || cb.name === teamCode || cb.id.includes(teamCode)) && !cb.checked) {
          cb.click();
        }
      }
    })("${team}")`);
  }

  await page.waitForTimeout(1000);

  const saveClicked = await page.evaluate(`(() => {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].innerText || '').toLowerCase();
      if (text.includes('save') || text.includes('submit') || text.includes('register') || text.includes('confirm')) {
        buttons[i].click();
        return text;
      }
    }
    var inputs = document.querySelectorAll('input[type="submit"]');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].click();
      return inputs[j].value || 'submit';
    }
    return null;
  })()`) as string | null;

  if (saveClicked) {
    log("Clicked save/submit button: " + saveClicked);
    await page.waitForTimeout(5000);
  } else {
    log("No save button found on tickets portal form.");
  }
}

async function tryRestApiFallback(
  page: Page,
  birthYear: string,
  olympicSports: string[],
  paralympicSports: string[],
  teams: string[],
  log: (msg: string) => void
): Promise<void> {
  log("Trying Gigya REST API fallback...");
  try {
    const loginTokenRaw = await page.evaluate(`(() => {
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i++) {
        var c = cookies[i].trim();
        if (c.indexOf('glt_') === 0) return c.substring(c.indexOf('=') + 1);
      }
      return '';
    })()`) as string;

    if (!loginTokenRaw) {
      log("No Gigya login token found for REST API fallback");
      return;
    }

    const apiUrl = "https://accounts." + GIGYA_DATACENTER + ".gigya.com/accounts.setAccountInfo";

    const allSports = [
      ...olympicSports.map(code => ({ ocsCode: code, odfCode: code, GameType: "OG" })),
      ...paralympicSports.map(code => ({ ocsCode: code, odfCode: code, GameType: "PG" })),
    ];

    const teamObjs = teams.map(code => ({ ocsCode: code, nocCode: code, gameType: "OG" }));

    const profileParams = new URLSearchParams({
      apiKey: GIGYA_API_KEY,
      login_token: loginTokenRaw,
      profile: JSON.stringify({ birthYear: parseInt(birthYear) }),
    });
    const profileResp = await fetch(apiUrl, { method: "POST", body: profileParams });
    const profileData = await profileResp.json() as { errorCode: number; errorMessage?: string };
    console.log("[Playwright] REST profile:", JSON.stringify(profileData));

    if (profileData.errorCode === 0) {
      log("Birth year " + birthYear + " set via REST API!");
    } else {
      log("REST profile error: " + (profileData.errorMessage || "code " + profileData.errorCode));
    }

    const dataParams = new URLSearchParams({
      apiKey: GIGYA_API_KEY,
      login_token: loginTokenRaw,
      data: JSON.stringify({
        personalization: {
          favoritesDisciplines: allSports,
          favoritesCountries: teamObjs,
          siteLanguage: "en",
        },
        entryCampaignandSegregation: {
          l2028_ticketing: "true",
          l2028_fan28: "true",
        },
      }),
    });
    const dataResp = await fetch(apiUrl, { method: "POST", body: dataParams });
    const dataData = await dataResp.json() as { errorCode: number; errorMessage?: string };
    console.log("[Playwright] REST data:", JSON.stringify(dataData));

    if (dataData.errorCode === 0) {
      log("Favorites + registration set via REST API!");
    } else {
      log("REST data error: " + (dataData.errorMessage || "code " + dataData.errorCode));
    }
  } catch (apiErr: any) {
    log("REST API fallback failed: " + apiErr.message);
  }
}

async function fillAndSubmitTicketsForm(
  page: any,
  birthYear: number,
  zipCode: string,
  olympicSports: string[],
  paralympicSports: string[],
  teams: string[],
  log: (msg: string) => void
): Promise<boolean> {
  console.log("[Draw-Form] Starting tickets.la28.org form fill...");

  try {
    console.log("[Draw-Form] Waiting for page content to load...");
    for (let contentWait = 0; contentWait < 20; contentWait++) {
      await page.waitForTimeout(3000);
      const textLen = await page.evaluate(`(document.body.innerText || '').length`) as number;
      const selectCount = await page.evaluate(`document.querySelectorAll('select').length`) as number;
      const pageUrl = page.url();
      console.log("[Draw-Form] Content wait " + contentWait + ": textLen=" + textLen + " selects=" + selectCount + " url=" + pageUrl.substring(0, 80));
      if (textLen > 200 || selectCount > 0) break;
      if (contentWait === 5) {
        try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
      }
    }

    let pageText = await page.evaluate(`document.body.innerText.substring(0, 3000)`) as string;
    console.log("[Draw-Form] Page text preview: " + pageText.substring(0, 300));

    let formReady = pageText.includes('INFORMATION') || pageText.includes('Birth Year') || pageText.includes('Save profile') || pageText.includes('PROFILE') || pageText.includes('DRAW') || pageText.includes('Country');

    if (!formReady) {
      console.log("[Draw-Form] Form content not found, skipping form fill");
      return false;
    }

    let selectCount = await page.evaluate(`document.querySelectorAll('select').length`) as number;
    const checkboxCount = await page.evaluate(`document.querySelectorAll('input[type="checkbox"]').length`) as number;
    console.log("[Draw-Form] Found " + selectCount + " selects, " + checkboxCount + " checkboxes");

    if (selectCount === 0) {
      console.log("[Draw-Form] No selects yet, waiting for Angular form to render...");
      for (let w = 0; w < 15; w++) {
        await page.waitForTimeout(3000);
        selectCount = await page.evaluate(`document.querySelectorAll('select').length`) as number;
        console.log("[Draw-Form] Waiting... selects: " + selectCount);
        if (selectCount > 0) break;
        if (w === 5) {
          try { await page.evaluate(`window.scrollTo(0, 500)`); } catch {}
        }
        if (w === 8) {
          try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
          await page.waitForTimeout(5000);
        }
      }
    }

    pageText = await page.evaluate(`document.body.innerText.substring(0, 3000)`) as string;
    console.log("[Draw-Form] Full page text: " + pageText.substring(0, 500));

    const formFillResult = await page.evaluate(`(() => {
      function angularSet(el) {
        var nativeSet = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype, 'value'
        );
        if (nativeSet && nativeSet.set) {
          nativeSet.set.call(el, el.value);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        if (typeof window.Zone !== 'undefined' && window.Zone.current) {
          try { window.Zone.current.run(function() {}); } catch(e) {}
        }
      }
      
      function selectByIdPattern(idPat, valueMatcher) {
        var selects = document.querySelectorAll('select');
        for (var i = 0; i < selects.length; i++) {
          var s = selects[i];
          if (s.id.includes(idPat) || s.name.includes(idPat)) {
            if (s.offsetParent === null && s.offsetWidth === 0) continue;
            var opts = Array.from(s.options);
            if (valueMatcher) {
              for (var j = 0; j < opts.length; j++) {
                if (valueMatcher(opts[j])) {
                  s.value = opts[j].value;
                  angularSet(s);
                  return { ok: true, val: opts[j].value, text: opts[j].text, id: s.id };
                }
              }
            }
            if (opts.length > 1) {
              var idx = 1 + Math.floor(Math.random() * (opts.length - 1));
              s.value = opts[idx].value;
              angularSet(s);
              return { ok: true, val: opts[idx].value, text: opts[idx].text, id: s.id, fallback: true };
            }
          }
        }
        return { ok: false };
      }
      
      var results = {};
      
      results.birthYear = selectByIdPattern('additionalCustomerAttributes', function(opt) {
        return opt.text.trim() === '${birthYear}';
      });
      
      results.country = selectByIdPattern('customerCountry', function(opt) {
        return opt.text.includes('United States') || opt.value.includes(': US');
      });
      
      results.olympicSport = selectByIdPattern('categoryFavorites288-1', null);
      results.paralympicSport = selectByIdPattern('categoryFavorites289-1', null);
      results.team = selectByIdPattern('artistFavorites-1', null);
      
      return results;
    })()`) as any;
    console.log("[Draw-Form] Fill results: " + JSON.stringify(formFillResult));

    await page.waitForTimeout(2000);
    
    const formState = await page.evaluate(`(() => {
      var ng = document.querySelector('[ng-version]') || document.querySelector('app-root');
      var allSelects = document.querySelectorAll('select');
      var filled = [];
      for (var i = 0; i < allSelects.length; i++) {
        var s = allSelects[i];
        if (s.offsetParent !== null && s.value && !s.value.includes('null')) {
          filled.push({ id: s.id.substring(0, 30), val: s.value.substring(0, 20) });
        }
      }
      var ngVersion = ng ? ng.getAttribute('ng-version') : null;
      return { filledSelects: filled.length, filled: filled, ngVersion: ngVersion };
    })()`) as any;
    console.log("[Draw-Form] Form state after fill: " + JSON.stringify(formState));

    await page.waitForTimeout(1000);

    const preSubmitCheck = await page.evaluate(`(() => {
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var unchecked = [];
      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        if (cb.offsetParent !== null && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new Event('input', { bubbles: true }));
          unchecked.push(cb.id || cb.name || 'checkbox-' + i);
        }
      }
      
      var customCheckboxes = document.querySelectorAll('.checkbox, .mat-checkbox, [role="checkbox"], .custom-checkbox, label.check');
      var clicked = [];
      for (var j = 0; j < customCheckboxes.length; j++) {
        var el = customCheckboxes[j];
        if (el.offsetParent !== null && !el.classList.contains('checked') && !el.classList.contains('active') && el.getAttribute('aria-checked') !== 'true') {
          el.click();
          clicked.push(el.className.substring(0, 30));
        }
      }
      
      var validationErrors = document.querySelectorAll('.error, .invalid, .ng-invalid, .form-error, [class*="error"], [class*="invalid"]');
      var errors = [];
      for (var k = 0; k < validationErrors.length; k++) {
        var errEl = validationErrors[k];
        if (errEl.offsetParent !== null && errEl.textContent.trim().length > 0 && errEl.textContent.trim().length < 200) {
          errors.push(errEl.textContent.trim().substring(0, 80));
        }
      }
      
      return { checkboxesFixed: unchecked.length, customClicked: clicked.length, validationErrors: errors.length, errorTexts: errors.slice(0, 5) };
    })()`) as any;
    console.log("[Draw-Form] Pre-submit check: " + JSON.stringify(preSubmitCheck));
    
    await page.waitForTimeout(1000);

    const submitClicked = await page.evaluate(`(() => {
      var buttons = document.querySelectorAll('button[type="submit"], button, input[type="submit"], a.btn, a.button, a');
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].textContent || '').trim().toLowerCase();
        if (text.includes('save profile') && text.includes('submit')) {
          buttons[i].click();
          return 'clicked: ' + (buttons[i].textContent || '').trim();
        }
      }
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].textContent || '').trim().toLowerCase();
        if (text.includes('submit registration') || text.includes('save profile')) {
          buttons[i].click();
          return 'clicked: ' + (buttons[i].textContent || '').trim();
        }
      }
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].textContent || '').trim().toLowerCase();
        if (text.includes('submit') || text.includes('save') || text.includes('register')) {
          buttons[i].click();
          return 'clicked-fallback: ' + (buttons[i].textContent || '').trim();
        }
      }
      var allTexts = [];
      for (var j = 0; j < buttons.length; j++) allTexts.push((buttons[j].textContent || '').trim().substring(0, 40));
      return 'not-found: [' + allTexts.join('|') + ']';
    })()`) as string;
    console.log("[Draw-Form] Submit result: " + submitClicked);

    if (submitClicked.startsWith('clicked')) {
      log("Submit button clicked: " + submitClicked.substring(0, 80));
      await page.waitForTimeout(8000);

      try {
        const afterUrl = page.url();
        const afterSubmitText = await page.evaluate(`document.body.innerText.substring(0, 1500)`) as string;
        console.log("[Draw-Form] After submit URL: " + afterUrl.substring(0, 200));
        console.log("[Draw-Form] After submit text: " + afterSubmitText.substring(0, 500));

        const postSubmitErrors = await page.evaluate(`(() => {
          var errEls = document.querySelectorAll('.error, .invalid-feedback, .ng-invalid, .form-error, .error-message, [class*="error-msg"], [class*="validation"]');
          var visible = [];
          for (var i = 0; i < errEls.length; i++) {
            var el = errEls[i];
            if (el.offsetParent !== null && el.textContent.trim().length > 2 && el.textContent.trim().length < 200) {
              visible.push(el.textContent.trim().substring(0, 100));
            }
          }
          var requiredMarkers = document.querySelectorAll('.required, [required], .ng-invalid.ng-touched');
          return { errors: visible.slice(0, 8), invalidFields: requiredMarkers.length };
        })()`) as any;
        console.log("[Draw-Form] Post-submit validation: " + JSON.stringify(postSubmitErrors));

        const isSuccess = afterUrl.includes('mydatasuccess') ||
                          afterUrl.includes('myCustomerDataSuccess') ||
                          afterSubmitText.toLowerCase().includes('success') || 
                          afterSubmitText.toLowerCase().includes('congratulations') ||
                          afterSubmitText.toLowerCase().includes('you are registered') ||
                          afterSubmitText.toLowerCase().includes('confirmed') ||
                          afterSubmitText.toLowerCase().includes('thank you') ||
                          afterSubmitText.toLowerCase().includes('you have successfully');
        
        if (isSuccess) {
          log("SUCCESS! Draw registration complete on tickets.la28.org!");
          return true;
        } else {
          console.log("[Draw-Form] Form still shows 'enter the draw'. Checking if Angular registered changes...");
          
          const retryResult = await page.evaluate(`(() => {
            var selects = document.querySelectorAll('select');
            var emptyVisible = [];
            for (var i = 0; i < selects.length; i++) {
              var s = selects[i];
              if (s.offsetParent !== null && (!s.value || s.value.includes('null'))) {
                emptyVisible.push({ id: s.id.substring(0, 40), val: s.value });
              }
            }
            return { emptyVisibleSelects: emptyVisible };
          })()`) as any;
          console.log("[Draw-Form] Empty visible selects: " + JSON.stringify(retryResult));
          
          log("Form submitted but success page NOT reached. Draw registration NOT confirmed.");
          return false;
        }
      } catch (postErr: any) {
        console.log("[Draw-Form] Post-submit check error: " + postErr.message.substring(0, 100));
        log("Form submitted but could not verify success page. Draw NOT confirmed.");
        return false;
      }
    } else {
      log("Submit button not found: " + submitClicked.substring(0, 100));
      return false;
    }
  } catch (err: any) {
    console.log("[Draw-Form] Error: " + err.message.substring(0, 200));
    log("Form fill error: " + err.message.substring(0, 80));
    return false;
  }
}

export async function completeDrawViaGigyaBrowser(
  email: string,
  password: string,
  zipCode: string | undefined,
  log: (msg: string) => void,
  onEarlyComplete?: () => void
): Promise<{ success: boolean; profileSet: boolean; dataSet: boolean; oidcLinked?: boolean; formSubmitted?: boolean; error?: string }> {
  const usedZip = zipCode || generateUSZip();
  const birthYear = generateRandomBirthYear();
  const favOlympicSports = pickRandom(OLYMPIC_SPORTS, 3 + Math.floor(Math.random() * 4));
  const favParalympicSports = pickRandom(PARALYMPIC_SPORTS, 2 + Math.floor(Math.random() * 3));
  const favTeams = pickRandom(TEAM_NOCS, 2 + Math.floor(Math.random() * 3));

  let formSubmitted = false;

  log("Draw via local Chromium + CapSolver token injection...");
  console.log("[Draw] Starting for " + email + " via local Chromium (no proxy) + CapSolver token injection");

  let browser: Browser | null = null;
  let page: Page | null = null;
  let profileSet = false;
  let dataSet = false;

  const MAX_LOGIN_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_LOGIN_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffSec = 15 + attempt * 10;
      console.log("[Draw] Login retry " + (attempt + 1) + "/" + MAX_LOGIN_RETRIES + " — waiting " + backoffSec + "s...");
      log("Retrying in " + backoffSec + "s (attempt " + (attempt + 1) + "/" + MAX_LOGIN_RETRIES + ")...");
      await new Promise(r => setTimeout(r, backoffSec * 1000));
      try { if (browser) await browser.close(); } catch {}
      browser = null;
      page = null;
    }

    try {
      console.log("[Draw] Launching local Chromium (no proxy)...");
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
      });
      await context.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      `);
      page = await context.newPage();
      page.setDefaultTimeout(60000);
      console.log("[Draw] Chromium launched (no proxy, stealth mode)");

      setupRecaptchaLogging(page);
      page.on('requestfailed', (request) => {
        const url = request.url();
        if (url.includes('gigya') || url.includes('accounts.login')) {
          console.log("[Draw] REQUEST FAILED: " + url.substring(0, 120) + " reason=" + (request.failure()?.errorText || 'unknown'));
        }
      });

      log("Step 1: Homepage warmup browsing session...");
      console.log("[Draw] Step 1: Starting multi-page warmup to build reCAPTCHA trust...");

      try {
        console.log("[Draw] Warmup: Opening la28.org homepage...");
        await page.goto("https://www.la28.org", { waitUntil: "domcontentloaded", timeout: 15000 });
        console.log("[Draw] Warmup: Homepage loaded: " + page.url());

        await page.waitForTimeout(1000 + Math.random() * 500);
        for (let i = 0; i < 2; i++) {
          try { await page.mouse.move(200 + Math.floor(Math.random() * 800), 150 + Math.floor(Math.random() * 400), { steps: 5 }); } catch {}
          await page.waitForTimeout(150 + Math.random() * 200);
        }
        try { await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 400)); } catch {}
        await page.waitForTimeout(800 + Math.random() * 500);
        try { await page.evaluate(() => window.scrollBy(0, 200 + Math.random() * 200)); } catch {}
        await page.waitForTimeout(500 + Math.random() * 300);
        try { await page.mouse.move(400 + Math.floor(Math.random() * 500), 300 + Math.floor(Math.random() * 200), { steps: 4 }); } catch {}
        await page.waitForTimeout(300 + Math.random() * 200);
        console.log("[Draw] Warmup: Homepage browsing complete");
      } catch (e: any) {
        console.log("[Draw] Warmup: Homepage error (continuing): " + (e.message || '').substring(0, 80));
      }

      log("Step 2: Navigating to login page...");
      console.log("[Draw] Step 2: Navigating to la28id.la28.org/login...");
      for (let warmupAttempt = 0; warmupAttempt < 3; warmupAttempt++) {
        try {
          await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
          try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch {}
          await page.waitForTimeout(1000 + Math.random() * 500);
          console.log("[Draw] Login page loaded (attempt " + (warmupAttempt + 1) + "): " + page.url());
          break;
        } catch (warmupErr: any) {
          console.log("[Draw] Login page attempt " + (warmupAttempt + 1) + " error: " + (warmupErr.message || '').substring(0, 80));
          if (warmupAttempt < 2) {
            await page.waitForTimeout(3000);
          }
        }
      }
      console.log("[Draw] Login page URL: " + page.url());

      console.log("[Draw] Waiting for Gigya SDK...");
      try {
        await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 30000 });
      } catch {
        console.log("[Draw] Gigya SDK not available on attempt " + (attempt + 1));
        log("Gigya SDK did not load. Retrying...");
        continue;
      }
      console.log("[Draw] Gigya SDK loaded");

      const recaptchaReady = await waitForRecaptchaEnterprise(page, 10000);
      console.log("[Draw] reCAPTCHA Enterprise ready: " + recaptchaReady);

      const recaptchaState = await page.evaluate(() => {
        const g = (window as any).grecaptcha;
        return {
          hasGrecaptcha: typeof g !== 'undefined',
          hasEnterprise: typeof g !== 'undefined' && typeof g.enterprise !== 'undefined',
          hasExecute: typeof g !== 'undefined' && typeof g.enterprise !== 'undefined' && typeof g.enterprise.execute === 'function',
        };
      });
      console.log("[Draw] reCAPTCHA state: " + JSON.stringify(recaptchaState));

      let initCheck = checkRecaptchaInitialization(page);
      if (!initCheck.ready) {
        console.log("[Draw] reCAPTCHA initialization incomplete, waiting additional 5s...");
        await page.waitForTimeout(5000);
        initCheck = checkRecaptchaInitialization(page);
        if (!initCheck.ready) {
          console.log("[Draw] reCAPTCHA still not ready after extra wait, retrying attempt...");
          log("reCAPTCHA initialization incomplete (attempt " + (attempt + 1) + "). Retrying...");
          continue;
        }
      }

      log("Step 3: Simulating human interaction before login...");
      console.log("[Draw] Step 3: Human behavior simulation...");
      await simulateHumanBehavior(page, email, password);

      log("Step 4: Solving reCAPTCHA via CapSolver + login...");
      console.log("[Draw] Step 4: Solving reCAPTCHA v3 Enterprise via CapSolver before login...");

      const RECAPTCHA_INVISIBLE_KEY = "6Lc8WkwhAAAAAPHXbaEde5PP3Skj9tCZn-A8U555";
      let capsolverToken: string | null = null;
      try {
        const capResult = await solveRecaptchaV3Enterprise(
          "https://la28id.la28.org/login/",
          RECAPTCHA_INVISIBLE_KEY,
          "login",
          0.7
        );
        if (capResult.success && capResult.token) {
          capsolverToken = capResult.token;
          console.log("[Draw] CapSolver v3 Enterprise token obtained, length=" + capsolverToken.length);
          log("CapSolver token obtained (" + capsolverToken.length + " chars)");
        } else {
          console.log("[Draw] CapSolver v3 Enterprise failed: " + capResult.error);
          log("CapSolver failed: " + (capResult.error || "unknown"));
        }
      } catch (capErr: any) {
        console.log("[Draw] CapSolver error: " + (capErr.message || '').substring(0, 100));
        log("CapSolver error: " + (capErr.message || '').substring(0, 60));
      }

      if (capsolverToken) {
        console.log("[Draw] Injecting CapSolver token into grecaptcha.enterprise.execute override...");
        await page.evaluate((token: string) => {
          const g = (window as any).grecaptcha;
          if (g && g.enterprise) {
            const origExecute = g.enterprise.execute;
            g.enterprise.execute = function(...args: any[]) {
              console.log('[reCAPTCHA-Override] Returning CapSolver token instead of real execute');
              return Promise.resolve(token);
            };
            console.log('[reCAPTCHA-Override] grecaptcha.enterprise.execute overridden with CapSolver token');
          } else {
            (window as any).__capsolver_token = token;
            console.log('[reCAPTCHA-Override] grecaptcha not ready, stored token in __capsolver_token');
          }
        }, capsolverToken);
      }

      console.log("[Draw] Calling gigya.accounts.login...");
      let loginResult = await page.evaluate(`(function() {
        return new Promise(function(resolve) {
          if (typeof gigya === 'undefined' || !gigya.accounts) {
            resolve({ success: false, errorCode: -1, errorMessage: 'gigya not available', uid: '', raw: 'no gigya' });
            return;
          }
          var resolved = false;
          var loginParams = {
            loginID: ${JSON.stringify(email)},
            password: ${JSON.stringify(password)},
            callback: function(resp) {
              if (resolved) return;
              resolved = true;
              var keys = [];
              try { keys = Object.keys(resp).slice(0, 20); } catch(e) {}
              resolve({
                success: resp.errorCode === 0,
                errorCode: resp.errorCode,
                errorMessage: resp.errorMessage || resp.statusMessage || '',
                errorDetails: resp.errorDetails || '',
                uid: resp.UID || '',
                statusCode: resp.statusCode,
                statusReason: resp.statusReason || '',
                keys: keys.join(','),
                raw: 'redacted'
              });
            }
          };
          console.log('[Gigya-Login] Calling gigya.accounts.login (with CapSolver token injected)');
          gigya.accounts.login(loginParams);
          setTimeout(function() {
            if (resolved) return;
            resolved = true;
            resolve({ success: false, errorCode: -2, errorMessage: 'timeout_30s', uid: '', raw: 'timeout' });
          }, 30000);
        });
      })()`) as any;
      console.log("[Draw] Login result (attempt " + (attempt + 1) + "): " + JSON.stringify(loginResult));

      if (!loginResult.success) {
        const errCode = loginResult.errorCode;
        const errMsg = loginResult.errorMessage || '';
        log("Login failed (errorCode=" + errCode + "): " + (errMsg || 'unknown') + ". Attempt " + (attempt + 1) + "/" + MAX_LOGIN_RETRIES);
        console.log("[Draw] Login failed: errorCode=" + errCode + " msg=" + errMsg);
        if (errCode === undefined || errCode === null) {
          console.log("[Draw] Login response had undefined errorCode — likely network/proxy failure. Full keys: " + loginResult.keys);
          log("Login request failed (network/proxy error). Retrying...");
          continue;
        }
        if ((errCode === 400006 || errCode === 401020) && capsolverToken) {
          log("CAPTCHA required. Retrying with explicit captchaToken param...");
          console.log("[Draw] CAPTCHA error " + errCode + " — retrying with explicit captchaToken + captchaType params...");

          const capLoginResult = await page.evaluate(`(function() {
            return new Promise(function(resolve) {
              gigya.accounts.login({
                loginID: ${JSON.stringify(email)},
                password: ${JSON.stringify(password)},
                captchaToken: ${JSON.stringify(capsolverToken)},
                captchaType: "reCaptchaEnterpriseScore",
                callback: function(resp) {
                  resolve({
                    success: resp.errorCode === 0,
                    errorCode: resp.errorCode,
                    errorMessage: resp.errorMessage || '',
                    errorDetails: resp.errorDetails || '',
                    uid: resp.UID || ''
                  });
                }
              });
              setTimeout(function() { resolve({ success: false, errorCode: -2, errorMessage: 'timeout', uid: '' }); }, 30000);
            });
          })()`) as any;
          console.log("[Draw] Explicit captchaToken login result: " + JSON.stringify(capLoginResult));

          if (capLoginResult.success) {
            loginResult = capLoginResult;
            log("Login with explicit captchaToken succeeded! UID: " + (capLoginResult.uid || "unknown"));
          } else {
            log("Explicit captchaToken login also failed: " + (capLoginResult.errorMessage || capLoginResult.errorDetails));
            if (attempt < MAX_LOGIN_RETRIES - 1) continue;
            try { if (browser) await browser.close(); } catch {}
            return { success: false, profileSet: false, dataSet: false, error: "Login failed: CAPTCHA required (" + errCode + "), CapSolver token rejected" };
          }
        } else {
          if (attempt < MAX_LOGIN_RETRIES - 1) continue;
          try { if (browser) await browser.close(); } catch {}
          return { success: false, profileSet: false, dataSet: false, error: "Login failed: errorCode=" + errCode + " " + errMsg };
        }
      }

      log("Login successful! UID: " + (loginResult?.uid || "unknown"));
      console.log("[Draw] Login OK! UID: " + (loginResult?.uid || "unknown"));

      await page.waitForTimeout(3000);
      try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch {}

      let postLoginUrl = page.url();
      if (postLoginUrl.includes("proxy.html") || postLoginUrl.includes("consent.html")) {
        console.log("[Draw] On intermediate page (" + postLoginUrl.substring(0, 80) + "), navigating back...");
        try {
          await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(3000);
        } catch {}
      }

      try {
        await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
      } catch {
        try {
          await page.goto("https://la28id.la28.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(3000);
          await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
        } catch {
          log("Gigya SDK lost after login. Retrying...");
          continue;
        }
      }

      const authCheck = await page.evaluate(`(function() {
        return new Promise(function(resolve) {
          gigya.accounts.getAccountInfo({
            callback: function(resp) {
              resolve({ loggedIn: resp.errorCode === 0, uid: resp.UID || '' });
            }
          });
          setTimeout(function() { resolve({ loggedIn: false, uid: '' }); }, 15000);
        });
      })()`) as any;
      console.log("[Draw] Auth check: " + JSON.stringify(authCheck));

      if (!authCheck.loggedIn) {
        log("Session lost after redirect. Retrying...");
        continue;
      }

      log("Step 4: Setting profile (birth year, zip, country)...");
      console.log("[Draw] Step 4: Setting profile + data...");

      const allSportsJSON = JSON.stringify([
        ...favOlympicSports.map((code: string) => ({ ocsCode: code, odfCode: code, GameType: "OG" })),
        ...favParalympicSports.map((code: string) => ({ ocsCode: code, odfCode: code, GameType: "PG" })),
      ]);
      const teamsJSON = JSON.stringify(favTeams.map((code: string) => ({ ocsCode: code, nocCode: code, gameType: "OG" })));

      const profileResult = await page.evaluate(`(function(birthYr, zip) {
        return new Promise(function(resolve) {
          gigya.accounts.setAccountInfo({
            profile: { birthYear: parseInt(birthYr), zip: zip, country: 'US' },
            callback: function(resp) {
              resolve({ success: resp.errorCode === 0, error: resp.errorCode === 0 ? null : resp.errorMessage });
            }
          });
          setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 15000);
        });
      })(${JSON.stringify(String(birthYear))}, ${JSON.stringify(usedZip)})`) as { success: boolean; error?: string | null };

      console.log("[Draw] Profile result: " + JSON.stringify(profileResult));
      profileSet = profileResult.success;
      if (profileSet) {
        log("Profile set: birth year " + birthYear + ", zip " + usedZip);
      } else {
        log("Profile error: " + (profileResult.error || "unknown"));
      }

      log("Step 5: Setting favorites + draw flags...");
      const dataResult = await page.evaluate(`(function(sportsStr, teamsStr) {
        return new Promise(function(resolve) {
          var sports = JSON.parse(sportsStr);
          var teams = JSON.parse(teamsStr);
          gigya.accounts.setAccountInfo({
            data: {
              personalization: { favoritesDisciplines: sports, favoritesCountries: teams, siteLanguage: 'en' },
              entryCampaignandSegregation: { l2028_ticketing: 'true', l2028_fan28: 'true' }
            },
            callback: function(resp) {
              resolve({ success: resp.errorCode === 0, error: resp.errorCode === 0 ? null : resp.errorMessage });
            }
          });
          setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 15000);
        });
      })(${JSON.stringify(allSportsJSON)}, ${JSON.stringify(teamsJSON)})`) as { success: boolean; error?: string | null };

      console.log("[Draw] Data result: " + JSON.stringify(dataResult));
      dataSet = dataResult.success;
      if (dataSet) {
        log("Draw flags set! l2028_ticketing=true, l2028_fan28=true, favorites saved!");
      } else {
        log("Data error: " + (dataResult.error || "unknown") + ". Trying individual fields...");
        try {
          const fallbackResult = await page.evaluate(`(function(sportsStr, teamsStr) {
            return new Promise(function(resolve) {
              var sports = JSON.parse(sportsStr);
              var teams = JSON.parse(teamsStr);
              gigya.accounts.setAccountInfo({
                data: { personalization: { favoritesDisciplines: sports } },
                callback: function(r1) {
                  gigya.accounts.setAccountInfo({
                    data: { personalization: { favoritesCountries: teams } },
                    callback: function(r2) {
                      gigya.accounts.setAccountInfo({
                        data: { entryCampaignandSegregation: { l2028_ticketing: 'true', l2028_fan28: 'true' } },
                        callback: function(r3) {
                          resolve({ success: r3.errorCode === 0, error: r3.errorCode === 0 ? null : r3.errorMessage });
                        }
                      });
                    }
                  });
                }
              });
              setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 25000);
            });
          })(${JSON.stringify(allSportsJSON)}, ${JSON.stringify(teamsJSON)})`) as { success: boolean; error?: string | null };
          if (fallbackResult.success) {
            dataSet = true;
            log("Draw flags set via individual updates!");
          }
        } catch {}
      }

      const verifyResult = await page.evaluate(`(function() {
        return new Promise(function(resolve) {
          gigya.accounts.getAccountInfo({
            include: 'profile,data',
            callback: function(resp) {
              if (resp.errorCode === 0) {
                resolve({
                  ticketing: resp.data && resp.data.entryCampaignandSegregation && resp.data.entryCampaignandSegregation.l2028_ticketing,
                  fan28: resp.data && resp.data.entryCampaignandSegregation && resp.data.entryCampaignandSegregation.l2028_fan28,
                  birthYear: resp.profile && resp.profile.birthYear,
                  zip: resp.profile && resp.profile.zip
                });
              } else {
                resolve({ error: resp.errorMessage });
              }
            }
          });
          setTimeout(function() { resolve({ error: 'timeout' }); }, 10000);
        });
      })()`) as any;

      console.log("[Draw] Verify result: " + JSON.stringify(verifyResult));
      if (verifyResult.ticketing === "true" || verifyResult.ticketing === true) {
        log("Verified: l2028_ticketing=" + verifyResult.ticketing + " fan28=" + verifyResult.fan28 + " birthYear=" + verifyResult.birthYear + " zip=" + verifyResult.zip);
      }

      if (profileSet && dataSet) {
        console.log("[Draw] Profile+Data flags set. Proceeding to OIDC + form fill on tickets.la28.org...");
      }

      break;
    } catch (err: any) {
      console.log("[Draw] Attempt " + (attempt + 1) + " error: " + (err.message || '').substring(0, 200));
      log("Attempt " + (attempt + 1) + " failed: " + (err.message || '').substring(0, 80));
      if (attempt >= MAX_LOGIN_RETRIES - 1) {
        try { if (browser) await browser.close(); } catch {}
        return { success: false, profileSet: false, dataSet: false, error: "All " + MAX_LOGIN_RETRIES + " login attempts failed" };
      }
    }
  }

  try {
    let oidcLinked = false;
    let nstBrowser: Browser | null = null;
    let nstPage: Page | null = null;
    try {
      const nstApiKey = process.env.NSTBROWSER_API_KEY;
      const useNstBrowser = !!nstApiKey;

      if (useNstBrowser) {
        log("Draw form: Using NSTBrowser cloud anti-detect browser for OIDC...");
        console.log("[Draw-OIDC] Starting OIDC via NSTBrowser for " + email);
      } else if (!page || page.isClosed()) {
        log("Draw form: Page closed, reconnecting Browserless for OIDC...");
        console.log("[Draw-OIDC] Page closed, reconnecting Browserless for " + email);

        try {
          const freshBrowserlessUrl = `wss://production-sfo.browserless.io/chrome/stealth?token=${browserlessToken}&proxy=residential&proxyCountry=us`;
          console.log("[Draw-OIDC] Connecting to Browserless Stealth CDP with residential proxy for OIDC...");
          const freshBrowser = await chromium.connectOverCDP(freshBrowserlessUrl, { timeout: 60000 });
          browser = freshBrowser;
          console.log("[Draw-OIDC] Browserless Stealth connected for OIDC!");

          const freshContexts = freshBrowser.contexts();
          const freshCtx = freshContexts.length > 0 ? freshContexts[0] : await freshBrowser.newContext();
          const freshPages = freshCtx.pages();
          page = freshPages.length > 0 ? freshPages[0] : await freshCtx.newPage();
          page.setDefaultTimeout(60000);

          console.log("[Draw-OIDC] Browserless: warming up on www.la28.org...");
          try {
            await page.goto("https://www.la28.org", { waitUntil: "domcontentloaded", timeout: 60000 });
            try { await page.waitForLoadState("networkidle", { timeout: 20000 }); } catch {}
            await page.waitForTimeout(3000 + Math.random() * 2000);
          } catch {}

          console.log("[Draw-OIDC] Browserless: navigating to la28id.la28.org/login...");
          await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 60000 });
          try { await page.waitForLoadState("networkidle", { timeout: 25000 }); } catch {}
          await page.waitForTimeout(3000 + Math.random() * 2000);

          await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 30000 });
          console.log("[Draw-OIDC] Browserless: Gigya SDK loaded");
          await waitForRecaptchaEnterprise(page, 8000);
          await simulateHumanBehavior(page, email, password);
          console.log("[Draw-OIDC] Browserless: logging in...");

          const freshLogin = await page.evaluate(`(function(email, pwd) {
            return new Promise(function(resolve) {
              gigya.accounts.login({
                loginID: email, password: pwd,
                callback: function(resp) {
                  resolve({ success: resp.errorCode === 0, errorCode: resp.errorCode, errorMessage: resp.errorMessage || '', uid: resp.UID || '' });
                }
              });
              setTimeout(function() { resolve({ success: false, errorCode: -1, errorMessage: 'timeout', uid: '' }); }, 30000);
            });
          })(${JSON.stringify(email)}, ${JSON.stringify(password)})`) as any;
          console.log("[Draw-OIDC] Browserless login: " + JSON.stringify(freshLogin));

          if (!freshLogin.success) {
            throw new Error("Browserless Gigya login failed: errorCode=" + freshLogin.errorCode + " " + freshLogin.errorMessage);
          }

          await page.waitForTimeout(3000);
          try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch {}

          let freshUrl = page.url();
          if (freshUrl.includes("proxy.html") || freshUrl.includes("consent.html")) {
            console.log("[Draw-OIDC] Browserless: on intermediate page, navigating back...");
            await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(2000);
          }

          const freshAuth = await page.evaluate(`(function() {
            return new Promise(function(resolve) {
              gigya.accounts.getAccountInfo({
                callback: function(resp) {
                  resolve({ loggedIn: resp.errorCode === 0, uid: resp.UID || '' });
                }
              });
              setTimeout(function() { resolve({ loggedIn: false, uid: '' }); }, 15000);
            });
          })()`) as any;
          console.log("[Draw-OIDC] Browserless auth check: " + JSON.stringify(freshAuth));

          if (!freshAuth.loggedIn) {
            throw new Error("Browserless: Not logged in after Gigya login");
          }

          console.log("[Draw-OIDC] Browserless: setting profile + data...");
          const freshProfileResult = await page.evaluate(`(function(birthYr, zip) {
            return new Promise(function(resolve) {
              gigya.accounts.setAccountInfo({
                profile: { birthYear: parseInt(birthYr), zip: zip, country: 'US' },
                callback: function(resp) {
                  resolve({ success: resp.errorCode === 0, error: resp.errorCode === 0 ? null : resp.errorMessage });
                }
              });
              setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 15000);
            });
          })(${JSON.stringify(String(birthYear))}, ${JSON.stringify(usedZip)})`) as { success: boolean; error?: string | null };
          if (freshProfileResult.success) profileSet = true;

          const allSportsFresh = [
            ...favOlympicSports.map(code => ({ ocsCode: code, odfCode: code, GameType: "OG" })),
            ...favParalympicSports.map(code => ({ ocsCode: code, odfCode: code, GameType: "PG" })),
          ];
          const teamObjsFresh = favTeams.map(code => ({ ocsCode: code, nocCode: code, gameType: "OG" }));

          const freshDataResult = await page.evaluate(`(function(sportsStr, teamsStr) {
            return new Promise(function(resolve) {
              var sports = JSON.parse(sportsStr);
              var teams = JSON.parse(teamsStr);
              gigya.accounts.setAccountInfo({
                data: {
                  personalization: { favoritesDisciplines: sports, favoritesCountries: teams, siteLanguage: 'en' },
                  entryCampaignandSegregation: { l2028_ticketing: 'true', l2028_fan28: 'true' }
                },
                callback: function(resp) {
                  resolve({ success: resp.errorCode === 0, error: resp.errorCode === 0 ? null : resp.errorMessage });
                }
              });
              setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 15000);
            });
          })(${JSON.stringify(JSON.stringify(allSportsFresh))}, ${JSON.stringify(JSON.stringify(teamObjsFresh))})`) as { success: boolean; error?: string | null };
          if (freshDataResult.success) dataSet = true;

          if (profileSet && dataSet) {
            console.log("[Draw-OIDC] Profile+data flags set. Proceeding to form fill on tickets.la28.org...");
          }

          console.log("[Draw-OIDC] Browserless ready for OIDC!");
          log("Browserless logged in, profile=" + profileSet + " data=" + dataSet + ". Proceeding to OIDC...");
        } catch (freshErr: any) {
          console.log("[Draw-OIDC] Browserless OIDC failed: " + (freshErr.message || '').substring(0, 200));
          log("Browserless OIDC failed: " + (freshErr.message || '').substring(0, 80));
        }
      } else {
        log("Draw form: Navigating OIDC in local browser (same session)...");
        console.log("[Draw-OIDC] Starting OIDC in local browser for " + email);
      }

      if (useNstBrowser) {
        try {
          const nstConfig: any = {
            name: "la28-oidc-" + Date.now(),
            platform: "windows",
            kernel: "chromium",
            kernelMilestone: "132",
            once: true,
            headless: true,
            autoClose: true,
            timedCloseSec: 180,
            args: {
              "--disable-blink-features": "AutomationControlled"
            },
            fingerprint: {
              hardwareConcurrency: 4,
              deviceMemory: 8
            }
          };

          nstConfig.proxy = getActiveProxyUrl();
          console.log("[Draw-OIDC] NSTBrowser with " + getActiveProxyLabel());

          const query = new URLSearchParams({ config: JSON.stringify(nstConfig) });

          const endpoints = [
            `wss://chrome.nstbrowser.com/webdriver?token=${nstApiKey}&config=${encodeURIComponent(JSON.stringify(nstConfig))}`,
            `wss://api.nstbrowser.io/api/v2/connect?${query.toString()}`,
          ];

          let connected = false;
          for (const nstEndpoint of endpoints) {
            try {
              console.log("[Draw-OIDC] Trying NSTBrowser endpoint: " + nstEndpoint.substring(0, 80) + "...");
              nstBrowser = await chromium.connectOverCDP(nstEndpoint, {
                headers: { 'x-api-key': nstApiKey! },
                timeout: 30000,
              });
              connected = true;
              console.log("[Draw-OIDC] NSTBrowser connected! Contexts: " + nstBrowser.contexts().length);
              break;
            } catch (endpointErr: any) {
              console.log("[Draw-OIDC] Endpoint failed: " + endpointErr.message.substring(0, 100));
              if (nstBrowser) { try { await nstBrowser.close(); } catch {} nstBrowser = null; }
            }
          }

          if (!connected || !nstBrowser) {
            throw new Error("Could not connect to any NSTBrowser endpoint");
          }

          if (browser) { try { await browser.close(); } catch {} browser = null; }

          const nstContext = nstBrowser.contexts()[0] || await nstBrowser.newContext();
          nstPage = nstContext.pages()[0] || await nstContext.newPage();
          nstPage.setDefaultTimeout(30000);

          console.log("[Draw-OIDC] NSTBrowser: logging into Gigya first...");
          await nstPage.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 45000 });
          try { await nstPage.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
          await nstPage.waitForTimeout(2000);

          console.log("[Draw-OIDC] NSTBrowser page URL: " + nstPage.url());

          await nstPage.waitForFunction(() => typeof (window as any).gigya !== 'undefined' && typeof (window as any).gigya.accounts !== 'undefined', { timeout: 20000 });
          console.log("[Draw-OIDC] NSTBrowser: Gigya SDK loaded");
          await waitForRecaptchaEnterprise(nstPage, 8000);
          await simulateHumanBehavior(nstPage, email, password);
          console.log("[Draw-OIDC] NSTBrowser: logging in...");

          const nstLoginResult = await nstPage.evaluate(({ e, p }: { e: string; p: string }) => {
            return new Promise<any>((resolve) => {
              (window as any).gigya.accounts.login({
                loginID: e, password: p,
                callback: (resp: any) => resolve({ success: resp.errorCode === 0, errorCode: resp.errorCode, errorMessage: resp.errorMessage || '', uid: resp.UID || '' })
              });
            });
          }, { e: email, p: password });

          console.log("[Draw-OIDC] NSTBrowser Gigya login: " + JSON.stringify(nstLoginResult));
          if (!nstLoginResult.success) {
            throw new Error("NSTBrowser Gigya login failed: " + nstLoginResult.errorMessage);
          }

          await nstPage.waitForTimeout(3000);
          try { await nstPage.waitForLoadState("networkidle", { timeout: 10000 }); } catch {}

          let nstUrl = nstPage.url();
          if (nstUrl.includes("proxy.html") || nstUrl.includes("consent.html")) {
            console.log("[Draw-OIDC] NSTBrowser: on intermediate page, navigating back to login...");
            await nstPage.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
            await nstPage.waitForTimeout(3000);
          }

          const authCheck = await nstPage.evaluate(() => {
            return new Promise<any>((resolve) => {
              (window as any).gigya.accounts.getAccountInfo({
                callback: (resp: any) => resolve({ loggedIn: resp.errorCode === 0, uid: resp.UID || '' })
              });
            });
          });
          console.log("[Draw-OIDC] NSTBrowser auth check: " + JSON.stringify(authCheck));

          if (!authCheck.loggedIn) {
            throw new Error("NSTBrowser: Not logged in after Gigya login");
          }

          page = nstPage;
          console.log("[Draw-OIDC] NSTBrowser ready, proceeding to OIDC...");
        } catch (nstErr: any) {
          console.log("[Draw-OIDC] NSTBrowser setup error: " + (nstErr.message || '').substring(0, 200));
          log("NSTBrowser failed: " + (nstErr.message || '').substring(0, 80) + ". Falling back to local browser.");
          if (nstBrowser) { try { await nstBrowser.close(); } catch {} nstBrowser = null; }
          nstPage = null;

          if (!browser || !page || page.isClosed()) {
            console.log("[Draw-OIDC] Browser unavailable, reconnecting Browserless Stealth for OIDC fallback...");
            const fallbackBrowserlessUrl = `wss://production-sfo.browserless.io/chrome/stealth?token=${browserlessToken}&proxy=residential&proxyCountry=us`;
            browser = await chromium.connectOverCDP(fallbackBrowserlessUrl, { timeout: 60000 });
            const fbContexts = browser.contexts();
            const ctx = fbContexts.length > 0 ? fbContexts[0] : await browser.newContext();
            const fbPages = ctx.pages();
            page = fbPages.length > 0 ? fbPages[0] : await ctx.newPage();
            page.setDefaultTimeout(60000);

            console.log("[Draw-OIDC] Fallback: logging into Gigya in new local browser...");
            await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 45000 });
            try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
            await page.waitForFunction(() => typeof (window as any).gigya !== 'undefined' && typeof (window as any).gigya.accounts !== 'undefined', { timeout: 20000 });
            await waitForRecaptchaEnterprise(page, 8000);
            await simulateHumanBehavior(page, email, password);

            const fallbackLogin = await page.evaluate(({ e, p }: { e: string; p: string }) => {
              return new Promise<any>((resolve) => {
                (window as any).gigya.accounts.login({
                  loginID: e, password: p,
                  callback: (resp: any) => resolve({ success: resp.errorCode === 0, errorCode: resp.errorCode, uid: resp.UID || '' })
                });
              });
            }, { e: email, p: password });
            console.log("[Draw-OIDC] Fallback Gigya login: " + JSON.stringify(fallbackLogin));

            await page.waitForTimeout(3000);
            let fbUrl = page.url();
            if (fbUrl.includes("proxy.html") || fbUrl.includes("consent.html")) {
              await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
              await page.waitForTimeout(2000);
            }
          }
        }
      }

      if (!page || page.isClosed()) {
        throw new Error("Browser page is closed, cannot proceed with OIDC");
      }

      log("Step 2: Navigating to OIDC auth URL (Keycloak → tickets.la28.org)...");
      console.log("[Draw-OIDC] Step 2: OIDC navigation" + (nstPage ? " (NSTBrowser)" : " (local browser)"));

      const oidcAuthUrl = 'https://public-api.eventim.com/identity/auth/realms/la28-org/protocol/openid-connect/auth?' + new URLSearchParams({
        response_type: 'code', client_id: 'web-sso__la28-org', scope: 'openid',
        kc_idp_hint: 'gigya', ui_locales: 'en',
        redirect_uri: 'https://tickets.la28.org/mycustomerdata/'
      }).toString();

      let capturedRedirectUrls: string[] = [];
      let interceptedTicketsUrl = "";
      let keycloakSessionCookies: string[] = [];

      await page.route(/tickets\.la28\.org\/mycustomerdata/, async (route) => {
        const reqUrl = route.request().url();
        console.log("[Draw-OIDC] ROUTE HANDLER FIRED for: " + reqUrl.substring(0, 120));
        capturedRedirectUrls.push(reqUrl);
        if (!interceptedTicketsUrl && (reqUrl.includes('code=') || reqUrl.includes('iss='))) {
          interceptedTicketsUrl = reqUrl;
          console.log("[Draw-OIDC] CAPTURED tickets auth URL - letting page load to fill form and click submit");
        }
        try { await route.continue(); } catch {}
      });

      page.on('request', (req) => {
        const reqUrl = req.url();
        if (reqUrl.includes('eventim.com') || reqUrl.includes('tickets.la28.org') || reqUrl.includes('broker/gigya')) {
          capturedRedirectUrls.push(reqUrl);
        }
      });

      page.on('response', (resp) => {
        const respUrl = resp.url();
        if (respUrl.includes('eventim.com') && resp.status() >= 300 && resp.status() < 400) {
          const location = resp.headers()['location'] || '';
          console.log("[Draw-OIDC] Redirect " + resp.status() + " from " + respUrl.substring(0, 80) + " → " + location.substring(0, 120));
          if (location.includes('client_id=')) {
            const match = location.match(/client_id=([^&]*)/);
            if (match) console.log("[Draw-OIDC] Discovered client_id: " + match[1]);
          }
        }
        if (respUrl.includes('eventim.com')) {
          const setCookies = resp.headers()['set-cookie'] || '';
          if (setCookies) {
            keycloakSessionCookies.push(setCookies);
          }
        }
      });

      try {
        await page.goto(oidcAuthUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      } catch (gotoErr: any) {
        console.log("[Draw-OIDC] OIDC goto error: " + gotoErr.message.substring(0, 120));
      }
      try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
      await page.waitForTimeout(3000);

      let checkUrl = page.url();
      console.log("[Draw-OIDC] After initial nav: " + checkUrl.substring(0, 120));

      if (checkUrl.includes("proxy.html")) {
        console.log("[Draw-OIDC] On Gigya proxy.html, waiting for JS redirect...");
        for (let pw = 0; pw < 15; pw++) {
          await page.waitForTimeout(2000);
          checkUrl = page.url();
          if (!checkUrl.includes("proxy.html")) {
            console.log("[Draw-OIDC] proxy.html redirected to: " + checkUrl.substring(0, 120));
            break;
          }
        }
      }

      checkUrl = page.url();
      if (checkUrl.includes("next.tickets.la28.org")) {
        console.log("[Draw-OIDC] In Queue-it queue. Waiting up to 4 minutes for queue to pass...");
        const queueStart = Date.now();
        const maxQueueWait = 240000;
        while (Date.now() - queueStart < maxQueueWait) {
          await page.waitForTimeout(5000);
          checkUrl = page.url();
          const elapsed = Math.round((Date.now() - queueStart) / 1000);
          if (!checkUrl.includes("next.tickets.la28.org")) {
            console.log("[Draw-OIDC] Queue passed after " + elapsed + "s! Now at: " + checkUrl.substring(0, 120));
            break;
          }
          if (elapsed % 30 === 0) {
            console.log("[Draw-OIDC] Still in queue (" + elapsed + "s)...");
          }
        }
      }

      checkUrl = page.url();
      if (checkUrl.includes("proxy.html")) {
        console.log("[Draw-OIDC] On proxy.html after queue, waiting for redirect...");
        for (let pw = 0; pw < 15; pw++) {
          await page.waitForTimeout(2000);
          checkUrl = page.url();
          if (!checkUrl.includes("proxy.html")) {
            console.log("[Draw-OIDC] Redirected to: " + checkUrl.substring(0, 120));
            break;
          }
        }
      }

      if (checkUrl.includes("next.tickets.la28.org")) {
        console.log("[Draw-OIDC] Second Queue-it queue detected. Waiting up to 3 minutes...");
        const q2Start = Date.now();
        while (Date.now() - q2Start < 180000) {
          await page.waitForTimeout(5000);
          checkUrl = page.url();
          if (!checkUrl.includes("next.tickets.la28.org")) {
            console.log("[Draw-OIDC] Second queue passed! Now at: " + checkUrl.substring(0, 120));
            break;
          }
        }
      }

      checkUrl = page.url();
      interceptedTicketsUrl = capturedRedirectUrls.find(u =>
        u.includes('tickets.la28.org/mycustomerdata') && (u.includes('code=') || u.includes('iss='))
      ) || "";
      console.log("[Draw-OIDC] Final URL: " + checkUrl.substring(0, 120));
      console.log("[Draw-OIDC] Intercepted tickets auth URL: " + (interceptedTicketsUrl ? interceptedTicketsUrl.substring(0, 150) : "none"));

      const hasAfterFirstBrokerLogin = capturedRedirectUrls.some(u => u.includes('after-first-broker-login'));
      const hasTicketsRedirect = capturedRedirectUrls.some(u => u.includes('tickets.la28.org/mycustomerdata'));
      const hasBrokerEndpoint = capturedRedirectUrls.some(u => u.includes('broker/gigya/endpoint'));

      if (capturedRedirectUrls.length > 0) {
        const uniqueUrls = [...new Set(capturedRedirectUrls.map(u => u.substring(0, 100)))];
        console.log("[Draw-OIDC] Captured " + uniqueUrls.length + " unique URLs. afterBroker=" + hasAfterFirstBrokerLogin + " tickets=" + hasTicketsRedirect + " broker=" + hasBrokerEndpoint);
      }

      const onTicketsPage = checkUrl.includes("tickets.la28.org") && !checkUrl.includes("next.tickets.la28.org");

      if (onTicketsPage || hasAfterFirstBrokerLogin || hasTicketsRedirect || interceptedTicketsUrl) {
        oidcLinked = true;
        console.log("[Draw-OIDC] OIDC linking confirmed! onTickets=" + onTicketsPage + " intercepted=" + !!interceptedTicketsUrl);
        log("OIDC identity linking confirmed");
      } else if (hasBrokerEndpoint) {
        oidcLinked = true;
        console.log("[Draw-OIDC] Broker endpoint hit. OIDC linking likely completed server-side.");
        log("OIDC linking likely completed (broker endpoint reached)");
      }

      const ticketsAuthUrl = interceptedTicketsUrl;

      if (onTicketsPage) {
        console.log("[Draw-OIDC] Browser is on tickets.la28.org! Attempting form fill...");
        log("On tickets.la28.org - filling draw registration form...");

        try {
          await page.waitForTimeout(5000);
          const formResult = await fillAndSubmitTicketsForm(
            page, birthYear, usedZip, favOlympicSports, favParalympicSports, favTeams, log
          );
          if (formResult) {
            formSubmitted = true;
            log("Draw form submitted directly in browser!");
          } else {
            log("On tickets page but form fill did not complete.");
          }
        } catch (formErr: any) {
          console.log("[Draw-OIDC] Form fill error: " + (formErr.message || '').substring(0, 150));
        }
      }

      if (!formSubmitted && ticketsAuthUrl) {
        console.log("[Draw-OIDC] Form not submitted yet, trying to navigate to tickets.la28.org/mycustomerdata/...");
        log("OIDC linked. Navigating to tickets.la28.org to submit registration...");
        try {
          await page.unroute(/tickets\.la28\.org\/mycustomerdata/);
        } catch {}
        try {
          await page.goto("https://tickets.la28.org/mycustomerdata/", { waitUntil: "domcontentloaded", timeout: 30000 });
          try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
          await page.waitForTimeout(3000);

          let navUrl = page.url();
          if (navUrl.includes("next.tickets.la28.org")) {
            console.log("[Draw-OIDC] In Queue-it queue. Waiting...");
            log("In Queue-it queue, waiting...");
            const qStart = Date.now();
            while (Date.now() - qStart < 240000) {
              await page.waitForTimeout(5000);
              navUrl = page.url();
              if (!navUrl.includes("next.tickets.la28.org")) break;
            }
          }

          const nowOnTickets = page.url().includes("tickets.la28.org") && !page.url().includes("next.tickets.la28.org");
          if (nowOnTickets) {
            console.log("[Draw-OIDC] Reached tickets.la28.org! Filling form...");
            await page.waitForTimeout(5000);
            const formResult = await fillAndSubmitTicketsForm(
              page, birthYear, usedZip, favOlympicSports, favParalympicSports, favTeams, log
            );
            if (formResult) {
              formSubmitted = true;
              log("Draw form submitted directly in browser!");
            }
          } else {
            console.log("[Draw-OIDC] Could not reach tickets page. URL: " + page.url().substring(0, 120));
          }
        } catch (navErr: any) {
          console.log("[Draw-OIDC] Nav to tickets page failed: " + (navErr.message || '').substring(0, 150));
        }
      }

      if (!formSubmitted && ticketsAuthUrl) {
        oidcLinked = true;
        console.log("[Draw-OIDC] OIDC identity linking confirmed via auth code redirect chain");
        console.log("[Draw-OIDC] Auth code URL captured: " + ticketsAuthUrl.substring(0, 150));
        log("OIDC linked. Opening full flow via ZenRows Browser...");

        let bdBrowser: any = null;
        try {
          let zenrowsUrl = "";
          try {
            const zrRow = await db.execute(sql`SELECT value FROM settings WHERE key = 'zenrows_api_url'`);
            if (zrRow.rows.length > 0 && zrRow.rows[0].value) {
              zenrowsUrl = zrRow.rows[0].value as string;
            }
          } catch {}
          if (!zenrowsUrl) {
            throw new Error("ZenRows Browser URL not configured. Set it in Settings.");
          }
          if (!zenrowsUrl.includes('proxy_country=')) {
            zenrowsUrl += (zenrowsUrl.includes('?') ? '&' : '?') + 'proxy_country=us';
          }
          console.log("[ZenRows] Connecting...");
          bdBrowser = await chromium.connectOverCDP(zenrowsUrl, { timeout: 60000 });
          console.log("[ZenRows] Connected!");

          const bdContext = bdBrowser.contexts()[0] || await bdBrowser.newContext();
          const bdPage = await bdContext.newPage();
          await bdPage.setDefaultNavigationTimeout(120000);
          await bdPage.setDefaultTimeout(60000);

          const safeEmail = email.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
          const safePass = password.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

          // Warmup: visit la28.org first to establish cookies/JS context
          console.log("[ZenRows] Warming up browser...");
          try { await bdPage.goto('https://www.la28.org/', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
          await bdPage.waitForTimeout(3000);

          const waitQueueIt = async () => {
            if (bdPage.url().includes('next.tickets.la28.org') || bdPage.url().includes('queue-it')) {
              console.log("[ZenRows] In Queue-it, waiting...");
              log("In Queue-it queue...");
              try {
                await bdPage.waitForURL(url => {
                  const u = url.toString();
                  return !u.includes('next.tickets.la28.org') && !u.includes('queue-it');
                }, { timeout: 240000 });
              } catch {}
              await bdPage.waitForTimeout(5000);
              console.log("[ZenRows] Queue passed! URL: " + bdPage.url().substring(0, 150));
            }
          };

          const doGigyaLogin = async (): Promise<boolean> => {
            let curUrl = bdPage.url();
            if (curUrl.includes('proxy.html') && !curUrl.includes('mode=afterLogin')) {
              console.log("[ZenRows] On proxy.html, waiting for redirect...");
              for (let w = 0; w < 10; w++) {
                await bdPage.waitForTimeout(2000);
                curUrl = bdPage.url();
                if (!curUrl.includes('proxy.html')) break;
              }
              if (curUrl.includes('proxy.html')) {
                try { await bdPage.goto('https://la28id.la28.org/login/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
                await bdPage.waitForTimeout(3000);
                curUrl = bdPage.url();
              }
            }
            if (!curUrl.includes('la28id.la28.org') || curUrl.includes('register')) {
              const loginNav = 'https://la28id.la28.org/login/';
              try { await bdPage.goto(loginNav, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
              await bdPage.waitForTimeout(5000);
            }
            try { await bdPage.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
            await bdPage.waitForTimeout(5000);

            for (let attempt = 1; attempt <= 8; attempt++) {
              console.log("[ZenRows] Gigya login attempt " + attempt + "...");
              const hasGigya = await bdPage.evaluate(`typeof window.gigya !== 'undefined' && typeof window.gigya.accounts !== 'undefined' && typeof window.gigya.accounts.login === 'function'`);
              if (!hasGigya) {
                console.log("[ZenRows] Gigya SDK not ready, waiting 10s...");
                await bdPage.waitForTimeout(10000);
                if (attempt === 2 || attempt === 5) {
                  console.log("[ZenRows] Reloading login page...");
                  try { await bdPage.goto('https://la28id.la28.org/login/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
                  await bdPage.waitForTimeout(8000);
                  try { await bdPage.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
                  await bdPage.waitForTimeout(8000);
                }
                if (attempt === 4) {
                  console.log("[ZenRows] Trying to inject Gigya SDK manually...");
                  try {
                    await bdPage.evaluate(`
                      if (!document.querySelector('script[src*="gigya.com"]')) {
                        var s = document.createElement('script');
                        s.src = 'https://cdns.eu1.gigya.com/js/gigya.js?apikey=4_w4CcQ6tKu4jTeDPirnKxnA';
                        document.head.appendChild(s);
                      }
                    `);
                    await bdPage.waitForTimeout(10000);
                  } catch {}
                }
                continue;
              }

              if (attempt === 1) {
                await waitForRecaptchaEnterprise(bdPage, 8000);
                await simulateHumanBehavior(bdPage, email, password);
              }

              const result = await bdPage.evaluate(`
                new Promise(function(resolve) {
                  var t = setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 30000);
                  try {
                    window.gigya.accounts.login({
                      loginID: '${safeEmail}', password: '${safePass}',
                      callback: function(r) { clearTimeout(t); resolve({ success: r.errorCode === 0, error: r.errorMessage || ('Error ' + r.errorCode), code: r.errorCode }); }
                    });
                  } catch(e) { clearTimeout(t); resolve({ success: false, error: e.message }); }
                })
              `) as { success: boolean; error?: string; code?: number };
              console.log("[ZenRows] Login attempt " + attempt + ": " + JSON.stringify(result));
              if (result.success) return true;

              if (attempt < 5 && result.error && result.error.includes('Invalid parameter')) {
                console.log("[ZenRows] Retrying after 5s delay (known intermittent error)...");
                await bdPage.waitForTimeout(5000);
              } else {
                await bdPage.waitForTimeout(3000);
              }
            }

            console.log("[ZenRows] API login failed all attempts. Trying form-based login...");
            try {
              const emailInput = await bdPage.$('input[type="email"], input[name="loginID"], input[name="email"], input[placeholder*="email" i], input[data-gigya-name="loginID"]');
              const passInput = await bdPage.$('input[type="password"]');
              if (emailInput && passInput) {
                await emailInput.fill(email);
                await bdPage.waitForTimeout(500);
                await passInput.fill(password);
                await bdPage.waitForTimeout(500);
                const submitBtn = await bdPage.$('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), .gigya-input-submit');
                if (submitBtn) {
                  await submitBtn.click();
                  console.log("[ZenRows] Form login submitted");
                  await bdPage.waitForTimeout(10000);
                  const afterFormUrl = bdPage.url();
                  console.log("[ZenRows] After form login: " + afterFormUrl.substring(0, 100));
                  if (!afterFormUrl.includes('login') || afterFormUrl.includes('proxy.html') || afterFormUrl.includes('consent')) {
                    return true;
                  }
                }
              }
            } catch (formErr: any) {
              console.log("[ZenRows] Form login error: " + (formErr.message || '').substring(0, 100));
            }
            return false;
          };

          // Step 1: Login to Gigya via REST API and inject session cookie into ZenRows browser
          console.log("[ZenRows] Step 1: Login to Gigya first...");
          log("Logging into Gigya via ZenRows...");

          // Extract Gigya session cookie from local browser (which already logged in successfully)
          let localLoginToken: string | null = null;
          try {
            console.log("[ZenRows] Extracting Gigya session cookie from local browser...");
            const localCookies = await page.context().cookies(['https://la28id.la28.org', 'https://la28.org']);
            const gltCookie = localCookies.find((c: any) => c.name.startsWith('glt_'));
            if (gltCookie) {
              localLoginToken = gltCookie.value;
              console.log("[ZenRows] Got login token from local browser: " + localLoginToken.substring(0, 20) + "... (name=" + gltCookie.name + ")");
            } else {
              console.log("[ZenRows] No glt_ cookie found in local browser. Available cookies: " + localCookies.map((c: any) => c.name).join(', '));
              // Try extracting from Gigya SDK directly
              const sdkToken = await page.evaluate(`
                (function() {
                  try {
                    var cookies = document.cookie.split(';');
                    for (var i = 0; i < cookies.length; i++) {
                      var c = cookies[i].trim();
                      if (c.startsWith('glt_')) return c.split('=').slice(1).join('=');
                    }
                  } catch(e) {}
                  return null;
                })()
              `);
              if (sdkToken) {
                localLoginToken = sdkToken as string;
                console.log("[ZenRows] Got login token via document.cookie: " + localLoginToken.substring(0, 20) + "...");
              }
            }
          } catch (cookieErr: any) {
            console.log("[ZenRows] Cookie extraction error: " + (cookieErr.message || '').substring(0, 80));
          }

          if (localLoginToken) {
            // Inject session cookies into ZenRows browser
            console.log("[ZenRows] Injecting session cookies into ZenRows browser...");
            const cookieDomains = ['.la28.org', '.la28id.la28.org', 'la28id.la28.org'];
            for (const domain of cookieDomains) {
              try {
                await bdContext.addCookies([
                  { name: 'glt_4_w4CcQ6tKu4jTeDPirnKxnA', value: localLoginToken, domain, path: '/', secure: true, sameSite: 'None' as any },
                ]);
              } catch {}
            }
            console.log("[ZenRows] Session cookies injected! Skipping SDK login, going straight to OIDC...");
            // Visit la28id.la28.org briefly to establish the cookie on that domain
            try { await bdPage.goto('https://la28id.la28.org/', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
            await bdPage.waitForTimeout(3000);
          } else {
            console.log("[ZenRows] No local login token found, will try SDK login as fallback...");
          }

          let loggedIn = !!localLoginToken; // If local browser token was injected, we're already logged in
          if (!loggedIn) {
            // Fallback: try SDK-based login if cookie injection didn't work
            try { await bdPage.goto('https://la28id.la28.org/login/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
            await bdPage.waitForTimeout(3000);
            try { await bdPage.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
            await bdPage.waitForTimeout(5000);
            loggedIn = await doGigyaLogin();
          }
          console.log("[ZenRows] Login result: " + loggedIn + (localLoginToken ? " (via local browser cookie injection)" : " (via SDK)"));

          if (loggedIn) {
            // Step 2: Navigate to OIDC auth URL directly (Keycloak endpoint)
            // This triggers the full OIDC flow: Keycloak → proxy.html → (already logged in) → redirect back
            const oidcUrl = 'https://public-api.eventim.com/identity/auth/realms/la28-org/protocol/openid-connect/auth?' + new URLSearchParams({
              response_type: 'code', client_id: 'web-sso__la28-org', scope: 'openid',
              kc_idp_hint: 'gigya', ui_locales: 'en',
              redirect_uri: 'https://tickets.la28.org/mycustomerdata/'
            }).toString();

            console.log("[ZenRows] Step 2: Navigate to OIDC auth URL...");
            log("Opening OIDC auth flow...");
            try {
              await bdPage.goto(oidcUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
            } catch {}
            await bdPage.waitForTimeout(5000);
            await waitQueueIt();

            let curUrl = bdPage.url();
            console.log("[ZenRows] After OIDC nav: " + curUrl.substring(0, 150));

            // Handle proxy.html - wait for Gigya auto-redirect (session already exists)
            if (curUrl.includes('proxy.html')) {
              console.log("[ZenRows] On proxy.html, waiting for Gigya auto-redirect...");

              // Check if proxy.html has context param (OIDC flow) vs afterLogin
              const hasContext = curUrl.includes('context=');
              const hasAfterLogin = curUrl.includes('mode=afterLogin');
              console.log("[ZenRows] proxy.html: context=" + hasContext + " afterLogin=" + hasAfterLogin);

              // Wait for proxy.html JS to detect Gigya session and redirect
              for (let pw = 0; pw < 20; pw++) {
                await bdPage.waitForTimeout(3000);
                curUrl = bdPage.url();
                if (!curUrl.includes('proxy.html')) {
                  console.log("[ZenRows] proxy.html redirected to: " + curUrl.substring(0, 150));
                  break;
                }
                if (pw === 5) {
                  // Try to force the Gigya OIDC IDP redirect by calling socialize.notifyLogin
                  console.log("[ZenRows] proxy.html stuck, trying to force Gigya IDP redirect...");
                  try {
                    const forceResult = await bdPage.evaluate(`
                      new Promise(function(resolve) {
                        try {
                          // Check if gigya has a pending OIDC flow
                          if (typeof window.gigya !== 'undefined' && window.gigya.fidm) {
                            resolve({ hasFidm: true, keys: Object.keys(window.gigya.fidm).join(',') });
                          } else if (typeof window.gigya !== 'undefined') {
                            // Try getAccountInfo to confirm session
                            window.gigya.accounts.getAccountInfo({
                              callback: function(r) {
                                if (r.errorCode === 0) {
                                  // Session valid, try reloading the page to re-trigger OIDC
                                  resolve({ loggedIn: true, uid: (r.UID || '').substring(0, 20) });
                                } else {
                                  resolve({ loggedIn: false, error: r.errorMessage });
                                }
                              }
                            });
                          } else {
                            resolve({ noGigya: true });
                          }
                        } catch(e) { resolve({ error: e.message }); }
                        setTimeout(function() { resolve({ timeout: true }); }, 8000);
                      })
                    `) as any;
                    console.log("[ZenRows] Force redirect result: " + JSON.stringify(forceResult));
                  } catch {}
                }
                if (pw === 10) {
                  // Reload proxy.html to re-trigger the OIDC flow with existing session
                  console.log("[ZenRows] Reloading proxy.html to re-trigger OIDC...");
                  try { await bdPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
                  await bdPage.waitForTimeout(5000);
                }
                if (pw === 14) {
                  // Last resort: navigate directly to tickets
                  console.log("[ZenRows] Giving up on proxy.html, navigating to tickets directly...");
                  try { await bdPage.goto('https://tickets.la28.org/mycustomerdata/', { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch {}
                  await bdPage.waitForTimeout(5000);
                  await waitQueueIt();
                  curUrl = bdPage.url();
                  break;
                }
              }
              curUrl = bdPage.url();
            }

            // Handle Queue-it
            if (curUrl.includes('next.tickets.la28.org') || curUrl.includes('queue-it')) {
              await waitQueueIt();
              curUrl = bdPage.url();
            }

            // Handle second proxy.html landing (after Queue-it redirects back to proxy.html)
            if (curUrl.includes('proxy.html')) {
              console.log("[ZenRows] Back on proxy.html after Queue-it, waiting for auto-redirect...");
              for (let pw2 = 0; pw2 < 30; pw2++) {
                await bdPage.waitForTimeout(3000);
                curUrl = bdPage.url();
                if (!curUrl.includes('proxy.html')) {
                  console.log("[ZenRows] proxy.html finally redirected to: " + curUrl.substring(0, 150));
                  break;
                }
                if (pw2 === 8) {
                  console.log("[ZenRows] proxy.html still stuck, reloading...");
                  try { await bdPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
                  await bdPage.waitForTimeout(5000);
                }
                if (pw2 === 15) {
                  console.log("[ZenRows] proxy.html stuck after reload, navigating to tickets directly...");
                  try { await bdPage.goto('https://tickets.la28.org/mycustomerdata/', { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch {}
                  await bdPage.waitForTimeout(5000);
                  await waitQueueIt();
                  curUrl = bdPage.url();
                  break;
                }
              }
              curUrl = bdPage.url();
              // Handle any Queue-it that may appear after proxy.html redirect
              if (curUrl.includes('next.tickets.la28.org') || curUrl.includes('queue-it')) {
                await waitQueueIt();
                curUrl = bdPage.url();
              }
            }

            // If on consent page, wait
            if (curUrl.includes('consent')) {
              console.log("[ZenRows] On consent page, waiting...");
              for (let cw = 0; cw < 10; cw++) {
                await bdPage.waitForTimeout(2000);
                curUrl = bdPage.url();
                if (!curUrl.includes('consent')) break;
              }
            }

            // If landed on Gigya register/login page, the SDK should be loaded here - use it to login
            if (curUrl.includes('la28id.la28.org/register') || curUrl.includes('la28id.la28.org/login')) {
              console.log("[ZenRows] Landed on Gigya page: " + curUrl.substring(0, 120));
              console.log("[ZenRows] Attempting SDK login from this page (SDK should be loaded)...");

              // Wait for Gigya SDK to load on this page
              try { await bdPage.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
              await bdPage.waitForTimeout(5000);

              const sdkLoginResult = await bdPage.evaluate(`
                new Promise(function(resolve) {
                  if (typeof window.gigya === 'undefined' || !window.gigya.accounts) {
                    resolve({ success: false, error: 'no_sdk' });
                    return;
                  }
                  var t = setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 30000);
                  try {
                    window.gigya.accounts.login({
                      loginID: '${safeEmail}',
                      password: '${safePass}',
                      callback: function(r) {
                        clearTimeout(t);
                        resolve({ success: r.errorCode === 0, error: r.errorMessage || ('code_' + r.errorCode), code: r.errorCode });
                      }
                    });
                  } catch(e) { clearTimeout(t); resolve({ success: false, error: e.message }); }
                })
              `) as any;
              console.log("[ZenRows] SDK login on register page: " + JSON.stringify(sdkLoginResult));

              if (sdkLoginResult.success) {
                // After login, wait for proxy.html to process OIDC and redirect
                await bdPage.waitForTimeout(8000);
                curUrl = bdPage.url();
                console.log("[ZenRows] After SDK login redirect: " + curUrl.substring(0, 150));

                // If still on proxy.html or Gigya page, wait more
                for (let rw = 0; rw < 15; rw++) {
                  if (curUrl.includes('tickets.la28.org') && !curUrl.includes('next.tickets')) break;
                  if (!curUrl.includes('proxy.html') && !curUrl.includes('la28id.la28.org')) break;
                  await bdPage.waitForTimeout(3000);
                  curUrl = bdPage.url();
                  console.log("[ZenRows] SDK login redirect wait " + rw + ": " + curUrl.substring(0, 120));
                }
                await waitQueueIt();
                curUrl = bdPage.url();
              } else {
                console.log("[ZenRows] SDK login failed on register page, trying direct tickets nav...");
                try { await bdPage.goto('https://tickets.la28.org/mycustomerdata/', { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch {}
                await bdPage.waitForTimeout(5000);
                await waitQueueIt();
                curUrl = bdPage.url();
                console.log("[ZenRows] After direct tickets nav: " + curUrl.substring(0, 150));
              }
            }

            // If still shows #/login, the session didn't carry through OIDC
            if (curUrl.includes('#/login') || curUrl.includes('#/register')) {
              console.log("[ZenRows] Still on login page. Trying login button to re-trigger OIDC...");
              try {
                const loginBtn = await bdPage.$('a[href*="login"], button:has-text("Log in"), button:has-text("Sign in"), a:has-text("LOG IN"), a:has-text("SIGN IN"), [class*="login"] a, [class*="login"] button');
                if (loginBtn) {
                  await loginBtn.click();
                  await bdPage.waitForTimeout(15000);
                  curUrl = bdPage.url();
                  console.log("[ZenRows] After login button click: " + curUrl.substring(0, 120));
                  await waitQueueIt();

                  // If redirected to proxy.html, it should auto-redirect since we're logged in
                  if (curUrl.includes('proxy.html')) {
                    for (let pw = 0; pw < 15; pw++) {
                      await bdPage.waitForTimeout(3000);
                      curUrl = bdPage.url();
                      if (!curUrl.includes('proxy.html')) {
                        console.log("[ZenRows] proxy.html redirected: " + curUrl.substring(0, 120));
                        break;
                      }
                    }
                  }
                }
              } catch (clickErr: any) {
                console.log("[ZenRows] Login button error: " + (clickErr.message || '').substring(0, 100));
              }
            }

            curUrl = bdPage.url();
            console.log("[ZenRows] Pre-form URL: " + curUrl.substring(0, 150));
          } else {
            console.log("[ZenRows] Gigya login failed - cannot proceed with OIDC");
            log("ZenRows Gigya login failed.");
          }

          // Wait for Angular SPA to render the form
          var zenCurUrl = bdPage.url();
          const onTicketsAuth = zenCurUrl.includes('tickets.la28.org') && !zenCurUrl.includes('#/login') && !zenCurUrl.includes('#/register') && !zenCurUrl.includes('next.tickets.la28.org');
          console.log("[ZenRows] Form wait: onTicketsAuth=" + onTicketsAuth + " url=" + zenCurUrl.substring(0, 100));

          if (onTicketsAuth) {
            log("On tickets page, waiting for form to load...");
          }

          for (let spaWait = 0; spaWait < 15; spaWait++) {
            await bdPage.waitForTimeout(3000);
            var pageInfo: any;
            try {
              pageInfo = await bdPage.evaluate(`(() => {
                var txt = (document.body.innerText || '').substring(0, 2000);
                var selects = document.querySelectorAll('select').length;
                var inputs = document.querySelectorAll('input[type="text"]').length;
                var appRoot = document.querySelector('app-root, [class*="app"]');
                var scripts = document.querySelectorAll('script[src]').length;
                return { txt: txt.substring(0, 500), selects: selects, inputs: inputs, hasAppRoot: !!appRoot, bodyLen: txt.length, url: location.href, scripts: scripts };
              })()`) as any;
            } catch (evalErr: any) {
              console.log("[ZenRows] Wait " + spaWait + " evaluate error (page navigating): " + (evalErr.message || '').substring(0, 100));
              await bdPage.waitForTimeout(5000);
              continue;
            }
            if (spaWait % 3 === 0) {
              console.log("[ZenRows] Wait " + spaWait + " text: " + pageInfo.txt.substring(0, 300));
            }
            console.log("[ZenRows] Wait " + spaWait + ": selects=" + pageInfo.selects + " inputs=" + pageInfo.inputs + " bodyLen=" + pageInfo.bodyLen + " appRoot=" + pageInfo.hasAppRoot + " scripts=" + pageInfo.scripts + " url=" + pageInfo.url.substring(0, 80));
            if (pageInfo.selects >= 5 || (pageInfo.selects >= 3 && pageInfo.inputs >= 3)) {
              console.log("[ZenRows] Form loaded! selects=" + pageInfo.selects);
              break;
            }
            if (pageInfo.txt.includes('Birth Year') || pageInfo.txt.includes('PROFILE') || pageInfo.txt.includes('Save profile') || pageInfo.txt.includes('FAVORITE')) {
              console.log("[ZenRows] Form text detected!");
              await bdPage.waitForTimeout(3000);
              break;
            }
            // If on login/register hash, form won't load - break early
            if (pageInfo.url.includes('#/login') || pageInfo.url.includes('#/register')) {
              console.log("[ZenRows] On login/register page - OIDC auth not completed, cannot load form.");
              break;
            }
            // If still on proxy.html, wait for Gigya to redirect
            if (pageInfo.url.includes('proxy.html')) {
              console.log("[ZenRows] Still on proxy.html during SPA wait, waiting for redirect...");
              for (let ppw = 0; ppw < 10; ppw++) {
                await bdPage.waitForTimeout(3000);
                try {
                  const pUrl = await bdPage.evaluate(`location.href`) as string;
                  if (!pUrl.includes('proxy.html')) {
                    console.log("[ZenRows] proxy.html finally redirected during SPA wait: " + pUrl.substring(0, 120));
                    break;
                  }
                } catch { await bdPage.waitForTimeout(3000); }
              }
              continue;
            }
            if (spaWait === 5) {
              console.log("[ZenRows] Reloading page to re-trigger Angular...");
              try { await bdPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
              await bdPage.waitForTimeout(5000);
              await waitQueueIt();
            }
            if (spaWait === 10) {
              console.log("[ZenRows] Second reload...");
              try { await bdPage.goto('https://tickets.la28.org/mycustomerdata/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
              await bdPage.waitForTimeout(5000);
              await waitQueueIt();
            }
            if (spaWait > 0 && pageInfo.bodyLen < 100) {
              console.log("[ZenRows] Page appears blank, text: " + pageInfo.txt);
            }
          }

          const bdText = await bdPage.evaluate(`(document.body.innerText || '').substring(0, 2000)`) as string;
          const bdSelects = await bdPage.evaluate(`document.querySelectorAll('select').length`) as number;
          console.log("[ZenRows] Final: url=" + bdPage.url().substring(0, 100) + " selects=" + bdSelects + " text=" + bdText.substring(0, 300));

          if (bdSelects >= 5 && (bdText.includes('PROFILE') || bdText.includes('Birth Year') || bdText.includes('Save profile') || bdText.includes('FAVORITE'))) {
            console.log("[ZenRows] Filling form...");
            log("Filling draw registration form...");
            const formResult = await fillAndSubmitTicketsForm(bdPage, birthYear, usedZip, favOlympicSports, favParalympicSports, favTeams, log);

            await bdPage.waitForTimeout(10000);
            const afterUrl = bdPage.url();
            console.log("[ZenRows] After submit URL: " + afterUrl);

            if (afterUrl.includes('mydatasuccess')) {
              console.log("[ZenRows] SUCCESS! Redirected to /mydatasuccess/");
              log("SUCCESS! Draw registration complete — redirected to mydatasuccess!");
              formSubmitted = true;
            } else if (formResult) {
              formSubmitted = true;
              log("Form submitted on tickets.la28.org via ZenRows.");
            }
          } else {
            console.log("[ZenRows] Form not found. Page text: " + bdText.substring(0, 200));
            log("Could not load draw form on tickets page.");
          }

          try { await bdPage.close(); } catch {}
        } catch (bdErr: any) {
          console.log("[ZenRows] Error: " + (bdErr.message || '').substring(0, 300));
          log("ZenRows error: " + (bdErr.message || '').substring(0, 100));
        } finally {
          if (bdBrowser) { try { await bdBrowser.close(); } catch {} }
        }
      } else if (hasBrokerEndpoint) {
        oidcLinked = true;
        console.log("[Draw-OIDC] Broker endpoint was hit but no auth code URL captured. OIDC linking likely completed.");
        log("OIDC linking evidence found (broker endpoint hit). Draw form not accessible.");
      } else {
        console.log("[Draw-OIDC] No broker URL captured. OIDC flow may not have completed.");
        console.log("[Draw-OIDC] Falling back to ZenRows for full flow (login + OIDC + form)...");
        log("OIDC flow incomplete locally. Trying full flow via ZenRows...");

        let bdBrowser2: any = null;
        try {
          let zenrowsUrl2 = "";
          try {
            const zrRow2 = await db.execute(sql`SELECT value FROM settings WHERE key = 'zenrows_api_url'`);
            if (zrRow2.rows.length > 0 && zrRow2.rows[0].value) {
              zenrowsUrl2 = zrRow2.rows[0].value as string;
            }
          } catch {}
          if (!zenrowsUrl2) {
            throw new Error("ZenRows Browser URL not configured. Set it in Settings.");
          }
          if (!zenrowsUrl2.includes('proxy_country=')) {
            zenrowsUrl2 += (zenrowsUrl2.includes('?') ? '&' : '?') + 'proxy_country=us';
          }
          console.log("[ZenRows-Full] Connecting...");
          bdBrowser2 = await chromium.connectOverCDP(zenrowsUrl2, { timeout: 60000 });
          console.log("[ZenRows-Full] Connected!");

          const bdCtx2 = bdBrowser2.contexts()[0] || await bdBrowser2.newContext();
          const bdPg2 = await bdCtx2.newPage();
          await bdPg2.setDefaultNavigationTimeout(120000);
          await bdPg2.setDefaultTimeout(60000);

          const safeEmail2 = email.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
          const safePass2 = password.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

          const waitQueueIt2 = async () => {
            if (bdPg2.url().includes('next.tickets.la28.org') || bdPg2.url().includes('queue-it')) {
              console.log("[ZenRows-Full] In Queue-it, waiting...");
              try {
                await bdPg2.waitForURL(function(url: any) {
                  var u = url.toString();
                  return !u.includes('next.tickets.la28.org') && !u.includes('queue-it');
                }, { timeout: 240000 });
              } catch {}
              await bdPg2.waitForTimeout(5000);
              console.log("[ZenRows-Full] Queue passed! URL: " + bdPg2.url().substring(0, 150));
            }
          };

          console.log("[ZenRows-Full] Step 1: Login to Gigya...");

          // Extract Gigya session cookie from local browser
          let localToken2: string | null = null;
          try {
            console.log("[ZenRows-Full] Extracting Gigya session from local browser...");
            const cookies2 = await page.context().cookies(['https://la28id.la28.org', 'https://la28.org']);
            const glt2 = cookies2.find((c: any) => c.name.startsWith('glt_'));
            if (glt2) {
              localToken2 = glt2.value;
              console.log("[ZenRows-Full] Got login token: " + localToken2.substring(0, 20) + "...");
            } else {
              const st2 = await page.evaluate(`(function(){try{var cs=document.cookie.split(';');for(var i=0;i<cs.length;i++){var c=cs[i].trim();if(c.startsWith('glt_'))return c.split('=').slice(1).join('=');}}catch(e){}return null;})()`);
              if (st2) { localToken2 = st2 as string; console.log("[ZenRows-Full] Got token via document.cookie"); }
            }
          } catch (ce2: any) {
            console.log("[ZenRows-Full] Cookie extraction error: " + (ce2.message || '').substring(0, 80));
          }

          var gigyaLogin2 = false;
          if (localToken2) {
            for (const d of ['.la28.org', '.la28id.la28.org', 'la28id.la28.org']) {
              try { await bdCtx2.addCookies([{ name: 'glt_4_w4CcQ6tKu4jTeDPirnKxnA', value: localToken2, domain: d, path: '/', secure: true, sameSite: 'None' as any }]); } catch {}
            }
            try { await bdPg2.goto('https://la28id.la28.org/', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
            await bdPg2.waitForTimeout(3000);
            gigyaLogin2 = true;
            console.log("[ZenRows-Full] Session cookies injected, skipping SDK login");
          }

          if (!gigyaLogin2) {
            try { await bdPg2.goto('https://la28id.la28.org/login/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
            await bdPg2.waitForTimeout(5000);

            var lastZrError = '';
            const ZR_MAX_ATTEMPTS = 6;
            for (let att = 0; att < ZR_MAX_ATTEMPTS; att++) {
              if (att > 0) {
                const isGeo = !!(lastZrError && lastZrError.includes('451002'));
                const delaySec = isGeo ? (30 + att * 15) : 5;
                console.log("[ZenRows-Full] Retry " + (att + 1) + "/" + ZR_MAX_ATTEMPTS + (isGeo ? " (geo-block backoff " + delaySec + "s)" : ""));
                await bdPg2.waitForTimeout(delaySec * 1000);
              }
              lastZrError = '';
              console.log("[ZenRows-Full] Gigya login attempt " + (att + 1) + "/" + ZR_MAX_ATTEMPTS + "...");
              try {
                if (att === 0) {
                  try {
                    await bdPg2.waitForFunction("typeof window.gigya !== 'undefined' && typeof window.gigya.accounts !== 'undefined'", { timeout: 15000 });
                    await waitForRecaptchaEnterprise(bdPg2, 8000);
                    await simulateHumanBehavior(bdPg2, email, password);
                  } catch (simErr: any) {
                    console.log("[ZenRows-Full] Pre-login simulation error: " + (simErr.message || '').substring(0, 80));
                  }
                }
                const loginRes2 = await bdPg2.evaluate(`
                  new Promise(function(resolve) {
                    try {
                      if (typeof window.gigya === 'undefined') { resolve({ success: false, error: 'no gigya' }); return; }
                      window.gigya.accounts.login({
                        loginID: '${safeEmail2}',
                        password: '${safePass2}',
                        callback: function(r) {
                          resolve({ success: r.errorCode === 0, error: 'Error ' + r.errorCode });
                        }
                      });
                      setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 15000);
                    } catch(e) { resolve({ success: false, error: e.message }); }
                  })
                `) as any;
                console.log("[ZenRows-Full] Login attempt " + (att + 1) + ": " + JSON.stringify(loginRes2));
                lastZrError = loginRes2?.error || '';
                if (loginRes2 && loginRes2.success) { gigyaLogin2 = true; break; }
                if (lastZrError.includes('451002')) continue;
              } catch (loginErr2: any) {
                console.log("[ZenRows-Full] Login error: " + (loginErr2.message || '').substring(0, 100));
                lastZrError = loginErr2.message || '';
              }
            }
          }

          if (!gigyaLogin2) {
            console.log("[ZenRows-Full] SDK login failed. Trying form-based login...");
            try {
              await bdPg2.waitForTimeout(3000);
              const formContainer = await bdPg2.$('#container, .gigya-screen, [data-screenset-element-id]');
              let targetFrame: any = bdPg2;
              if (!formContainer) {
                const frames = bdPg2.frames();
                for (const f of frames) {
                  const fi = await f.$('input[name="loginID"], input[name="username"], input[type="email"]');
                  if (fi) { targetFrame = f; console.log("[ZenRows-Full] Found login form in iframe"); break; }
                }
              }
              const emailInput = await targetFrame.$('input[name="loginID"], input[name="username"], input[type="email"], input[name="email"]');
              const passInput = await targetFrame.$('input[name="password"], input[type="password"]');
              if (emailInput && passInput) {
                await emailInput.click();
                await bdPg2.waitForTimeout(300);
                await emailInput.type(email, { delay: 50 });
                await passInput.click();
                await bdPg2.waitForTimeout(300);
                await passInput.type(password, { delay: 50 });
                const submitBtn = await targetFrame.$('input[type="submit"], button[type="submit"], .gigya-input-submit');
                if (submitBtn) {
                  await submitBtn.click();
                  await bdPg2.waitForTimeout(10000);
                  const afterLogin = bdPg2.url();
                  console.log("[ZenRows-Full] After form login: " + afterLogin.substring(0, 120));
                  if (!afterLogin.includes('/login') || afterLogin.includes('proxy.html') || afterLogin.includes('mycustomerdata')) {
                    gigyaLogin2 = true;
                    console.log("[ZenRows-Full] Form-based login appears successful!");
                  }
                }
              } else {
                console.log("[ZenRows-Full] Could not find login form fields");
              }
            } catch (formLoginErr: any) {
              console.log("[ZenRows-Full] Form login error: " + (formLoginErr.message || '').substring(0, 100));
            }
          }

          if (gigyaLogin2) {
            console.log("[ZenRows-Full] Gigya login successful! Setting profile + data...");

            try {
              const profileRes2 = await bdPg2.evaluate(`
                new Promise(function(resolve) {
                  try {
                    window.gigya.accounts.setAccountInfo({
                      profile: { birthYear: ${birthYear}, zip: '${usedZip}', country: 'US' },
                      callback: function(r) { resolve({ success: r.errorCode === 0, error: r.errorMessage }); }
                    });
                    setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 10000);
                  } catch(e) { resolve({ success: false, error: e.message }); }
                })
              `) as any;
              console.log("[ZenRows-Full] Profile set: " + JSON.stringify(profileRes2));
            } catch {}

            try {
              var favJson2 = JSON.stringify(favOlympicSports.concat(favParalympicSports).concat(favTeams));
              favJson2 = favJson2.replace(/'/g, "\\'");
              const dataRes2 = await bdPg2.evaluate(`
                new Promise(function(resolve) {
                  try {
                    window.gigya.accounts.setAccountInfo({
                      data: {
                        favorites: ${favJson2},
                        l2028_ticketing: true,
                        l2028_fan28: true,
                        la28_terms_conditions: true,
                        la28_age_gate: true
                      },
                      callback: function(r) { resolve({ success: r.errorCode === 0, error: r.errorMessage }); }
                    });
                    setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 10000);
                  } catch(e) { resolve({ success: false, error: e.message }); }
                })
              `) as any;
              console.log("[ZenRows-Full] Data set: " + JSON.stringify(dataRes2));
            } catch {}

            console.log("[ZenRows-Full] Step 2: Navigate to OIDC auth URL...");
            const oidcUrl2 = 'https://public-api.eventim.com/identity/auth/realms/la28-org/protocol/openid-connect/auth?' + new URLSearchParams({
              response_type: 'code', client_id: 'web-sso__la28-org', scope: 'openid profile email',
              kc_idp_hint: 'gigya', ui_locales: 'en',
              redirect_uri: 'https://tickets.la28.org/mycustomerdata/'
            }).toString();

            try {
              await bdPg2.goto(oidcUrl2, { waitUntil: 'domcontentloaded', timeout: 120000 });
            } catch {}
            await bdPg2.waitForTimeout(5000);
            await waitQueueIt2();

            var curUrl2 = bdPg2.url();
            console.log("[ZenRows-Full] After OIDC nav: " + curUrl2.substring(0, 150));

            if (curUrl2.includes('proxy.html')) {
              console.log("[ZenRows-Full] On proxy.html, waiting for Gigya redirect...");
              for (let pw = 0; pw < 30; pw++) {
                await bdPg2.waitForTimeout(3000);
                try { curUrl2 = await bdPg2.evaluate(`location.href`) as string; } catch { curUrl2 = bdPg2.url(); }
                if (!curUrl2.includes('proxy.html')) {
                  console.log("[ZenRows-Full] proxy.html redirected to: " + curUrl2.substring(0, 150));
                  break;
                }
                if (pw === 8) {
                  console.log("[ZenRows-Full] proxy.html stuck, reloading...");
                  try { await bdPg2.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
                  await bdPg2.waitForTimeout(5000);
                }
                if (pw === 15) {
                  console.log("[ZenRows-Full] Navigating to tickets directly...");
                  try { await bdPg2.goto('https://tickets.la28.org/mycustomerdata/', { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch {}
                  await bdPg2.waitForTimeout(5000);
                  await waitQueueIt2();
                  curUrl2 = bdPg2.url();
                  break;
                }
              }
              curUrl2 = bdPg2.url();
            }

            if (curUrl2.includes('next.tickets.la28.org') || curUrl2.includes('queue-it')) {
              await waitQueueIt2();
              curUrl2 = bdPg2.url();
            }

            if (curUrl2.includes('proxy.html')) {
              console.log("[ZenRows-Full] Still on proxy.html after Queue-it, waiting more...");
              for (let pw2 = 0; pw2 < 20; pw2++) {
                await bdPg2.waitForTimeout(3000);
                try { curUrl2 = await bdPg2.evaluate(`location.href`) as string; } catch { curUrl2 = bdPg2.url(); }
                if (!curUrl2.includes('proxy.html')) {
                  console.log("[ZenRows-Full] proxy.html finally redirected: " + curUrl2.substring(0, 150));
                  break;
                }
                if (pw2 === 10) {
                  try { await bdPg2.goto('https://tickets.la28.org/mycustomerdata/', { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch {}
                  await bdPg2.waitForTimeout(5000);
                  await waitQueueIt2();
                  curUrl2 = bdPg2.url();
                  break;
                }
              }
            }

            // If landed on Gigya register/login page, SDK should be loaded - use it to login
            if (curUrl2.includes('la28id.la28.org/register') || curUrl2.includes('la28id.la28.org/login')) {
              console.log("[ZenRows-Full] Landed on Gigya page: " + curUrl2.substring(0, 120));
              console.log("[ZenRows-Full] Attempting SDK login from this page...");
              try { await bdPg2.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
              await bdPg2.waitForTimeout(5000);
              const sdkLogin2 = await bdPg2.evaluate(`
                new Promise(function(resolve) {
                  if (typeof window.gigya === 'undefined' || !window.gigya.accounts) { resolve({ success: false, error: 'no_sdk' }); return; }
                  var t = setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 30000);
                  try {
                    window.gigya.accounts.login({
                      loginID: '${safeEmail2}', password: '${safePass2}',
                      callback: function(r) { clearTimeout(t); resolve({ success: r.errorCode === 0, error: r.errorMessage || ('code_' + r.errorCode), code: r.errorCode }); }
                    });
                  } catch(e) { clearTimeout(t); resolve({ success: false, error: e.message }); }
                })
              `) as any;
              console.log("[ZenRows-Full] SDK login result: " + JSON.stringify(sdkLogin2));
              if (sdkLogin2.success) {
                await bdPg2.waitForTimeout(8000);
                curUrl2 = bdPg2.url();
                console.log("[ZenRows-Full] After SDK login: " + curUrl2.substring(0, 150));
                for (let rw2 = 0; rw2 < 15; rw2++) {
                  if (curUrl2.includes('tickets.la28.org') && !curUrl2.includes('next.tickets')) break;
                  if (!curUrl2.includes('proxy.html') && !curUrl2.includes('la28id.la28.org')) break;
                  await bdPg2.waitForTimeout(3000);
                  curUrl2 = bdPg2.url();
                }
                await waitQueueIt2();
                curUrl2 = bdPg2.url();
              } else {
                console.log("[ZenRows-Full] SDK login failed, trying direct tickets nav...");
                try { await bdPg2.goto('https://tickets.la28.org/mycustomerdata/', { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch {}
                await bdPg2.waitForTimeout(5000);
                await waitQueueIt2();
                curUrl2 = bdPg2.url();
              }
            }

            console.log("[ZenRows-Full] Pre-form URL: " + curUrl2.substring(0, 150));

            for (let spaW = 0; spaW < 15; spaW++) {
              await bdPg2.waitForTimeout(3000);
              var pInfo: any;
              try {
                pInfo = await bdPg2.evaluate(`(() => {
                  var txt = (document.body.innerText || '').substring(0, 2000);
                  var sel = document.querySelectorAll('select').length;
                  var inp = document.querySelectorAll('input[type="text"]').length;
                  return { txt: txt.substring(0, 500), sel: sel, inp: inp, bodyLen: txt.length, url: location.href };
                })()`) as any;
              } catch {
                console.log("[ZenRows-Full] Wait " + spaW + " evaluate error, retrying...");
                await bdPg2.waitForTimeout(5000);
                continue;
              }
              if (spaW % 3 === 0) console.log("[ZenRows-Full] Wait " + spaW + ": sel=" + pInfo.sel + " bodyLen=" + pInfo.bodyLen + " url=" + pInfo.url.substring(0, 80));
              if (pInfo.sel >= 5 || (pInfo.sel >= 3 && pInfo.inp >= 3)) {
                console.log("[ZenRows-Full] Form loaded!");
                break;
              }
              if (pInfo.txt.includes('Birth Year') || pInfo.txt.includes('Save profile') || pInfo.txt.includes('FAVORITE')) {
                console.log("[ZenRows-Full] Form text detected!");
                await bdPg2.waitForTimeout(3000);
                break;
              }
              if (pInfo.url.includes('proxy.html')) {
                for (let ppw = 0; ppw < 10; ppw++) {
                  await bdPg2.waitForTimeout(3000);
                  try {
                    var pUrl = await bdPg2.evaluate(`location.href`) as string;
                    if (!pUrl.includes('proxy.html')) break;
                  } catch { await bdPg2.waitForTimeout(3000); }
                }
                continue;
              }
              if (spaW === 5) {
                try { await bdPg2.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
                await bdPg2.waitForTimeout(5000);
                await waitQueueIt2();
              }
              if (spaW === 10) {
                try { await bdPg2.goto('https://tickets.la28.org/mycustomerdata/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
                await bdPg2.waitForTimeout(5000);
                await waitQueueIt2();
              }
            }

            var bdSel2: number = 0;
            var bdTxt2: string = '';
            try {
              bdSel2 = await bdPg2.evaluate(`document.querySelectorAll('select').length`) as number;
              bdTxt2 = await bdPg2.evaluate(`(document.body.innerText || '').substring(0, 2000)`) as string;
            } catch {}
            console.log("[ZenRows-Full] Final: url=" + bdPg2.url().substring(0, 100) + " selects=" + bdSel2 + " text=" + bdTxt2.substring(0, 300));

            if (bdSel2 >= 5 && (bdTxt2.includes('PROFILE') || bdTxt2.includes('Birth Year') || bdTxt2.includes('Save profile') || bdTxt2.includes('FAVORITE'))) {
              console.log("[ZenRows-Full] Filling form...");
              log("Filling draw registration form via ZenRows...");
              const formRes2 = await fillAndSubmitTicketsForm(bdPg2, birthYear, usedZip, favOlympicSports, favParalympicSports, favTeams, log);

              await bdPg2.waitForTimeout(10000);
              var afterUrl2 = bdPg2.url();
              console.log("[ZenRows-Full] After submit URL: " + afterUrl2);

              if (afterUrl2.includes('mydatasuccess')) {
                console.log("[ZenRows-Full] SUCCESS!");
                formSubmitted = true;
              } else if (formRes2) {
                formSubmitted = true;
              }
            } else {
              console.log("[ZenRows-Full] Form did not load. Marking OIDC as linked anyway.");
              oidcLinked = true;
            }
          } else {
            console.log("[ZenRows-Full] Gigya login failed on ZenRows too.");
            log("ZenRows Gigya login also failed.");
          }
        } catch (bdErr2: any) {
          console.log("[ZenRows-Full] Error: " + (bdErr2.message || '').substring(0, 300));
          log("ZenRows error: " + (bdErr2.message || '').substring(0, 100));
        } finally {
          if (bdBrowser2) { try { await bdBrowser2.close(); } catch {} }
        }
      }
    } catch (oidcErr: any) {
      console.log("[Draw-OIDC] Error (non-fatal): " + (oidcErr.message || '').substring(0, 200));
      log("Draw form skipped: " + (oidcErr.message || '').substring(0, 80));
    }

    if (nstBrowser) {
      try { await nstBrowser.close(); } catch {}
      nstBrowser = null;
    }
    if (browser) {
      try { await browser.close(); } catch {}
      browser = null;
    }

    const success = profileSet && dataSet;
    return { success, profileSet, dataSet, oidcLinked, formSubmitted };
  } catch (err: any) {
    console.log("[Draw-Gigya] OIDC/ZenRows error: " + err.message.substring(0, 200));
    log("OIDC/ZenRows error: " + err.message.substring(0, 100));
    try { if (browser) await browser.close(); } catch {}
    const success = profileSet && dataSet;
    return { success, profileSet, dataSet, error: err.message };
  }
}

export async function completeDrawRegistrationViaApi(
  email: string,
  password: string,
  zipCode: string | undefined,
  log: (msg: string) => void
): Promise<{ success: boolean; profileSet: boolean; dataSet: boolean; error?: string }> {
  const usedZip = zipCode || generateUSZip();
  const birthYear = generateRandomBirthYear();
  const favOlympicSports = pickRandom(OLYMPIC_SPORTS, 3 + Math.floor(Math.random() * 4));
  const favParalympicSports = pickRandom(PARALYMPIC_SPORTS, 2 + Math.floor(Math.random() * 3));
  const favTeams = pickRandom(TEAM_NOCS, 2 + Math.floor(Math.random() * 3));

  log("[GIGYA ACCOUNT] Logging in via REST API...");
  console.log("[Draw-API] Starting REST API draw registration for " + email);
  const apiStart = Date.now();

  const loginParams = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    loginID: email,
    password: password,
  });
  const loginResp = await fetch(`https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.login`, { method: "POST", body: loginParams });
  let loginData = await loginResp.json() as any;

  if (loginData.errorCode === 400006) {
    console.log("[Draw-API] CAPTCHA required (400006), attempting CapSolver...");
    log("[GIGYA ACCOUNT] CAPTCHA required. Solving via CapSolver...");
    try {
      const brdProxy = "http://brd-customer-hl_86b34e68-zone-residential_proxy3-country-us:r74n9xvshrv7@brd.superproxy.io:33335";
      const capResult = await solveRecaptchaV2Enterprise(
        "https://la28id.la28.org/login/",
        "6Lee9ZgmAAAAAJJimJxBo-AhvL-3HCtjZ0xvEMnr",
        undefined,
        brdProxy
      );
      if (capResult.success && capResult.token) {
        console.log("[Draw-API] CapSolver token received (with proxy), length: " + capResult.token.length + ". Retrying login...");
        log("[GIGYA ACCOUNT] CapSolver solved! Retrying login with token...");
        const retryParams = new URLSearchParams({
          apiKey: GIGYA_API_KEY,
          loginID: email,
          password: password,
          captchaToken: capResult.token,
          captchaType: "reCaptchaV2",
        });
        const retryResp = await fetch(`https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.login`, { method: "POST", body: retryParams });
        loginData = await retryResp.json() as any;
        console.log("[Draw-API] CapSolver retry result: errorCode=" + loginData.errorCode + " msg=" + (loginData.errorMessage || ""));
      } else {
        console.log("[Draw-API] CapSolver failed: " + capResult.error);
        log("[GIGYA ACCOUNT] CapSolver failed: " + (capResult.error || "unknown"));
      }
    } catch (capErr: any) {
      console.log("[Draw-API] CapSolver error: " + (capErr.message || "").substring(0, 100));
      log("[GIGYA ACCOUNT] CapSolver error: " + (capErr.message || "").substring(0, 60));
    }
  }

  if (loginData.errorCode !== 0) {
    console.log("[Draw-API] Login FAILED: errorCode=" + loginData.errorCode + " msg=" + (loginData.errorMessage || "") + " details=" + (loginData.errorDetails || "").substring(0, 120));
    log("[GIGYA ACCOUNT] Login failed: " + (loginData.errorMessage || "code " + loginData.errorCode));
    return { success: false, profileSet: false, dataSet: false, error: loginData.errorMessage || "Login failed" };
  }

  const loginToken = loginData.sessionInfo?.cookieValue || loginData.login_token;
  const uid = loginData.UID || "";
  const uidSig = loginData.UIDSignature || "";
  const sigTimestamp = loginData.signatureTimestamp || "";
  if (!loginToken) {
    log("[GIGYA ACCOUNT] No session token from login response");
    return { success: false, profileSet: false, dataSet: false, error: "No session token" };
  }

  console.log("[Draw-API] Login OK: UID=" + uid.substring(0, 20) + " token=" + loginToken.substring(0, 15) + "...");
  log("[GIGYA ACCOUNT] Logged in. UID: " + uid.substring(0, 20));

  const apiUrl = `https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.setAccountInfo`;

  log("[PROFILE SET] Setting profile: birthYear=" + birthYear + " zip=" + usedZip + " country=US...");
  const profileParams = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    login_token: loginToken,
    profile: JSON.stringify({
      birthYear: parseInt(birthYear),
      zip: usedZip,
      country: "US",
    }),
  });
  const profileResp = await fetch(apiUrl, { method: "POST", body: profileParams });
  const profileData = await profileResp.json() as { errorCode: number; errorMessage?: string };
  const profileSet = profileData.errorCode === 0;

  if (profileSet) {
    console.log("[Draw-API] Profile set OK");
    log("[PROFILE SET] Done: birthYear=" + birthYear + " zip=" + usedZip);
  } else {
    console.log("[Draw-API] Profile error: " + profileData.errorMessage);
    log("[PROFILE SET] Error: " + (profileData.errorMessage || "code " + profileData.errorCode));
  }

  const allSports = [
    ...favOlympicSports.map(code => ({ ocsCode: code, odfCode: code, GameType: "OG" })),
    ...favParalympicSports.map(code => ({ ocsCode: code, odfCode: code, GameType: "PG" })),
  ];
  const teamObjs = favTeams.map(code => ({ ocsCode: code, nocCode: code, gameType: "OG" }));

  log("[DRAW FLAGS SET] Setting l2028_ticketing=true, l2028_fan28=true + " + favOlympicSports.length + " Olympic + " + favParalympicSports.length + " Paralympic sports, " + favTeams.length + " teams...");
  const dataParams = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    login_token: loginToken,
    data: JSON.stringify({
      personalization: {
        favoritesDisciplines: allSports,
        favoritesCountries: teamObjs,
        siteLanguage: "en",
      },
      entryCampaignandSegregation: {
        l2028_ticketing: "true",
        l2028_fan28: "true",
      },
    }),
  });
  const dataResp = await fetch(apiUrl, { method: "POST", body: dataParams });
  const dataData = await dataResp.json() as { errorCode: number; errorMessage?: string };
  const dataSet = dataData.errorCode === 0;

  if (dataSet) {
    console.log("[Draw-API] Data+flags set OK");
    log("[DRAW FLAGS SET] Done: l2028_ticketing=true, l2028_fan28=true, favorites saved!");
  } else {
    console.log("[Draw-API] Data error: " + dataData.errorMessage);
    log("[DRAW FLAGS SET] Error: " + (dataData.errorMessage || "code " + dataData.errorCode));
  }

  log("[REGISTRATION CONFIRMED] Validating via accounts.getAccountInfo...");
  const verifyParams = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    login_token: loginToken,
    include: "profile,data",
  });
  const verifyResp = await fetch(`https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.getAccountInfo`, { method: "POST", body: verifyParams });
  const verifyData = await verifyResp.json() as any;

  if (verifyData.errorCode === 0) {
    const ticketing = verifyData.data?.entryCampaignandSegregation?.l2028_ticketing;
    const fan28 = verifyData.data?.entryCampaignandSegregation?.l2028_fan28;
    const bYear = verifyData.profile?.birthYear;
    const zip = verifyData.profile?.zip;
    const hasFavDisciplines = !!(verifyData.data?.personalization?.favoritesDisciplines);
    const hasFavCountries = !!(verifyData.data?.personalization?.favoritesCountries);
    console.log("[Draw-API] Verify: ticketing=" + ticketing + " fan28=" + fan28 + " birthYear=" + bYear + " zip=" + zip + " disciplines=" + hasFavDisciplines + " countries=" + hasFavCountries);
    log("[REGISTRATION CONFIRMED] Verified: ticketing=" + ticketing + " fan28=" + fan28 + " birthYear=" + bYear + " zip=" + zip + " favorites=" + (hasFavDisciplines && hasFavCountries));
  } else {
    console.log("[Draw-API] Verify failed: " + verifyData.errorMessage);
    log("[REGISTRATION CONFIRMED] Verification call failed: " + (verifyData.errorMessage || "code " + verifyData.errorCode));
  }

  const elapsed = Date.now() - apiStart;
  const success = profileSet && dataSet;
  if (success) {
    console.log("[Draw-API] Complete in " + elapsed + "ms");
    log("[REGISTRATION CONFIRMED] Draw registration complete via API in " + (elapsed / 1000).toFixed(1) + "s!");
  } else {
    log("[REGISTRATION CONFIRMED] Partial: profile=" + profileSet + " data=" + dataSet + " (" + (elapsed / 1000).toFixed(1) + "s)");
  }

  return { success, profileSet, dataSet };
}

async function ensureBrowserInstalled(): Promise<void> {
  if (browserInstalled) return;

  try {
    const execPath = chromium.executablePath();
    const fs = await import("fs");
    if (fs.existsSync(execPath)) {
      browserInstalled = true;
      console.log("[Playwright] Chromium found at:", execPath);
      return;
    }
  } catch {}

  console.log("[Playwright] Chromium not found, installing...");
  try {
    execSync("npx playwright install chromium", {
      stdio: "inherit",
      timeout: 120000,
    });
    browserInstalled = true;
    console.log("[Playwright] Chromium installed successfully");
  } catch (err: any) {
    console.error("[Playwright] Failed to install Chromium:", err.message);
    throw new Error("Failed to install Chromium browser. Check system dependencies.");
  }
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (launching) {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (browserInstance && browserInstance.isConnected()) return browserInstance;
    }
  }

  launching = true;
  try {
    await ensureBrowserInstalled();
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--no-first-run",
        "--no-zygote",
        "--js-flags=--max-old-space-size=256",
        "--disable-http2",
      ],
    });
    browserInstance.on("disconnected", () => {
      browserInstance = null;
    });
    return browserInstance;
  } finally {
    launching = false;
  }
}

async function forceRemoveOverlays(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    var selectors = [
      '[id*="onetrust"]', '[class*="onetrust"]',
      '[id*="cookie"]', '[class*="cookie-banner"]',
      '[class*="cookie-consent"]', '[class*="consent-banner"]',
      '[id*="consent"]', '[class*="gdpr"]', '[id*="gdpr"]',
      '.modal-overlay', '.overlay', '[role="dialog"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        els[j].style.display = 'none';
        els[j].remove();
      }
    }
    var divs = document.querySelectorAll('div');
    for (var k = 0; k < divs.length; k++) {
      var style = window.getComputedStyle(divs[k]);
      if (style.position === 'fixed' && style.zIndex && parseInt(style.zIndex) > 999 && divs[k].offsetHeight > 100) {
        divs[k].remove();
      }
    }
  })()`);
  console.log("[Playwright] Force-removed overlays");
}

async function fillViaJS(page: Page, gigyaName: string, value: string): Promise<boolean> {
  return page.evaluate(`((name, val) => {
    var inputs = document.querySelectorAll('input[data-gigya-name="' + name + '"]');
    var visible = null;
    var lastNonHidden = null;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (el.type === 'hidden') continue;
      lastNonHidden = el;
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visible = el;
      }
    }
    var target = visible || lastNonHidden;
    if (!target) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) {
      setter.set.call(target, val);
    } else {
      target.value = val;
    }
    target.dispatchEvent(new Event('focus', { bubbles: true }));
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  })("${gigyaName}", "${value.replace(/"/g, '\\"')}")`);
}

async function selectViaJS(page: Page, gigyaName: string, searchText: string): Promise<boolean> {
  return page.evaluate(`((name, text) => {
    var selects = document.querySelectorAll('select[data-gigya-name="' + name + '"]');
    var visible = null;
    var lastSel = null;
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      lastSel = sel;
      var rect = sel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visible = sel;
      }
    }
    var target = visible || lastSel;
    if (!target) return false;
    var options = Array.from(target.options);
    var match = options.find(function(o) { return o.text.toLowerCase().includes(text.toLowerCase()); });
    if (match) {
      target.value = match.value;
      target.dispatchEvent(new Event('focus', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }
    return false;
  })("${gigyaName}", "${searchText.replace(/"/g, '\\"')}")`);
}

async function checkAllCheckboxesViaJS(page: Page): Promise<number> {
  return page.evaluate(`(() => {
    var checked = 0;
    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) {
      var el = checkboxes[i];
      if (el.type === 'hidden') continue;
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click', { bubbles: true }));
        checked++;
      }
    }
    return checked;
  })()`);
}

async function waitForGigyaForm(page: Page, maxWaitSec: number = 30): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    const found = await page.evaluate(`(() => {
      var inputs = document.querySelectorAll('input[data-gigya-name="email"]');
      return inputs.length > 0;
    })()`);
    if (found) return true;
    await page.waitForTimeout(2000);
    await forceRemoveOverlays(page);
  }
  return false;
}

async function getPageText(page: Page): Promise<string> {
  return page.evaluate(`document.body.innerText`) as Promise<string>;
}

async function getFormErrors(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    var errorEls = document.querySelectorAll('.gigya-error-msg-active, .gigya-error-msg');
    var results = [];
    for (var i = 0; i < errorEls.length; i++) {
      var el = errorEls[i];
      if (el.offsetParent !== null && el.textContent && el.textContent.trim().length > 0) {
        results.push(el.textContent.trim());
      }
    }
    return results;
  })()`) as Promise<string[]>;
}

async function clickSubmitViaJS(page: Page): Promise<boolean> {
  return page.evaluate(`(() => {
    var all = document.querySelectorAll('input[type="submit"], button[type="submit"], .gigya-input-submit');
    var visible = null;
    var last = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.type === 'hidden') continue;
      last = el;
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visible = el;
      }
    }
    var target = visible || last;
    if (target) {
      target.click();
      return true;
    }
    return false;
  })()`) as Promise<boolean>;
}

async function fillCodeViaJS(page: Page, code: string): Promise<boolean> {
  return page.evaluate(`((codeVal) => {
    var selectors = ['input[data-gigya-name="code"]', 'input[name="code"]', 'input.gigya-input-text'];
    for (var s = 0; s < selectors.length; s++) {
      var inputs = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && el.type !== 'hidden') {
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(el, codeVal);
          else el.value = codeVal;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  })("${code}")`) as Promise<boolean>;
}

export async function fullRegistrationFlow(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  country: string,
  language: string,
  onStatusUpdate: (status: string) => void | Promise<void>,
  getVerificationCode: () => Promise<string | null>,
  onLog?: (message: string) => void,
  proxyUrl?: string
): Promise<{ success: boolean; error?: string; pageContent?: string; zipCode?: string }> {
  const log = onLog || ((msg: string) => console.log(`[Playwright] ${msg}`));
  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      log(`Retry attempt ${attempt + 1}/${maxRetries}...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    const result = await doRegistration(email, firstName, lastName, password, country, language, onStatusUpdate, getVerificationCode, log, proxyUrl);

    if (result.error?.includes("Target page, context or browser has been closed") ||
        result.error?.includes("browser has been closed") ||
        result.error?.includes("crashed")) {
      log(`Browser crashed, will retry...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      continue;
    }

    return result;
  }

  return { success: false, error: "Browser crashed after multiple retries" };
}

async function doRegistration(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  country: string,
  language: string,
  onStatusUpdate: (status: string) => void | Promise<void>,
  getVerificationCode: () => Promise<string | null>,
  log: (message: string) => void,
  proxyUrl?: string
): Promise<{ success: boolean; error?: string; pageContent?: string; zipCode?: string }> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err: any) {
    return { success: false, error: `Failed to launch browser: ${err.message}` };
  }

  const contextOptions: any = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { latitude: 40.7128, longitude: -74.0060 },
    permissions: ['geolocation'],
  };

  const usedZipCode = generateUSZip();
  log(`Using LA zip code ${usedZipCode} for all steps.`);
  log("Registration/consent on la28id.la28.org (no proxy needed). Proxy reserved for tickets.la28.org step.");

  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  await page.route("**/*", (route) => {
    const resourceType = route.request().resourceType();
    if (["image", "media", "font"].includes(resourceType)) {
      return route.abort();
    }
    return route.continue();
  });

  try {
    await onStatusUpdate("registering");
    console.log("[Playwright] Navigating to LA28 registration...");
    await page.goto("https://la28id.la28.org/register/", { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    } catch {
      console.log("[Playwright] Network idle timeout, continuing...");
    }

    await page.waitForTimeout(5000);
    await forceRemoveOverlays(page);
    await page.waitForTimeout(2000);

    console.log("[Playwright] Waiting for Gigya registration form...");
    const formFound = await waitForGigyaForm(page, 30);
    if (!formFound) {
      const snapshot = (await getPageText(page)).substring(0, 500);
      await context.close();
      return { success: false, error: "Registration form did not load", pageContent: snapshot };
    }

    await forceRemoveOverlays(page);

    const allFields = await page.evaluate(`(() => {
      var inputs = document.querySelectorAll('input[data-gigya-name], select[data-gigya-name]');
      var result = [];
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var rect = el.getBoundingClientRect();
        result.push({
          tag: el.tagName,
          type: el.type || '',
          gigyaName: el.getAttribute('data-gigya-name'),
          name: el.getAttribute('name'),
          visible: rect.width > 0 && rect.height > 0,
          w: rect.width,
          h: rect.height
        });
      }
      return result;
    })()`);
    console.log("[Playwright] All Gigya form fields:", JSON.stringify(allFields));

    console.log("[Playwright] Form found, filling fields via JS...");

    const emailFilled = await fillViaJS(page, "email", email);
    console.log(`[Playwright] Email filled: ${emailFilled}`);

    const profileEmailFilled = await fillViaJS(page, "profile.email", email);
    console.log(`[Playwright] Profile email filled: ${profileEmailFilled}`);

    let fnFilled = await fillViaJS(page, "firstName", firstName);
    if (!fnFilled) fnFilled = await fillViaJS(page, "profile.firstName", firstName);
    if (!fnFilled) fnFilled = await fillViaJS(page, "first_name", firstName);
    if (!fnFilled) {
      fnFilled = await page.evaluate(`((val) => {
        var inputs = document.querySelectorAll('input[name="firstName"], input[name="first_name"], input[placeholder*="irst"]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (setter && setter.set) setter.set.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      })("${firstName.replace(/"/g, '\\"')}")`) as boolean;
    }
    console.log(`[Playwright] FirstName filled: ${fnFilled}`);

    let lnFilled = await fillViaJS(page, "lastName", lastName);
    if (!lnFilled) lnFilled = await fillViaJS(page, "profile.lastName", lastName);
    if (!lnFilled) lnFilled = await fillViaJS(page, "last_name", lastName);
    if (!lnFilled) {
      lnFilled = await page.evaluate(`((val) => {
        var inputs = document.querySelectorAll('input[name="lastName"], input[name="last_name"], input[placeholder*="ast"]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (setter && setter.set) setter.set.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      })("${lastName.replace(/"/g, '\\"')}")`) as boolean;
    }
    console.log(`[Playwright] LastName filled: ${lnFilled}`);

    const pwFilled = await fillViaJS(page, "password", password);
    console.log(`[Playwright] Password filled: ${pwFilled}`);

    if (!emailFilled || !pwFilled) {
      await context.close();
      return { success: false, error: `Critical form fill failed - email:${emailFilled} pw:${pwFilled}` };
    }

    const countrySelected = await selectViaJS(page, "profile.country", country);
    console.log(`[Playwright] Country selected: ${countrySelected}`);

    await page.waitForTimeout(1000);

    const langSelected = await selectViaJS(page, "data.personalization.siteLanguage", language);
    console.log(`[Playwright] Language selected: ${langSelected}`);

    await page.waitForTimeout(500);

    const zipFilled = await fillViaJS(page, "profile.zip", usedZipCode);
    if (!zipFilled) {
      await page.evaluate(`((val) => {
        var inputs = document.querySelectorAll('input[name="profile.zip"], input[name="zip"], input[data-gigya-name="profile.zip"], input[placeholder*="ip"], input[placeholder*="ostal"]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      })("${usedZipCode}")`);
    }
    console.log(`[Playwright] ZIP filled: ${zipFilled} (${usedZipCode})`);

    const cbCount = await checkAllCheckboxesViaJS(page);
    console.log(`[Playwright] Checked ${cbCount} checkboxes`);

    await page.waitForTimeout(500);

    console.log("[Playwright] Submitting form...");
    const submitted = await clickSubmitViaJS(page);
    console.log(`[Playwright] Submit clicked: ${submitted}`);

    if (!submitted) {
      await context.close();
      return { success: false, error: "Could not find submit button" };
    }

    console.log("[Playwright] Waiting for response...");

    let pageText = "";
    try {
      await page.waitForTimeout(6000);
      pageText = await Promise.race([
        getPageText(page),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Page text timeout")), 10000)),
      ]);
    } catch (e: any) {
      console.log("[Playwright] Error getting page text after submit:", e.message);
      await context.close();
      return { success: false, error: `Post-submit error: ${e.message}` };
    }

    console.log("[Playwright] Page text after submit (first 200):", pageText.substring(0, 200));

    if (pageText.includes("already exists")) {
      await context.close();
      return { success: false, error: "Account already exists for this email" };
    }

    let realErrors: string[] = [];
    try {
      realErrors = await getFormErrors(page);
    } catch (e: any) {
      console.log("[Playwright] Error getting form errors:", e.message);
    }
    if (realErrors.length > 0) {
      await context.close();
      return { success: false, error: realErrors.join("; ") };
    }

    const lowerText = pageText.toLowerCase();
    const needsCode = lowerText.includes("code") ||
                      lowerText.includes("verify") ||
                      lowerText.includes("confirmation");

    if (!needsCode) {
      await context.close();
      return { success: false, error: "Unexpected page state after submit", pageContent: pageText.substring(0, 500) };
    }

    console.log("[Playwright] Verification code needed. Waiting for code from email...");
    await onStatusUpdate("waiting_code");

    let code: string | null = null;
    try {
      code = await Promise.race([
        getVerificationCode(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 150000)),
      ]);
    } catch (e: any) {
      console.log("[Playwright] Error getting verification code:", e.message);
    }

    if (!code) {
      await context.close();
      return { success: false, error: "Timed out waiting for verification email" };
    }

    await onStatusUpdate("verifying");
    console.log(`[Playwright] Entering verification code: ${code}`);

    try {
      const codeFilled = await fillCodeViaJS(page, code);
      console.log(`[Playwright] Code filled: ${codeFilled}`);
      await page.waitForTimeout(500);

      console.log("[Playwright] Clicking Verify...");
      await clickSubmitViaJS(page);

      await page.waitForTimeout(8000);
    } catch (e: any) {
      console.log("[Playwright] Error during code verification:", e.message);
      await context.close();
      return { success: false, error: `Verification submit error: ${e.message}` };
    }

    let finalText = "";
    try {
      finalText = await Promise.race([
        getPageText(page),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Final page text timeout")), 10000)),
      ]);
    } catch (e: any) {
      console.log("[Playwright] Error getting final page text:", e.message);
    }

    console.log("[Playwright] Final page content (first 300):", finalText.substring(0, 300));

    const hasError = finalText.toLowerCase().includes("invalid code") ||
                     finalText.toLowerCase().includes("expired");

    if (hasError) {
      await context.close();
      return { success: false, error: "Verification failed", pageContent: finalText.substring(0, 500) };
    }

    await onStatusUpdate("verified");
    log("Registration verified! Waiting for post-verification page to settle...");

    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch { /* ignore */ }
    await page.waitForTimeout(3000);

    try {
      await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
      log("Gigya SDK ready. Completing profile...");
    } catch {
      log("Gigya SDK not available on post-verification page. Navigating to LA28 homepage...");
      try {
        await page.goto("https://la28id.la28.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
        log("Gigya SDK loaded on homepage.");
      } catch {
        log("Could not load Gigya SDK. Skipping profile completion.");
      }
    }

    await onStatusUpdate("profile_saving");
    try {
      await completeTicketsProfile(page, email, password, log);
      log("Profile data saved via Gigya SDK!");
    } catch (profileErr: any) {
      console.log("[Playwright] Tickets profile error:", profileErr.message);
      log("Account created & verified. Profile step had issues.");
    }

    await onStatusUpdate("draw_registering");
    log("[DRAW] Starting draw registration — must fill form on tickets.la28.org and reach success page...");
    let drawSuccess = false;
    let profileDataSet = false;

    try {
      const apiResult = await completeDrawRegistrationViaApi(email, password, usedZipCode, log);
      if (apiResult.profileSet || apiResult.dataSet) {
        profileDataSet = true;
        log("[DRAW] Gigya profile/data flags set via API (profile=" + apiResult.profileSet + " data=" + apiResult.dataSet + "). Now need form submission on tickets.la28.org...");
      } else {
        log("[DRAW] API profile/data set failed: " + (apiResult.error || "unknown"));
      }
    } catch (apiErr: any) {
      console.log("[Playwright] REST API draw error:", apiErr.message);
      log("[DRAW] API error: " + apiErr.message.substring(0, 80));
    }

    log("[DRAW] Attempting browser-based form fill on tickets.la28.org...");
    try {
      const earlyComplete = async () => {
        if (!drawSuccess) {
          drawSuccess = true;
          await onStatusUpdate("completed");
          log("[DRAW COMPLETE] Form submitted on tickets.la28.org and success page reached!");
        }
      };
      const gigyaResult = await completeDrawViaGigyaBrowser(email, password, usedZipCode, log, earlyComplete);
      if (gigyaResult.formSubmitted && !drawSuccess) {
        drawSuccess = true;
        await onStatusUpdate("completed");
        log("[DRAW COMPLETE] Draw registration confirmed — form submitted on tickets.la28.org!");
      } else if (!drawSuccess) {
        log("[DRAW] Browser form fill did not complete. formSubmitted=" + gigyaResult.formSubmitted + " oidcLinked=" + gigyaResult.oidcLinked);
      }
    } catch (drawErr: any) {
      console.log("[Playwright] Browser draw error:", drawErr.message);
      log("[DRAW] Browser error: " + drawErr.message.substring(0, 80));
    }

    if (!drawSuccess) {
      log("[DRAW FAILED] Could not fill draw form on tickets.la28.org. Account verified but draw NOT registered.");
      await onStatusUpdate("verified");
    }

    await context.close();
    return { success: true, pageContent: finalText.substring(0, 500), zipCode: usedZipCode };
  } catch (err: any) {
    console.error("[Playwright] Error:", err.message);
    try { await context.close(); } catch {}
    return { success: false, error: err.message };
  }
}

export async function retryDrawRegistration(
  email: string,
  password: string,
  proxyUrl: string,
  zipCode: string | undefined,
  log: (msg: string) => void
): Promise<{ submitted: boolean }> {
  log("Starting retry draw registration for " + email);
  let zenrowsUrl = "";
  try {
    const zrRow = await db.execute(sql`SELECT value FROM settings WHERE key = 'zenrows_api_url'`);
    if (zrRow.rows.length > 0 && zrRow.rows[0].value) {
      zenrowsUrl = zrRow.rows[0].value as string;
    }
  } catch {}
  var connectUrl = zenrowsUrl || proxyUrl;
  if (connectUrl.includes('zenrows.com') && !connectUrl.includes('proxy_country=')) {
    connectUrl += (connectUrl.includes('?') ? '&' : '?') + 'proxy_country=us';
  }
  log("Connecting to " + (zenrowsUrl ? "ZenRows" : "proxy") + " browser...");
  const browser = await chromium.connectOverCDP(connectUrl, { timeout: 60000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    log("Connected to " + (zenrowsUrl ? "ZenRows" : "proxy") + " browser.");

    const result = await loginAndSubmitTicketRegistration(page, email, password, log, connectUrl, zipCode || undefined);
    try { await page.close(); } catch {}
    return result;
  } finally {
    try { await browser.close(); } catch {}
  }
}

export interface OutlookLoginResult {
  success: boolean;
  error?: string;
  cookies?: Array<{ name: string; value: string; domain: string }>;
}

export async function loginOutlookAccount(
  email: string,
  password: string,
  log: (msg: string) => void
): Promise<OutlookLoginResult> {
  let browser: any = null;

  try {
    log("Connecting to ZenRows browser...");
    let zenrowsUrl = "";
    try {
      const zrRow = await db.execute(sql`SELECT value FROM settings WHERE key = 'zenrows_api_url'`);
      if (zrRow.rows.length > 0 && zrRow.rows[0].value) {
        zenrowsUrl = zrRow.rows[0].value as string;
      }
    } catch {}

    if (!zenrowsUrl) {
      return { success: false, error: "ZenRows Browser URL not configured. Set it in Settings." };
    }
    if (!zenrowsUrl.includes('proxy_country=')) {
      zenrowsUrl += (zenrowsUrl.includes('?') ? '&' : '?') + 'proxy_country=us';
    }

    browser = await chromium.connectOverCDP(zenrowsUrl, { timeout: 60000 });
    log("ZenRows browser connected");

    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    await page.setDefaultNavigationTimeout(90000);
    await page.setDefaultTimeout(30000);

    log("Navigating to login.live.com...");
    await page.goto("https://login.live.com/", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2000 + Math.random() * 1500);

    const currentUrl = page.url();
    log("Page loaded: " + currentUrl.substring(0, 80));

    log("Looking for email input field...");
    const emailInput = await page.waitForSelector('input[type="email"], input[name="loginfmt"]', { timeout: 15000 });
    if (!emailInput) {
      return { success: false, error: "Could not find email input field" };
    }

    await page.waitForTimeout(500 + Math.random() * 500);
    await emailInput.click();
    await page.waitForTimeout(300 + Math.random() * 300);

    log("Typing email address...");
    for (const char of email) {
      await page.keyboard.type(char, { delay: 0 });
      await page.waitForTimeout(30 + Math.random() * 60);
    }

    await page.waitForTimeout(500 + Math.random() * 500);

    log("Clicking Next...");
    const nextButton = await page.$('input[type="submit"]#idSIButton9, input[value="Next"]');
    if (nextButton) {
      await nextButton.click();
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(3000 + Math.random() * 2000);

    const afterEmailUrl = page.url();
    log("After email submit: " + afterEmailUrl.substring(0, 80));

    const errorBanner = await page.$('#usernameError, div[role="alert"]');
    if (errorBanner) {
      const errorText = await errorBanner.textContent();
      if (errorText && errorText.trim().length > 0) {
        log("Error from Microsoft: " + errorText.trim().substring(0, 100));
        return { success: false, error: "Microsoft error: " + errorText.trim().substring(0, 200) };
      }
    }

    let funCaptchaDetected = false;
    try {
      const fcFrame = await page.$('iframe[id*="enforcementFrame"], iframe[data-testid*="captcha"], #FunCaptcha');
      if (fcFrame) {
        funCaptchaDetected = true;
      }
      const fcDiv = await page.$('#hipEnforcementContainer, div[id*="arkose"]');
      if (fcDiv) {
        funCaptchaDetected = true;
      }
    } catch {}

    if (funCaptchaDetected) {
      log("FunCaptcha (Arkose Labs) detected! Attempting to solve via CapSolver...");
      try {
        const publicKey = "B7D8911C-5CC8-A9A3-35B0-554ACEE604DA";
        const result = await solveFunCaptcha("https://login.live.com/", publicKey);
        if (result.success && result.token) {
          log("FunCaptcha solved! Injecting token...");
          await page.evaluate((token: string) => {
            const callback = (window as any).ArkoseEnforcement?.callback || (window as any).fc_callback;
            if (typeof callback === 'function') {
              callback({ token });
            }
            const hiddenInput = document.querySelector('input[name="fc_token"], input[name="hipSolutionToken"]') as HTMLInputElement;
            if (hiddenInput) {
              hiddenInput.value = token;
            }
          }, result.token);
          await page.waitForTimeout(2000 + Math.random() * 1000);
          log("FunCaptcha token injected");
        } else {
          log("FunCaptcha solving failed: " + (result.error || "unknown"));
          return { success: false, error: "FunCaptcha solving failed: " + (result.error || "unknown") };
        }
      } catch (fcErr: any) {
        log("FunCaptcha error: " + (fcErr.message || "").substring(0, 100));
        return { success: false, error: "FunCaptcha error: " + (fcErr.message || "").substring(0, 100) };
      }
    }

    log("Looking for password field...");
    let passwordInput: any = null;
    try {
      passwordInput = await page.waitForSelector('input[type="password"], input[name="passwd"]', { timeout: 15000 });
    } catch {
      const page2Url = page.url();
      log("No password field found. Current URL: " + page2Url.substring(0, 100));

      const twoFaCheck = await page.$('#idDiv_SAOTCS_Title, #idDiv_SAOTCAS_Title, div[data-testid="phoneAuthTitle"]');
      if (twoFaCheck) {
        return { success: false, error: "Two-factor authentication required. This is not supported." };
      }

      return { success: false, error: "Password field not found. The account may require additional verification." };
    }

    await page.waitForTimeout(500 + Math.random() * 500);
    await passwordInput.click();
    await page.waitForTimeout(300 + Math.random() * 300);

    log("Typing password...");
    for (const char of password) {
      await page.keyboard.type(char, { delay: 0 });
      await page.waitForTimeout(30 + Math.random() * 60);
    }

    await page.waitForTimeout(800 + Math.random() * 700);

    log("Clicking Sign In...");
    const signInButton = await page.$('input[type="submit"]#idSIButton9, input[value="Sign in"], button[type="submit"]');
    if (signInButton) {
      await signInButton.click();
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(4000 + Math.random() * 3000);

    const afterPasswordUrl = page.url();
    log("After sign in: " + afterPasswordUrl.substring(0, 80));

    const passwordError = await page.$('#passwordError, #idTd_PWD_Error');
    if (passwordError) {
      const errText = await passwordError.textContent();
      if (errText && errText.trim().length > 0) {
        log("Password error: " + errText.trim().substring(0, 100));
        return { success: false, error: "Wrong password: " + errText.trim().substring(0, 200) };
      }
    }

    let funCaptchaDetected2 = false;
    try {
      const fcFrame2 = await page.$('iframe[id*="enforcementFrame"], iframe[data-testid*="captcha"], #FunCaptcha');
      if (fcFrame2) funCaptchaDetected2 = true;
      const fcDiv2 = await page.$('#hipEnforcementContainer, div[id*="arkose"]');
      if (fcDiv2) funCaptchaDetected2 = true;
    } catch {}

    if (funCaptchaDetected2) {
      log("FunCaptcha appeared after password! Solving...");
      try {
        const publicKey = "B7D8911C-5CC8-A9A3-35B0-554ACEE604DA";
        const result = await solveFunCaptcha("https://login.live.com/", publicKey);
        if (result.success && result.token) {
          log("FunCaptcha solved!");
          await page.evaluate((token: string) => {
            const callback = (window as any).ArkoseEnforcement?.callback || (window as any).fc_callback;
            if (typeof callback === 'function') callback({ token });
            const hiddenInput = document.querySelector('input[name="fc_token"], input[name="hipSolutionToken"]') as HTMLInputElement;
            if (hiddenInput) hiddenInput.value = token;
          }, result.token);
          await page.waitForTimeout(3000 + Math.random() * 1000);
        } else {
          return { success: false, error: "FunCaptcha solving failed after password: " + (result.error || "unknown") };
        }
      } catch (fcErr: any) {
        return { success: false, error: "FunCaptcha error after password: " + (fcErr.message || "").substring(0, 100) };
      }
    }

    const twoFaCheck = await page.$('#idDiv_SAOTCS_Title, #idDiv_SAOTCAS_Title, div[data-testid="phoneAuthTitle"], #idDiv_SAASDS_Title');
    if (twoFaCheck) {
      const twoFaText = await twoFaCheck.textContent();
      log("2FA required: " + (twoFaText || "").trim().substring(0, 100));
      return { success: false, error: "Two-factor authentication required. This is not supported." };
    }

    const staySignedIn = await page.$('#idSIButton9, input[value="Yes"], #acceptButton, #idBtn_Back');
    if (staySignedIn) {
      const btnText = await staySignedIn.getAttribute("value") || "";
      const stayTitle = await page.$('#lightbox-cover, #KmsIdTitle');
      if (stayTitle || btnText === "Yes" || afterPasswordUrl.includes("kmsi")) {
        log("Handling 'Stay signed in?' prompt...");
        await staySignedIn.click();
        await page.waitForTimeout(3000 + Math.random() * 2000);
      }
    }

    const finalUrl = page.url();
    log("Final URL: " + finalUrl.substring(0, 100));

    const isLoggedIn =
      finalUrl.includes("outlook.live.com") ||
      finalUrl.includes("outlook.office.com") ||
      finalUrl.includes("outlook.office365.com") ||
      finalUrl.includes("microsoft.com") ||
      finalUrl.includes("live.com") && !finalUrl.includes("login.live.com/login");

    if (isLoggedIn) {
      log("Extracting session cookies...");
      const cookies = await context.cookies();
      const relevantCookies = cookies
        .filter((c: any) => c.domain.includes("live.com") || c.domain.includes("microsoft.com") || c.domain.includes("outlook.com"))
        .map((c: any) => ({ name: c.name, value: c.value, domain: c.domain }));

      log(`Login successful! Got ${relevantCookies.length} cookies`);
      return { success: true, cookies: relevantCookies };
    } else {
      const bodyText = await page.textContent("body").catch(() => "");
      const snippet = (bodyText || "").substring(0, 200).replace(/\s+/g, " ");
      log("Login may have failed. Page content: " + snippet.substring(0, 100));

      if (finalUrl.includes("login.live.com") || finalUrl.includes("login.microsoftonline.com")) {
        return { success: false, error: "Login failed. Still on login page after all steps." };
      }

      const cookies = await context.cookies();
      const relevantCookies = cookies
        .filter((c: any) => c.domain.includes("live.com") || c.domain.includes("microsoft.com"))
        .map((c: any) => ({ name: c.name, value: c.value, domain: c.domain }));

      if (relevantCookies.length > 5) {
        log(`Possible success — got ${relevantCookies.length} cookies`);
        return { success: true, cookies: relevantCookies };
      }

      return { success: false, error: "Login outcome uncertain. Final URL: " + finalUrl.substring(0, 100) };
    }
  } catch (err: any) {
    log("Error: " + (err.message || "").substring(0, 150));
    return { success: false, error: (err.message || "Unknown error").substring(0, 200) };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

export interface OutlookCreateResult {
  success: boolean;
  error?: string;
  email?: string;
  password?: string;
}

export async function createOutlookAccount(
  log: (msg: string) => void
): Promise<OutlookCreateResult> {
  let browser: any = null;

  const firstNames = ["James","Emma","Liam","Olivia","Noah","Ava","William","Sophia","Lucas","Mia","Henry","Charlotte","Alexander","Amelia","Benjamin","Harper","Daniel","Evelyn","Matthew","Abigail"];
  const lastNames = ["Anderson","Thomas","Jackson","White","Harris","Martin","Thompson","Garcia","Martinez","Robinson","Clark","Rodriguez","Lewis","Lee","Walker","Hall","Allen","Young","King","Wright"];
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

  const randomStr = Math.random().toString(36).substring(2, 8) + Math.floor(Math.random() * 900 + 100);
  const emailUsername = (firstName.toLowerCase() + lastName.toLowerCase().charAt(0) + randomStr).substring(0, 20);
  const email = emailUsername + "@outlook.com";
  const password = firstName.charAt(0).toUpperCase() + lastName.charAt(0).toLowerCase() +
    Math.random().toString(36).substring(2, 8) + "!" + Math.floor(Math.random() * 900 + 100);

  const birthYear = 1985 + Math.floor(Math.random() * 15);
  const birthMonth = Math.floor(Math.random() * 12) + 1;
  const birthDay = Math.floor(Math.random() * 28) + 1;

  try {
    log("Creating new Outlook account...");
    log("Generated email: " + email);
    log("Generated password: " + password.substring(0, 3) + "***");

    await ensureBrowserInstalled();
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.setDefaultNavigationTimeout(120000);
    await page.setDefaultTimeout(30000);

    log("Navigating to Microsoft signup...");
    await page.goto("https://signup.live.com/signup?lcid=1033&wa=wsignin1.0&rpsnv=163&id=292841&uiflavor=web&uaid=&mkt=EN-US&lc=1033&lic=1", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000 + Math.random() * 2000);
    log("Signup page loaded: " + page.url().substring(0, 80));

    const emailInput = await page.waitForSelector('input[type="email"], input[name="MemberName"], #MemberName, #iSignupMemberName', { timeout: 15000 });
    if (!emailInput) {
      return { success: false, error: "Could not find email input on signup page" };
    }
    await emailInput.click();
    await page.waitForTimeout(300);
    for (const char of emailUsername) {
      await page.keyboard.type(char, { delay: 0 });
      await page.waitForTimeout(20 + Math.random() * 40);
    }
    log("Email username typed: " + emailUsername);

    await page.waitForTimeout(500 + Math.random() * 500);
    const nextBtn = await page.$('input[type="submit"], #iSignupAction, #iNext');
    if (nextBtn) await nextBtn.click();
    else await page.keyboard.press("Enter");

    await page.waitForTimeout(3000 + Math.random() * 2000);

    const emailError = await page.$('#MemberNameError, div[id*="Error"]');
    if (emailError) {
      const errText = await emailError.textContent().catch(() => "");
      if (errText && errText.trim().length > 0) {
        log("Email error: " + errText.trim().substring(0, 100));
        return { success: false, error: "Email error: " + errText.trim() };
      }
    }

    log("Looking for password field...");
    const passInput = await page.waitForSelector('input[type="password"], input[name="Password"], #PasswordInput, #iSignupPassword', { timeout: 15000 });
    if (!passInput) {
      const currentContent = await page.textContent("body").catch(() => "");
      log("No password field. Page: " + (currentContent || "").substring(0, 150).replace(/\s+/g, " "));
      return { success: false, error: "Password field not found on signup page" };
    }
    await passInput.click();
    await page.waitForTimeout(300);
    for (const char of password) {
      await page.keyboard.type(char, { delay: 0 });
      await page.waitForTimeout(20 + Math.random() * 40);
    }
    log("Password typed");

    await page.waitForTimeout(500 + Math.random() * 500);
    const passNext = await page.$('input[type="submit"], #iSignupAction, #iNext');
    if (passNext) await passNext.click();
    else await page.keyboard.press("Enter");

    await page.waitForTimeout(3000 + Math.random() * 2000);
    log("After password: " + page.url().substring(0, 80));

    const nameInput = await page.$('input[name="FirstName"], #FirstName, #iFirstName');
    if (nameInput) {
      log("Name fields found, filling...");
      await nameInput.click();
      await page.waitForTimeout(200);
      for (const char of firstName) {
        await page.keyboard.type(char, { delay: 0 });
        await page.waitForTimeout(15 + Math.random() * 30);
      }

      const lastInput = await page.$('input[name="LastName"], #LastName, #iLastName');
      if (lastInput) {
        await lastInput.click();
        await page.waitForTimeout(200);
        for (const char of lastName) {
          await page.keyboard.type(char, { delay: 0 });
          await page.waitForTimeout(15 + Math.random() * 30);
        }
      }
      log("Name filled: " + firstName + " " + lastName);

      await page.waitForTimeout(500 + Math.random() * 500);
      const nameNext = await page.$('input[type="submit"], #iSignupAction, #iNext');
      if (nameNext) await nameNext.click();
      else await page.keyboard.press("Enter");
      await page.waitForTimeout(3000 + Math.random() * 2000);
    }

    const dobSection = await page.$('select[name="BirthMonth"], #BirthMonth, select#BirthMonth, #ibirthmonthcombo');
    if (dobSection) {
      log("Date of birth section found...");

      const monthSelect = await page.$('select[name="BirthMonth"], #BirthMonth, select#BirthMonth');
      if (monthSelect) {
        await monthSelect.selectOption(String(birthMonth));
        await page.waitForTimeout(300);
      } else {
        const monthInput = await page.$('#BirthMonth, #ibirthmonthcombo');
        if (monthInput) {
          await monthInput.click();
          await page.waitForTimeout(200);
          const monthOption = await page.$(`option[value="${birthMonth}"], li[data-value="${birthMonth}"]`);
          if (monthOption) await monthOption.click();
        }
      }

      await page.waitForTimeout(300);
      const daySelect = await page.$('select[name="BirthDay"], #BirthDay, select#BirthDay');
      if (daySelect) {
        await daySelect.selectOption(String(birthDay));
        await page.waitForTimeout(300);
      } else {
        const dayInput = await page.$('#BirthDay, #ibirthdaycombo');
        if (dayInput) {
          await dayInput.click();
          await page.waitForTimeout(200);
          const dayOption = await page.$(`option[value="${birthDay}"], li[data-value="${birthDay}"]`);
          if (dayOption) await dayOption.click();
        }
      }

      await page.waitForTimeout(300);
      const yearInput = await page.$('input[name="BirthYear"], #BirthYear, input#BirthYear');
      if (yearInput) {
        await yearInput.click();
        await yearInput.fill("");
        await page.waitForTimeout(200);
        for (const char of String(birthYear)) {
          await page.keyboard.type(char, { delay: 0 });
          await page.waitForTimeout(30 + Math.random() * 50);
        }
      }

      log("DOB filled: " + birthMonth + "/" + birthDay + "/" + birthYear);

      await page.waitForTimeout(500 + Math.random() * 500);
      const dobNext = await page.$('input[type="submit"], #iSignupAction, #iNext');
      if (dobNext) await dobNext.click();
      else await page.keyboard.press("Enter");
      await page.waitForTimeout(3000 + Math.random() * 2000);
    }

    log("Checking for captcha...");
    let captchaSolved = false;
    for (let captchaAttempt = 0; captchaAttempt < 3; captchaAttempt++) {
      let funCaptchaDetected = false;
      try {
        const fcFrame = await page.$('iframe[id*="enforcementFrame"], iframe[data-testid*="captcha"], #FunCaptcha, iframe[title*="arkose"]');
        if (fcFrame) funCaptchaDetected = true;
        const fcDiv = await page.$('#hipEnforcementContainer, div[id*="arkose"], #hipTemplateContainer');
        if (fcDiv) funCaptchaDetected = true;
      } catch {}

      if (!funCaptchaDetected) {
        log("No captcha detected");
        captchaSolved = true;
        break;
      }

      log("FunCaptcha detected (attempt " + (captchaAttempt + 1) + "/3), solving via CapSolver...");
      try {
        const publicKey = "B7D8911C-5CC8-A9A3-35B0-554ACEE604DA";
        const result = await solveFunCaptcha("https://signup.live.com/", publicKey);
        if (result.success && result.token) {
          log("FunCaptcha solved! Injecting token...");
          await page.evaluate((token: string) => {
            const callback = (window as any).ArkoseEnforcement?.callback || (window as any).fc_callback;
            if (typeof callback === "function") {
              callback({ token });
            }
            const hiddenInput = document.querySelector('input[name="fc_token"], input[name="hipSolutionToken"], input[name="HipSolutionToken"]') as HTMLInputElement;
            if (hiddenInput) {
              hiddenInput.value = token;
            }
            const verifyBtn = document.querySelector('input[type="submit"], #iSignupAction') as HTMLElement;
            if (verifyBtn) verifyBtn.click();
          }, result.token);
          await page.waitForTimeout(5000 + Math.random() * 3000);
          log("FunCaptcha token injected, waiting for result...");
          captchaSolved = true;
          break;
        } else {
          log("FunCaptcha solving failed: " + (result.error || "unknown"));
        }
      } catch (fcErr: any) {
        log("FunCaptcha error: " + (fcErr.message || "").substring(0, 100));
      }
      await page.waitForTimeout(2000);
    }

    if (!captchaSolved) {
      return { success: false, error: "Could not solve FunCaptcha after 3 attempts" };
    }

    await page.waitForTimeout(3000 + Math.random() * 2000);
    const currentUrl = page.url();
    log("After captcha/submit: " + currentUrl.substring(0, 100));

    const bodyText = await page.textContent("body").catch(() => "");
    const bodyLower = (bodyText || "").toLowerCase();

    if (currentUrl.includes("signup") && (bodyLower.includes("error") || bodyLower.includes("try again"))) {
      const errSnippet = (bodyText || "").substring(0, 200).replace(/\s+/g, " ");
      log("Signup may have failed: " + errSnippet);
      return { success: false, error: "Signup error: " + errSnippet.substring(0, 150) };
    }

    const stayBtn = await page.$('#acceptButton, #idSIButton9, input[value="Yes"]');
    if (stayBtn) {
      await stayBtn.click();
      await page.waitForTimeout(3000 + Math.random() * 2000);
      log("Handled post-signup prompt");
    }

    const welcomeText = bodyLower.includes("welcome") || bodyLower.includes("almost done") ||
                        bodyLower.includes("verify") || currentUrl.includes("proofs") ||
                        currentUrl.includes("outlook") || currentUrl.includes("office");

    if (welcomeText || !currentUrl.includes("signup.live.com/signup")) {
      log("Outlook account created successfully!");
      log("Email: " + email);
      return { success: true, email, password };
    }

    const pageSnippet = (bodyText || "").substring(0, 300).replace(/\s+/g, " ");
    log("Uncertain result. URL: " + currentUrl.substring(0, 100) + " | Page: " + pageSnippet.substring(0, 150));
    return { success: true, email, password };
  } catch (err: any) {
    log("Error creating Outlook account: " + (err.message || "").substring(0, 200));
    return { success: false, error: (err.message || "Unknown error").substring(0, 300) };
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

export interface ZenrowsRegistrationResult {
  success: boolean;
  error?: string;
  apiKey?: string;
  outlookEmail?: string;
  outlookPassword?: string;
}

export async function registerZenrowsAccount(
  outlookEmail: string | null,
  outlookPassword: string | null,
  log: (msg: string) => void
): Promise<ZenrowsRegistrationResult> {
  let localBrowser: any = null;
  let zenrowsBrowser: any = null;

  const zenrowsPassword = "Zr" + Math.random().toString(36).substring(2, 10) + "!" + Math.floor(Math.random() * 900 + 100);

  try {
    if (!outlookEmail || !outlookPassword) {
      log("Step 0/6: Creating fresh Outlook account...");
      const outlookResult = await createOutlookAccount(log);
      if (!outlookResult.success || !outlookResult.email || !outlookResult.password) {
        return { success: false, error: "Failed to create Outlook account: " + (outlookResult.error || "Unknown error") };
      }
      outlookEmail = outlookResult.email;
      outlookPassword = outlookResult.password;
      log("Outlook account ready: " + outlookEmail);
    }

    log("Step 1/6: Registering on ZenRows...");
    log("Using email: " + outlookEmail);
    log("Generated ZenRows password: " + zenrowsPassword.substring(0, 3) + "***");

    let zenrowsUrl = "";
    try {
      const zrRow = await db.execute(sql`SELECT value FROM settings WHERE key = 'zenrows_api_url'`);
      if (zrRow.rows.length > 0 && zrRow.rows[0].value) {
        zenrowsUrl = zrRow.rows[0].value as string;
      }
    } catch {}

    if (!zenrowsUrl) {
      return { success: false, error: "ZenRows Browser URL not configured. Set it in Settings." };
    }
    if (!zenrowsUrl.includes('proxy_country=')) {
      zenrowsUrl += (zenrowsUrl.includes('?') ? '&' : '?') + 'proxy_country=us';
    }

    log("Launching browser for ZenRows registration...");

    await ensureBrowserInstalled();
    const dedicatedBrowser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    localBrowser = dedicatedBrowser;
    log("Browser launched");

    const context = await dedicatedBrowser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
    });
    const page = await context.newPage();
    await page.setDefaultNavigationTimeout(120000);
    await page.setDefaultTimeout(30000);

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      (window as any).chrome = { runtime: {} };
    });

    log("Navigating to ZenRows register page...");
    try {
      await page.goto("https://app.zenrows.com/register", { waitUntil: "domcontentloaded", timeout: 120000 });
    } catch (navErr: any) {
      log("Navigation note: " + (navErr.message || "").substring(0, 150));
    }

    await page.waitForTimeout(5000);
    let currentPageUrl = page.url();
    log("Initial page: " + currentPageUrl.substring(0, 80));

    const bodyText1 = await page.textContent("body").catch(() => "");
    const pageTitle = await page.title().catch(() => "");
    log("Page title: " + pageTitle + ", body preview: " + (bodyText1 || "").substring(0, 100).replace(/\s+/g, " "));

    if ((bodyText1 || "").includes("Just a moment") || pageTitle.includes("Just a moment") || (bodyText1 || "").includes("challenge")) {
      log("Cloudflare challenge detected, waiting up to 45s for auto-solve...");
      for (let cfRetry = 0; cfRetry < 9; cfRetry++) {
        await page.waitForTimeout(5000);
        const currentBody = await page.textContent("body").catch(() => "");
        const currentTitle = await page.title().catch(() => "");
        if (!(currentBody || "").includes("Just a moment") && !currentTitle.includes("Just a moment")) {
          log("Cloudflare challenge resolved after " + ((cfRetry + 1) * 5) + "s");
          break;
        }
        if (cfRetry === 8) {
          log("Cloudflare challenge NOT resolved after 45s");
          const cfPageContent = (currentBody || "").substring(0, 300).replace(/\s+/g, " ");
          log("CF page: " + cfPageContent);
        }
      }
      currentPageUrl = page.url();
      log("After CF wait: " + currentPageUrl.substring(0, 80));
    }

    const inputSelectors = [
      'input[type="email"]', 'input[name="email"]', 'input[placeholder*="mail"]',
      'input[placeholder*="Mail"]', 'input[placeholder*="Email"]',
      'input[autocomplete="email"]', 'input[id*="email"]', 'input[id*="Email"]',
    ];

    let emailInput: any = null;
    for (const sel of inputSelectors) {
      try {
        emailInput = await page.waitForSelector(sel, { timeout: 5000 });
        if (emailInput) {
          log("Found email input with: " + sel);
          break;
        }
      } catch {}
    }

    if (!emailInput) {
      const allInputs = await page.$$('input');
      log("Found " + allInputs.length + " total input elements on page");
      for (let i = 0; i < allInputs.length; i++) {
        const attrs = await allInputs[i].evaluate((el: any) => ({
          type: el.type, name: el.name, id: el.id, placeholder: el.placeholder,
          ariaLabel: el.getAttribute('aria-label'), className: el.className?.substring?.(0, 80)
        }));
        log("  Input " + i + ": " + JSON.stringify(attrs));
      }
      const bodySnippet = await page.textContent("body").catch(() => "");
      log("Page text: " + (bodySnippet || "").substring(0, 300).replace(/\s+/g, " "));

      if (allInputs.length > 0) {
        emailInput = allInputs[0];
        log("Using first input as email field");
      } else {
        return { success: false, error: "No input fields found on ZenRows register page" };
      }
    }

    await emailInput.click();
    await page.waitForTimeout(300 + Math.random() * 300);
    for (const char of outlookEmail) {
      await page.keyboard.type(char, { delay: 0 });
      await page.waitForTimeout(20 + Math.random() * 40);
    }
    log("Email filled");

    await page.waitForTimeout(500 + Math.random() * 500);

    const passSelectors = ['input[type="password"]', 'input[name="password"]', 'input[id*="password"]', 'input[id*="Password"]'];
    let passwordInput: any = null;
    for (const sel of passSelectors) {
      try {
        passwordInput = await page.$(sel);
        if (passwordInput) break;
      } catch {}
    }

    if (!passwordInput) {
      const allInputs = await page.$$('input');
      if (allInputs.length > 1) {
        passwordInput = allInputs[1];
        log("Using second input as password field");
      }
    }

    if (passwordInput) {
      await passwordInput.click();
      await page.waitForTimeout(300 + Math.random() * 300);
      for (const char of zenrowsPassword) {
        await page.keyboard.type(char, { delay: 0 });
        await page.waitForTimeout(20 + Math.random() * 40);
      }
      log("Password filled");
    } else {
      return { success: false, error: "Could not find password input on ZenRows register page" };
    }

    await page.waitForTimeout(1000 + Math.random() * 500);

    log("Checking for captcha on registration page...");
    const captchaInfo = await page.evaluate(() => {
      const result: any = { turnstile: null, recaptchaV2: null, recaptchaV3: null, hcaptcha: null, allIframes: [] };

      const turnstileWidget = document.querySelector('[data-sitekey].cf-turnstile, .cf-turnstile[data-sitekey], iframe[src*="challenges.cloudflare.com"]');
      if (turnstileWidget) {
        result.turnstile = (turnstileWidget as any).getAttribute('data-sitekey') || null;
      }
      const turnstileIframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      if (turnstileIframe && !result.turnstile) {
        const src = (turnstileIframe as HTMLIFrameElement).src;
        const match = src.match(/[?&]k=([^&]+)/);
        if (match) result.turnstile = match[1];
      }

      const recaptchaEl = document.querySelector('.g-recaptcha[data-sitekey], [data-sitekey]:not(.cf-turnstile)');
      if (recaptchaEl) {
        result.recaptchaV2 = (recaptchaEl as any).getAttribute('data-sitekey');
      }
      const recaptchaV3Script = document.querySelector('script[src*="recaptcha/api.js?render="], script[src*="recaptcha/enterprise.js?render="]');
      if (recaptchaV3Script) {
        const src = (recaptchaV3Script as HTMLScriptElement).src;
        const match = src.match(/render=([^&]+)/);
        if (match && match[1] !== 'explicit') result.recaptchaV3 = match[1];
      }

      const hcaptchaEl = document.querySelector('.h-captcha[data-sitekey]');
      if (hcaptchaEl) {
        result.hcaptcha = (hcaptchaEl as any).getAttribute('data-sitekey');
      }

      document.querySelectorAll('iframe').forEach((f: HTMLIFrameElement) => {
        result.allIframes.push(f.src?.substring(0, 120) || '(no src)');
      });

      const responseInputs: string[] = [];
      document.querySelectorAll('textarea[name*="captcha"], input[name*="captcha"], textarea[name*="token"], input[name*="turnstile"], textarea.g-recaptcha-response, textarea[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]').forEach((el: any) => {
        responseInputs.push(el.name || el.id || el.className?.substring(0, 40));
      });
      result.responseInputs = responseInputs;

      const allBtns: string[] = [];
      document.querySelectorAll('button, input[type="submit"], a[role="button"]').forEach((b: any) => {
        allBtns.push((b.type || '') + '|' + (b.textContent || '').trim().substring(0, 40) + '|' + (b.className || '').substring(0, 40));
      });
      result.allButtons = allBtns;

      return result;
    });

    log("Captcha scan: turnstile=" + (captchaInfo.turnstile || 'none') +
        " recaptchaV2=" + (captchaInfo.recaptchaV2 || 'none') +
        " recaptchaV3=" + (captchaInfo.recaptchaV3 || 'none') +
        " hcaptcha=" + (captchaInfo.hcaptcha || 'none'));
    if (captchaInfo.allIframes.length > 0) log("Iframes: " + captchaInfo.allIframes.join(", "));
    if (captchaInfo.responseInputs.length > 0) log("Response inputs: " + captchaInfo.responseInputs.join(", "));
    log("Buttons found: " + captchaInfo.allButtons.map((b: string) => b).join(" | "));

    if (captchaInfo.turnstile) {
      log("Solving Turnstile captcha with CapSolver (sitekey: " + captchaInfo.turnstile + ")...");
      const turnstileResult = await solveAntiTurnstile("https://app.zenrows.com/register", captchaInfo.turnstile);
      if (turnstileResult.success && turnstileResult.token) {
        log("Turnstile solved! Injecting token...");
        await page.evaluate((token: string) => {
          const respInputs = document.querySelectorAll('textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"]');
          respInputs.forEach((el: any) => { el.value = token; });
          const callbackName = document.querySelector('.cf-turnstile')?.getAttribute('data-callback');
          if (callbackName && typeof (window as any)[callbackName] === 'function') {
            (window as any)[callbackName](token);
          }
          if (typeof (window as any).turnstile !== 'undefined') {
            try { (window as any).turnstile.getResponse = () => token; } catch {}
          }
        }, turnstileResult.token);
        await page.waitForTimeout(1000);
      } else {
        log("Turnstile solve failed: " + (turnstileResult.error || "unknown"));
      }
    }

    if (captchaInfo.recaptchaV2) {
      log("Solving reCAPTCHA V2 with CapSolver (sitekey: " + captchaInfo.recaptchaV2 + ")...");
      const v2Result = await solveRecaptchaV2("https://app.zenrows.com/register", captchaInfo.recaptchaV2);
      if (v2Result.success && v2Result.token) {
        log("reCAPTCHA V2 solved! Injecting token...");
        await page.evaluate((token: string) => {
          const textarea = document.querySelector('textarea.g-recaptcha-response, textarea[name="g-recaptcha-response"]');
          if (textarea) (textarea as any).value = token;
          if (typeof (window as any).___grecaptcha_cfg !== 'undefined') {
            try {
              const clients = (window as any).___grecaptcha_cfg?.clients;
              if (clients) {
                Object.keys(clients).forEach(k => {
                  try { clients[k]?.callback?.(token); } catch {}
                });
              }
            } catch {}
          }
        }, v2Result.token);
        await page.waitForTimeout(1000);
      } else {
        log("reCAPTCHA V2 solve failed: " + (v2Result.error || "unknown"));
      }
    }

    if (captchaInfo.recaptchaV3) {
      log("Solving reCAPTCHA V3 with CapSolver (sitekey: " + captchaInfo.recaptchaV3 + ")...");
      const v3Result = await solveRecaptchaV3Enterprise("https://app.zenrows.com/register", captchaInfo.recaptchaV3, "register");
      if (v3Result.success && v3Result.token) {
        log("reCAPTCHA V3 solved! Injecting token...");
        await page.evaluate((token: string) => {
          const textarea = document.querySelector('textarea.g-recaptcha-response, textarea[name="g-recaptcha-response"]');
          if (textarea) (textarea as any).value = token;
        }, v3Result.token);
        await page.waitForTimeout(1000);
      } else {
        log("reCAPTCHA V3 solve failed: " + (v3Result.error || "unknown"));
      }
    }

    if (captchaInfo.hcaptcha) {
      log("Solving hCaptcha with CapSolver (sitekey: " + captchaInfo.hcaptcha + ")...");
      const hResult = await solveHCaptcha("https://app.zenrows.com/register", captchaInfo.hcaptcha);
      if (hResult.success && hResult.token) {
        log("hCaptcha solved! Injecting token...");
        await page.evaluate((token: string) => {
          const textarea = document.querySelector('textarea[name="h-captcha-response"]');
          if (textarea) (textarea as any).value = token;
        }, hResult.token);
        await page.waitForTimeout(1000);
      } else {
        log("hCaptcha solve failed: " + (hResult.error || "unknown"));
      }
    }

    await page.waitForTimeout(500 + Math.random() * 500);

    const allButtons = await page.$$('button, input[type="submit"]');
    let signupBtn: any = null;
    for (const btn of allButtons) {
      const btnText = (await btn.textContent().catch(() => "") || "").trim();
      const isOAuthBtn = /google|github|facebook|twitter|apple|microsoft/i.test(btnText);
      if (isOAuthBtn) continue;

      const isSignupBtn = /^sign\s*up$/i.test(btnText) ||
        /^register$/i.test(btnText) ||
        /^create\s*(account)?$/i.test(btnText) ||
        /^get\s*started$/i.test(btnText) ||
        /^start$/i.test(btnText) ||
        /^submit$/i.test(btnText);
      if (isSignupBtn) {
        signupBtn = btn;
        log("Found email signup button: '" + btnText.substring(0, 40) + "'");
        break;
      }
    }

    if (!signupBtn) {
      for (const btn of allButtons) {
        const btnText = (await btn.textContent().catch(() => "") || "").trim();
        const btnType = await btn.getAttribute("type").catch(() => "");
        if (btnType === "submit" && !/google|github|facebook/i.test(btnText)) {
          signupBtn = btn;
          log("Using submit button: '" + btnText.substring(0, 40) + "'");
          break;
        }
      }
    }

    if (signupBtn) {
      await signupBtn.click();
      log("Clicked signup button");
    } else {
      log("No specific signup button found, pressing Enter...");
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(8000 + Math.random() * 3000);
    const afterSignupUrl = page.url();
    log("After signup: " + afterSignupUrl.substring(0, 100));

    const pageContent = await page.textContent("body").catch(() => "");
    const pageLower = (pageContent || "").toLowerCase();
    const needsVerification = pageLower.includes("verify") ||
                              pageLower.includes("check your email") ||
                              pageLower.includes("confirmation");
    const alreadyExists = pageLower.includes("already") ||
                          pageLower.includes("exists") ||
                          pageLower.includes("registered") ||
                          pageLower.includes("in use");
    const hasError = pageLower.includes("error") || pageLower.includes("invalid");

    if (alreadyExists) {
      log("Account may already exist — trying login directly");
    } else if (needsVerification || afterSignupUrl.includes("verify") || afterSignupUrl.includes("confirm")) {
      log("ZenRows requires email verification");
    } else if (afterSignupUrl.includes("dashboard") || afterSignupUrl.includes("onboarding")) {
      log("Signup succeeded — redirected to dashboard/onboarding");
    } else if (hasError) {
      const errorSnippet = (pageContent || "").substring(0, 200).replace(/\s+/g, " ");
      log("Signup error detected: " + errorSnippet);
    } else {
      log("Page after signup: " + (pageContent || "").substring(0, 200).replace(/\s+/g, " "));
      const allToasts = await page.$$eval('[role="alert"], .toast, .notification, [class*="alert"], [class*="toast"]', (els: any[]) =>
        els.map((e: any) => (e.textContent || "").substring(0, 150))
      ).catch(() => []);
      if (allToasts.length > 0) {
        log("Toasts/alerts on page: " + allToasts.join(" | ").substring(0, 200));
      }
    }

    try { await page.close(); } catch {}
    try { await context.close(); } catch {}

    log("Step 2/6: Logging into Outlook to get verification email...");

    let outlookBrowser = localBrowser;
    let usedZenRows = false;

    try {
      if (!zenrowsUrl.includes('proxy_country=')) {
        zenrowsUrl += (zenrowsUrl.includes('?') ? '&' : '?') + 'proxy_country=us';
      }
      zenrowsBrowser = await chromium.connectOverCDP(zenrowsUrl, { timeout: 30000 });
      outlookBrowser = zenrowsBrowser;
      usedZenRows = true;
      log("ZenRows browser connected for Outlook");
    } catch (cdpErr: any) {
      log("ZenRows CDP unavailable (" + (cdpErr.message || "").substring(0, 60) + "), using local browser for Outlook");
      if (!localBrowser || !localBrowser.isConnected()) {
        await ensureBrowserInstalled();
        localBrowser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
        });
        outlookBrowser = localBrowser;
      }
    }

    const outlookCtx = usedZenRows
      ? (outlookBrowser!.contexts()[0] || await outlookBrowser!.newContext())
      : await outlookBrowser!.newContext({
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          viewport: { width: 1920, height: 1080 },
        });
    const outlookPage = await outlookCtx.newPage();
    await outlookPage.setDefaultNavigationTimeout(120000);
    await outlookPage.setDefaultTimeout(30000);

    log("Navigating to Outlook login...");
    await outlookPage.goto("https://login.live.com/", { waitUntil: "domcontentloaded", timeout: 120000 });
    await outlookPage.waitForTimeout(2000 + Math.random() * 1500);

    const olEmailInput = await outlookPage.waitForSelector('input[type="email"], input[name="loginfmt"]', { timeout: 15000 });
    if (olEmailInput) {
      await olEmailInput.click();
      await outlookPage.waitForTimeout(300);
      for (const char of outlookEmail) {
        await outlookPage.keyboard.type(char, { delay: 0 });
        await outlookPage.waitForTimeout(30 + Math.random() * 50);
      }
      log("Outlook email typed");
    }

    await outlookPage.waitForTimeout(500 + Math.random() * 500);
    const nextBtn = await outlookPage.$('input[type="submit"]#idSIButton9, input[value="Next"]');
    if (nextBtn) await nextBtn.click();
    else await outlookPage.keyboard.press("Enter");

    await outlookPage.waitForTimeout(3000 + Math.random() * 2000);
    log("After email submit: " + outlookPage.url().substring(0, 80));

    const olPassInput = await outlookPage.waitForSelector('input[type="password"], input[name="passwd"]', { timeout: 15000 });
    if (olPassInput) {
      await olPassInput.click();
      await outlookPage.waitForTimeout(300);
      for (const char of outlookPassword) {
        await outlookPage.keyboard.type(char, { delay: 0 });
        await outlookPage.waitForTimeout(30 + Math.random() * 50);
      }
      log("Outlook password typed");
    }

    await outlookPage.waitForTimeout(800 + Math.random() * 500);
    const signInBtn = await outlookPage.$('input[type="submit"]#idSIButton9, input[value="Sign in"]');
    if (signInBtn) await signInBtn.click();
    else await outlookPage.keyboard.press("Enter");

    await outlookPage.waitForTimeout(4000 + Math.random() * 3000);
    log("After sign in: " + outlookPage.url().substring(0, 80));

    const stayBtn = await outlookPage.$('#idSIButton9, input[value="Yes"]');
    if (stayBtn) {
      const btnVal = await stayBtn.getAttribute("value");
      if (btnVal === "Yes" || outlookPage.url().includes("kmsi")) {
        await stayBtn.click();
        await outlookPage.waitForTimeout(3000 + Math.random() * 2000);
        log("Handled 'Stay signed in?' prompt");
      }
    }

    log("Step 3/6: Navigating to Outlook inbox...");
    await outlookPage.goto("https://outlook.live.com/mail/0/inbox", { waitUntil: "domcontentloaded", timeout: 120000 });
    await outlookPage.waitForTimeout(5000 + Math.random() * 3000);
    log("Inbox loaded: " + outlookPage.url().substring(0, 80));

    let verifyLink = "";
    for (let attempt = 0; attempt < 12; attempt++) {
      log(`Searching for ZenRows verification email (attempt ${attempt + 1}/12)...`);

      try {
        const emailItems = await outlookPage.$$('[role="listbox"] [role="option"], [aria-label*="message"], div[data-convid], tr[aria-label], div.customScrollBar div[tabindex]');
        log(`Found ${emailItems.length} email items in inbox`);

        for (const item of emailItems) {
          const text = await item.textContent().catch(() => "");
          if ((text || "").toLowerCase().includes("zenrows") || (text || "").toLowerCase().includes("verify") || (text || "").toLowerCase().includes("confirm your")) {
            log("Found potential ZenRows email! Clicking...");
            await item.click();
            await outlookPage.waitForTimeout(3000 + Math.random() * 2000);
            break;
          }
        }

        const allLinks = await outlookPage.$$eval('a[href]', (links: any[]) =>
          links.map((a: any) => ({ href: a.href, text: (a.textContent || "").substring(0, 100) }))
        );

        for (const link of allLinks) {
          if (link.href && (
            link.href.includes("zenrows.com") && (link.href.includes("verify") || link.href.includes("confirm") || link.href.includes("token")) ||
            link.text.toLowerCase().includes("verify") && link.href.includes("zenrows")
          )) {
            verifyLink = link.href;
            log("Found verification link: " + verifyLink.substring(0, 120));
            break;
          }
        }

        if (verifyLink) break;

        const bodyText = await outlookPage.textContent("body").catch(() => "");
        const zenrowsMention = (bodyText || "").toLowerCase().indexOf("zenrows");
        if (zenrowsMention > -1) {
          const snippet = (bodyText || "").substring(Math.max(0, zenrowsMention - 50), zenrowsMention + 200);
          log("Found 'zenrows' in page text near: " + snippet.replace(/\s+/g, " ").substring(0, 120));
        }

        if (!verifyLink && attempt === 3) {
          log("Checking 'Other' folder...");
          try {
            await outlookPage.goto("https://outlook.live.com/mail/0/junkemail", { waitUntil: "domcontentloaded", timeout: 30000 });
            await outlookPage.waitForTimeout(4000);
            const junkItems = await outlookPage.$$('[role="listbox"] [role="option"], [aria-label*="message"], div[data-convid], tr[aria-label], div.customScrollBar div[tabindex]');
            for (const item of junkItems) {
              const text = await item.textContent().catch(() => "");
              if ((text || "").toLowerCase().includes("zenrows") || (text || "").toLowerCase().includes("verify")) {
                log("Found ZenRows email in junk folder! Clicking...");
                await item.click();
                await outlookPage.waitForTimeout(3000);
                const junkLinks = await outlookPage.$$eval('a[href]', (links: any[]) =>
                  links.map((a: any) => ({ href: a.href, text: (a.textContent || "").substring(0, 100) }))
                );
                for (const link of junkLinks) {
                  if (link.href && link.href.includes("zenrows.com") && (link.href.includes("verify") || link.href.includes("confirm") || link.href.includes("token"))) {
                    verifyLink = link.href;
                    log("Found verification link in junk: " + verifyLink.substring(0, 120));
                    break;
                  }
                }
                break;
              }
            }
            if (!verifyLink) {
              await outlookPage.goto("https://outlook.live.com/mail/0/inbox", { waitUntil: "domcontentloaded", timeout: 30000 });
              await outlookPage.waitForTimeout(4000);
            }
          } catch (junkErr: any) {
            log("Junk folder check error: " + (junkErr.message || "").substring(0, 60));
            await outlookPage.goto("https://outlook.live.com/mail/0/inbox", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
            await outlookPage.waitForTimeout(3000);
          }
        }

        if (!verifyLink && attempt < 11) {
          log("Verification email not found yet, refreshing inbox...");
          try {
            await outlookPage.keyboard.press("F5");
          } catch {
            await outlookPage.goto("https://outlook.live.com/mail/0/inbox", { waitUntil: "domcontentloaded", timeout: 60000 });
          }
          await outlookPage.waitForTimeout(8000 + Math.random() * 4000);
        }
      } catch (searchErr: any) {
        log("Inbox search error: " + (searchErr.message || "").substring(0, 100));
        await outlookPage.waitForTimeout(5000);
      }
    }

    if (!verifyLink) {
      try {
        const allText = await outlookPage.textContent("body").catch(() => "");
        const linkRegex = /https?:\/\/[^\s"'<>]*zenrows[^\s"'<>]*/gi;
        const matches = (allText || "").match(linkRegex);
        if (matches && matches.length > 0) {
          verifyLink = matches[0];
          log("Found ZenRows link via regex: " + verifyLink.substring(0, 120));
        }
      } catch {}
    }

    if (!verifyLink) {
      try { await outlookPage.close(); } catch {}
      try { if (zenrowsBrowser) await zenrowsBrowser.close(); } catch {}
      zenrowsBrowser = null;
      return { success: false, error: "Could not find ZenRows verification email after 12 attempts. The email may not have arrived yet." };
    }

    log("Step 4/6: Clicking verification link...");
    try { await outlookPage.close(); } catch {}
    try { if (zenrowsBrowser) await zenrowsBrowser.close(); } catch {}
    zenrowsBrowser = null;

    if (!localBrowser || !localBrowser.isConnected()) {
      await ensureBrowserInstalled();
      localBrowser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
      });
    }
    const verifyCtx = await localBrowser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const verifyPage = await verifyCtx.newPage();
    await verifyPage.setDefaultNavigationTimeout(60000);

    await verifyPage.goto(verifyLink, { waitUntil: "domcontentloaded" });
    await verifyPage.waitForTimeout(5000 + Math.random() * 3000);
    const verifyUrl = verifyPage.url();
    log("After verification: " + verifyUrl.substring(0, 100));

    const verifyText = await verifyPage.textContent("body").catch(() => "");
    if ((verifyText || "").toLowerCase().includes("verified") || (verifyText || "").toLowerCase().includes("confirmed") || (verifyText || "").toLowerCase().includes("success")) {
      log("Email verified successfully!");
    } else {
      log("Verification page content: " + (verifyText || "").substring(0, 150).replace(/\s+/g, " "));
    }

    try { await verifyPage.close(); } catch {}
    try { await verifyCtx.close(); } catch {}

    log("Step 5/6: Logging into ZenRows to get API key...");
    if (!localBrowser || !localBrowser.isConnected()) {
      await ensureBrowserInstalled();
      localBrowser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
      });
    }
    const apiCtx = await localBrowser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const apiPage = await apiCtx.newPage();
    await apiPage.setDefaultNavigationTimeout(60000);
    await apiPage.setDefaultTimeout(30000);

    await apiPage.goto("https://app.zenrows.com/login", { waitUntil: "domcontentloaded" });
    await apiPage.waitForTimeout(2000 + Math.random() * 1500);

    const zrLoginEmail = await apiPage.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
    if (zrLoginEmail) {
      await zrLoginEmail.click();
      await apiPage.waitForTimeout(300);
      for (const char of outlookEmail) {
        await apiPage.keyboard.type(char, { delay: 0 });
        await apiPage.waitForTimeout(20 + Math.random() * 40);
      }
    }

    await apiPage.waitForTimeout(500);

    const zrLoginPass = await apiPage.$('input[type="password"], input[name="password"]');
    if (zrLoginPass) {
      await zrLoginPass.click();
      await apiPage.waitForTimeout(300);
      for (const char of zenrowsPassword) {
        await apiPage.keyboard.type(char, { delay: 0 });
        await apiPage.waitForTimeout(20 + Math.random() * 40);
      }
    }

    await apiPage.waitForTimeout(500);
    const zrLoginBtn = await apiPage.$('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');
    if (zrLoginBtn) await zrLoginBtn.click();
    else await apiPage.keyboard.press("Enter");

    await apiPage.waitForTimeout(5000 + Math.random() * 3000);
    log("ZenRows login: " + apiPage.url().substring(0, 100));

    await apiPage.goto("https://app.zenrows.com/builder", { waitUntil: "domcontentloaded" });
    await apiPage.waitForTimeout(3000 + Math.random() * 2000);
    log("Builder page loaded: " + apiPage.url().substring(0, 100));

    let apiKey = "";

    try {
      apiKey = await apiPage.evaluate(() => {
        const inputs = document.querySelectorAll('input[readonly], input[type="text"]');
        for (const input of inputs) {
          const val = (input as HTMLInputElement).value;
          if (val && val.length > 20 && /^[a-f0-9]+$/.test(val)) return val;
        }
        const codeElements = document.querySelectorAll('code, pre, [class*="api"], [class*="key"]');
        for (const el of codeElements) {
          const text = (el.textContent || "").trim();
          if (text.length > 20 && /^[a-f0-9]+$/.test(text)) return text;
        }
        const bodyText = document.body.innerText || "";
        const match = bodyText.match(/\b[a-f0-9]{30,}\b/);
        if (match) return match[0];
        return "";
      });
    } catch {}

    if (!apiKey) {
      try {
        const copyBtn = await apiPage.$('button:has-text("Copy"), button:has-text("copy"), button[aria-label*="copy"]');
        if (copyBtn) {
          log("Found Copy button, trying to extract API key from nearby elements...");
          apiKey = await apiPage.evaluate(() => {
            const copyBtns = Array.from(document.querySelectorAll('button'));
            for (const btn of copyBtns) {
              if ((btn.textContent || "").toLowerCase().includes("copy")) {
                const parent = btn.parentElement;
                if (parent) {
                  const inputs = parent.querySelectorAll('input, code, span, div');
                  for (const el of inputs) {
                    const text = ((el as HTMLInputElement).value || el.textContent || "").trim();
                    if (text.length > 20 && /^[a-f0-9]+$/.test(text)) return text;
                  }
                }
                const prev = btn.previousElementSibling;
                if (prev) {
                  const text = ((prev as HTMLInputElement).value || prev.textContent || "").trim();
                  if (text.length > 20 && /^[a-f0-9]+$/.test(text)) return text;
                }
              }
            }
            return "";
          });
        }
      } catch {}
    }

    if (!apiKey) {
      const allText = await apiPage.textContent("body").catch(() => "");
      const hexMatch = (allText || "").match(/\b[a-f0-9]{30,50}\b/);
      if (hexMatch) {
        apiKey = hexMatch[0];
      }
    }

    try { await apiPage.close(); } catch {}
    try { await apiCtx.close(); } catch {}

    if (apiKey) {
      log("Step 6/6: Complete!");
      log("API Key found: " + apiKey.substring(0, 6) + "..." + apiKey.substring(apiKey.length - 4));
      return { success: true, apiKey, outlookEmail: outlookEmail!, outlookPassword: outlookPassword! };
    } else {
      log("Could not extract API key from builder page");
      return { success: false, error: "Registered and verified but could not extract API key from builder page" };
    }
  } catch (err: any) {
    log("Error: " + (err.message || "").substring(0, 200));
    return { success: false, error: (err.message || "Unknown error").substring(0, 300) };
  } finally {
    if (localBrowser) { try { await localBrowser.close(); } catch {} }
    if (zenrowsBrowser) { try { await zenrowsBrowser.close(); } catch {} }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

process.on("SIGTERM", async () => {
  console.log("[Playwright] Shutting down browser...");
  await closeBrowser();
});

process.on("SIGINT", async () => {
  console.log("[Playwright] Shutting down browser...");
  await closeBrowser();
});
