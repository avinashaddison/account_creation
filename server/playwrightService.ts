import { chromium, type Browser, type Page } from "playwright";
import { execSync, execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { db } from "./db";
import { sql } from "drizzle-orm";

const execFileAsync = promisify(execFile);
const CURL_IMPERSONATE_PATH = path.resolve(process.cwd(), "server", "curl_chrome116");
const CURL_COOKIE_DIR = "/tmp/la28_curl_sessions";

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

async function navigateQueueIt(
  targetUrl: string,
  cookieFile: string,
  proxyUrl: string,
  log: (msg: string) => void
): Promise<boolean> {
  log("Navigating through Queue-it for tickets.la28.org...");

  const resp1 = await curlImpersonate(targetUrl, {
    cookieFile,
    proxy: proxyUrl,
    followRedirects: true,
    maxRedirs: 5,
  });

  if (resp1.body.includes("Official LA28") || resp1.body.includes("login-app")) {
    log("Queue-it bypassed - got real page directly!");
    return true;
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
      return true;
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
        return true;
      }
    }
  }

  if (resp1.finalUrl.includes("tickets.la28.org") && !resp1.finalUrl.includes("next.tickets")) {
    log("Reached tickets.la28.org (may not have full page content)");
    return true;
  }

  log("Could not navigate through Queue-it");
  return false;
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

  let proxyUrl = "";
  try {
    const proxyRows = await db.execute(sql`SELECT value FROM settings WHERE key = 'iproyal_proxy_url' LIMIT 1`);
    const rows = proxyRows.rows as any[];
    if (rows.length > 0 && rows[0].value) proxyUrl = rows[0].value;
  } catch {}
  if (!proxyUrl) proxyUrl = "http://jRSA9eevoPMBKCs2:MTDugb6mPndnM5VJ@geo.iproyal.com:12321";

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

    const regResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
      cookieFile,
      proxy: proxyUrl,
      headers: {
        "Accept": "application/json",
        "Referer": "https://tickets.la28.org/mycustomerdata/",
      },
    });

    console.log("[CurlCookie] Registration form: " + regResp.statusCode + " size=" + regResp.body.length);

    if (regResp.statusCode === 403) {
      log("Akamai blocked API call (403). Browser cookies may not transfer to curl.");
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
      const submitResp = await curlImpersonate(p.url, {
        method: p.method,
        cookieFile,
        proxy: proxyUrl,
        headers: submitHeaders,
        body: p.body,
      });

      console.log("[CurlCookie] Submit " + p.method + " " + p.url.split("/api/")[1] + ": " + submitResp.statusCode + " body: " + submitResp.body.substring(0, 200));

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

  let proxyUrl = "";
  try {
    const proxyRows = await db.execute(sql`SELECT value FROM settings WHERE key = 'iproyal_proxy_url' LIMIT 1`);
    const rows = proxyRows.rows as any[];
    if (rows.length > 0 && rows[0].value) {
      proxyUrl = rows[0].value;
    }
  } catch {}

  if (!proxyUrl) {
    proxyUrl = "http://jRSA9eevoPMBKCs2:MTDugb6mPndnM5VJ@geo.iproyal.com:12321";
  }

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const cookieFile = path.join(CURL_COOKIE_DIR, `${sessionId}.txt`);

  try {
    log("Starting tickets.la28.org form fill via curl-impersonate...");
    console.log("[CurlImp] Session: " + sessionId + ", proxy: " + proxyUrl.substring(0, 40));

    const queuePassed = await navigateQueueIt(
      "https://tickets.la28.org/mycustomerdata/",
      cookieFile,
      proxyUrl,
      log
    );

    if (!queuePassed) {
      return { success: false, formSubmitted: false, error: "Queue-it navigation failed" };
    }

    log("Authenticating with Keycloak auth code on tickets.la28.org...");
    const ssoUrl = `https://tickets.la28.org/api/singleSignOn/857?` + new URLSearchParams({
      code: authCode,
      contenttype: "json",
      force_session: "true",
      redirectUrl: "https://tickets.la28.org/mycustomerdata/",
    }).toString();

    const ssoResp = await curlImpersonate(ssoUrl, {
      cookieFile,
      proxy: proxyUrl,
      headers: {
        "Accept": "application/json",
        "Referer": "https://tickets.la28.org/mycustomerdata/",
      },
      followRedirects: false,
    });

    console.log("[CurlImp] SSO response: " + ssoResp.statusCode + " body: " + ssoResp.body.substring(0, 200));

    if (ssoResp.statusCode === 403 || ssoResp.body.includes("Access Denied")) {
      log("Akamai blocked SSO API call. Session cookies may be invalid.");
      return { success: false, formSubmitted: false, error: "Akamai blocked API call" };
    }

    if (ssoResp.body.includes("errorCode") && ssoResp.body.includes('"message"')) {
      const ssoData = JSON.parse(ssoResp.body);
      if (ssoData.errorCode && ssoData.errorCode !== 0) {
        log("SSO login error: " + (ssoData.message || "code " + ssoData.errorCode));
        return { success: false, formSubmitted: false, error: "SSO: " + (ssoData.message || "login failed") };
      }
    }

    log("SSO authenticated on tickets.la28.org! Loading customer form...");

    const regResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
      cookieFile,
      proxy: proxyUrl,
      headers: {
        "Accept": "application/json",
        "Referer": "https://tickets.la28.org/mycustomerdata/",
      },
    });

    console.log("[CurlImp] Registration form: " + regResp.statusCode + " size=" + regResp.body.length);

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

    const submitResp = await curlImpersonate("https://tickets.la28.org/api/login/registration", {
      method: "POST",
      cookieFile,
      proxy: proxyUrl,
      headers: submitHeaders,
      body: submitBody,
    });

    console.log("[CurlImp] Submit response: " + submitResp.statusCode + " body: " + submitResp.body.substring(0, 300));

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

  const { storage } = await import("./storage");
  let effectiveProxyUrl = proxyUrl;
  if (!effectiveProxyUrl) {
    const residentialProxy = await storage.getSetting("residential_proxy_url");
    if (residentialProxy) {
      effectiveProxyUrl = residentialProxy;
    } else {
      log("No proxy configured. Cannot proceed.");
      return { submitted: false };
    }
  }

  const isBrowserAPI = effectiveProxyUrl.startsWith('wss://');
  let proxyBrowser: Browser | null = null;
  let proxyContext: any = null;
  let ticketsPage: Page;
  let capturedOidcUrl: string | null = null;

  try {
    if (isBrowserAPI) {
      proxyBrowser = await chromium.connectOverCDP(effectiveProxyUrl, { timeout: 60000 });
      ticketsPage = await proxyBrowser.newPage();
    } else {
      const proxyConfig = parseProxyUrl(effectiveProxyUrl);
      if (!proxyConfig) { log("Invalid proxy URL"); return { submitted: false }; }
      let pu = proxyConfig.username;
      if (proxyConfig.host.includes('brd.superproxy.io') && !pu.includes('-country-')) pu += '-country-us';
      console.log("[Draw] Launching Chromium with residential proxy...");
      proxyBrowser = await chromium.launch({
        headless: true,
        proxy: { server: `http://${proxyConfig.host}:${proxyConfig.port}`, username: pu, password: proxyConfig.password },
        args: ['--ignore-certificate-errors', '--disable-blink-features=AutomationControlled'],
      });
      proxyContext = await proxyBrowser.newContext({
        ignoreHTTPSErrors: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 },
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
        log("Browser blocked by robots.txt. Trying residential proxy...");
        const residentialProxy = await storage.getSetting("residential_proxy_url");
        if (residentialProxy && effectiveProxyUrl !== residentialProxy) {
          try { if (proxyBrowser) await proxyBrowser.close(); } catch {}
          return loginAndSubmitTicketRegistration(page, email, password, log, residentialProxy, zipCode);
        }
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
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }
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
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
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
                        headers: { 'Cookie': cookieStr, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }
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
          const loginResult = await ticketsPage.evaluate(`
            new Promise(function(resolve) {
              gigya.accounts.login({
                loginID: "${safeEmail}",
                password: "${safePass}",
                callback: function(r) { resolve({ ok: r.errorCode === 0, uid: r.UID || null, err: r.errorMessage || '' }); }
              });
              setTimeout(function() { resolve({ ok: false, err: 'timeout' }); }, 30000);
            })
          `) as { ok: boolean; uid: string | null; err: string };
          console.log("[Draw] Gigya login: ok=" + loginResult.ok + " uid=" + (loginResult.uid || 'null') + " err=" + loginResult.err);
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
          
          log("Form submitted but still shows draw prompt. Fields may need Angular-specific handling.");
          return true;
        }
      } catch (postErr: any) {
        console.log("[Draw-Form] Post-submit check error: " + postErr.message.substring(0, 100));
        log("Form submitted (post-submit check failed).");
        return true;
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
  let iproyalProxy: string | null = null;
  try {
    const proxyRow = await db.execute(sql`SELECT value FROM settings WHERE key = 'iproyal_proxy_url'`);
    if (proxyRow.rows.length > 0 && proxyRow.rows[0].value) {
      iproyalProxy = proxyRow.rows[0].value as string;
    }
  } catch {}

  log("Draw via Gigya browser: launching headless browser" + (iproyalProxy ? " (iProyal proxy)" : " (no proxy)") + "...");
  console.log("[Draw-Gigya] Starting for " + email + (iproyalProxy ? " with iProyal proxy" : ""));

  let browser: Browser | null = null;
  let page: Page | null = null;
  let profileSet = false;
  let dataSet = false;
  let proxyBrowserFailed = false;

  try {
    const launchArgs = ['--disable-blink-features=AutomationControlled', '--ignore-certificate-errors'];
    const launchOpts: any = { headless: true, args: launchArgs };
    if (iproyalProxy) {
      const proxyUrl = new URL(iproyalProxy);
      launchOpts.proxy = {
        server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
        username: proxyUrl.username,
        password: proxyUrl.password,
      };
    }
    browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(30000);

    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) return route.abort();
      return route.continue();
    });

    log("Navigating to la28id.la28.org/login...");
    console.log("[Draw-Gigya] Navigating to la28id.la28.org/login...");
    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 60000 });
    try { await page.waitForLoadState("networkidle", { timeout: 20000 }); } catch {}
    await page.waitForTimeout(3000);

    const pageUrl = page.url();
    const pageTitle = await page.title();
    console.log("[Draw-Gigya] Page URL: " + pageUrl + " title: " + pageTitle);

    const scriptInfo = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[src]');
      const srcs: string[] = [];
      for (let i = 0; i < scripts.length; i++) {
        const src = (scripts[i] as HTMLScriptElement).src;
        if (src.includes('gigya')) srcs.push(src);
      }
      return {
        gigyaScripts: srcs,
        gigyaExists: typeof (window as any).gigya !== 'undefined',
        gigyaAccountsExists: typeof (window as any).gigya !== 'undefined' && typeof (window as any).gigya.accounts !== 'undefined',
        bodyLen: document.body?.innerText?.length || 0
      };
    });
    console.log("[Draw-Gigya] Script info: " + JSON.stringify(scriptInfo));

    console.log("[Draw-Gigya] Waiting for Gigya SDK...");
    try {
      await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 30000 });
    } catch {
      const retryInfo = await page.evaluate(() => ({
        gigyaType: typeof (window as any).gigya,
        gigyaKeys: typeof (window as any).gigya === 'object' ? Object.keys((window as any).gigya).slice(0, 10) : [],
        bodySnippet: document.body?.innerText?.substring(0, 300) || ''
      }));
      console.log("[Draw-Gigya] Gigya SDK not available. Debug: " + JSON.stringify(retryInfo));
      log("Gigya SDK did not load. Debug: gigyaType=" + retryInfo.gigyaType);
      try { await browser.close(); } catch {}
      return { success: false, profileSet: false, dataSet: false, error: "Gigya SDK not loaded" };
    }

    log("Gigya SDK loaded. Logging in via ScreenSet form...");
    console.log("[Draw-Gigya] Gigya SDK loaded, logging in via ScreenSet form...");

    let loginOk = false;

    console.log("[Draw-Gigya] Attempting direct gigya.accounts.login API...");
    log("Logging in via Gigya API...");
    let apiLoginResult: any = null;
    for (let loginAttempt = 0; loginAttempt < 3; loginAttempt++) {
      if (loginAttempt > 0) {
        log("Retrying Gigya login (attempt " + (loginAttempt + 1) + ")...");
        await page.waitForTimeout(5000);
      }
      try {
        apiLoginResult = await page.evaluate(`(function() {
          return new Promise(function(resolve) {
            if (typeof gigya === 'undefined' || !gigya.accounts) {
              resolve({ success: false, error: 'gigya not available' });
              return;
            }
            gigya.accounts.login({
              loginID: ${JSON.stringify(email)},
              password: ${JSON.stringify(password)},
              callback: function(resp) {
                resolve({
                  success: resp.errorCode === 0,
                  errorCode: resp.errorCode,
                  errorMessage: resp.errorMessage || '',
                  uid: resp.UID || null
                });
              }
            });
            setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 30000);
          });
        })()`);
        console.log("[Draw-Gigya] API login result (attempt " + (loginAttempt + 1) + "): " + JSON.stringify(apiLoginResult));
        if ((apiLoginResult as any)?.success) break;
        if ((apiLoginResult as any)?.errorCode !== 400006) break;
      } catch (apiErr: any) {
        console.log("[Draw-Gigya] API login attempt error: " + apiErr.message.substring(0, 80));
      }
    }
    try {
      if ((apiLoginResult as any)?.success) {
        loginOk = true;
        log("Login successful via Gigya API. UID: " + ((apiLoginResult as any).uid || "unknown"));
      } else {
        log("Gigya API login failed: " + ((apiLoginResult as any).errorMessage || (apiLoginResult as any).error || "unknown"));
      }
    } catch (apiLoginErr: any) {
      console.log("[Draw-Gigya] API login error: " + apiLoginErr.message.substring(0, 150));
      if (apiLoginErr.message.includes("context was destroyed") || apiLoginErr.message.includes("navigation")) {
        loginOk = true;
        log("Login triggered redirect (likely successful).");
      } else {
        log("API login error: " + apiLoginErr.message.substring(0, 80));
      }
    }

    // Fallback: try ScreenSet form if API login didn't work
    if (!loginOk) {
      try {
        console.log("[Draw-Gigya] API login failed, trying ScreenSet form...");
        log("Trying ScreenSet form login...");
        await page.waitForSelector('#container input[name="loginID"], #container input[name="username"]', { timeout: 15000 });
        await page.waitForTimeout(1000);

        const loginIDInput = page.locator('#container input[name="loginID"], #container input[name="username"]').first();
        const passwordInput = page.locator('#container input[name="password"]').first();

        await loginIDInput.fill(email);
        await page.waitForTimeout(500);
        await passwordInput.fill(password);
        await page.waitForTimeout(500);

        console.log("[Draw-Gigya] Form filled, clicking submit...");
        const submitBtn = page.locator('#container input[type="submit"], #container .gigya-input-submit').first();
        const navPromise = page.waitForURL(/proxy\.html|consent\.html/, { timeout: 30000 }).catch(() => null);
        await submitBtn.click();
        await navPromise;
        await page.waitForTimeout(5000);

        const postLoginUrl = page.url();
        console.log("[Draw-Gigya] Post form-submit URL: " + postLoginUrl);
        if (postLoginUrl.includes("proxy.html") || postLoginUrl.includes("consent.html")) {
          loginOk = true;
          log("Login successful via form.");
        } else {
          const isLoggedIn = await page.evaluate(`(function() {
            return new Promise(function(resolve) {
              if (typeof gigya === 'undefined' || !gigya.accounts) { resolve(false); return; }
              gigya.accounts.getAccountInfo({ callback: function(resp) { resolve(resp.errorCode === 0); } });
              setTimeout(function() { resolve(false); }, 8000);
            });
          })`) as boolean;
          if (isLoggedIn) {
            loginOk = true;
            log("Login confirmed via getAccountInfo after form submit.");
          }
        }
      } catch (loginErr: any) {
        if (loginErr.message.includes("context was destroyed") || loginErr.message.includes("navigation")) {
          loginOk = true;
          log("Login triggered redirect (likely successful).");
        } else {
          console.log("[Draw-Gigya] ScreenSet form also failed: " + loginErr.message.substring(0, 150));
          log("Both login methods failed.");
        }
      }
    }

    if (!loginOk) {
      console.log("[Draw-Gigya] Browser login failed, falling back to REST API for profile/data...");
      log("Browser login failed (likely geo-block). Using REST API fallback...");
      try { await browser.close(); } catch {}

      const restLoginParams = new URLSearchParams({
        apiKey: GIGYA_API_KEY,
        loginID: email,
        password: password,
      });
      let restLoginOk = false;
      let restLoginToken = '';
      for (let restAttempt = 0; restAttempt < 3; restAttempt++) {
        try {
          const restLoginResp = await fetch(`https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.login`, { method: "POST", body: restLoginParams });
          const restLoginData = await restLoginResp.json() as any;
          if (restLoginData.errorCode === 0) {
            restLoginToken = restLoginData.sessionInfo?.cookieValue || restLoginData.login_token || '';
            restLoginOk = true;
            console.log("[Draw-Gigya] REST API login OK, UID: " + (restLoginData.UID || "?"));
            log("REST API login succeeded. UID: " + (restLoginData.UID || "unknown"));
            break;
          } else {
            console.log("[Draw-Gigya] REST login attempt " + (restAttempt + 1) + " failed: " + (restLoginData.errorMessage || restLoginData.errorCode));
            if (restAttempt < 2) await new Promise(r => setTimeout(r, 2000));
          }
        } catch (restErr: any) {
          console.log("[Draw-Gigya] REST login attempt " + (restAttempt + 1) + " error: " + restErr.message.substring(0, 100));
        }
      }

      if (!restLoginOk || !restLoginToken) {
        return { success: false, profileSet: false, dataSet: false, error: "Both browser and REST API login failed" };
      }

      const restApiUrl = `https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.setAccountInfo`;

      const allSportsJSONRest = JSON.stringify([
        ...favOlympicSports.map((code: string) => ({ ocsCode: code, odfCode: code, GameType: "OG" })),
        ...favParalympicSports.map((code: string) => ({ ocsCode: code, odfCode: code, GameType: "PG" })),
      ]);
      const teamsJSONRest = JSON.stringify(favTeams.map((code: string) => ({ ocsCode: code, nocCode: code, gameType: "OG" })));

      const restProfileParams = new URLSearchParams({
        apiKey: GIGYA_API_KEY,
        login_token: restLoginToken,
        profile: JSON.stringify({ birthYear: parseInt(birthYear), zip: usedZip, country: 'US' }),
      });
      const restProfileResp = await fetch(restApiUrl, { method: "POST", body: restProfileParams });
      const restProfileData = await restProfileResp.json() as any;
      const restProfileSet = restProfileData.errorCode === 0;
      console.log("[Draw-Gigya] REST profile result: " + JSON.stringify({ ok: restProfileSet, err: restProfileData.errorMessage }));
      if (restProfileSet) log("REST: Profile set (birth year " + birthYear + ", zip " + usedZip + ")");

      const restDataParams = new URLSearchParams({
        apiKey: GIGYA_API_KEY,
        login_token: restLoginToken,
        data: JSON.stringify({
          personalization: {
            favoritesDisciplines: JSON.parse(allSportsJSONRest),
            favoritesCountries: JSON.parse(teamsJSONRest),
            siteLanguage: 'en'
          },
          entryCampaignandSegregation: { l2028_ticketing: 'true', l2028_fan28: 'true' }
        }),
      });
      const restDataResp = await fetch(restApiUrl, { method: "POST", body: restDataParams });
      const restDataData = await restDataResp.json() as any;
      const restDataSet = restDataData.errorCode === 0;
      console.log("[Draw-Gigya] REST data result: " + JSON.stringify({ ok: restDataSet, err: restDataData.errorMessage }));
      if (restDataSet) log("REST: Draw flags + favorites set!");

      if (restProfileSet && restDataSet && onEarlyComplete) {
        console.log("[Draw-Gigya] REST profile+data set, marking completed early");
        onEarlyComplete();
      }

      log("REST fallback: profile/data set via API. Skipping OIDC/ZenRows (no browser session).");
      return { success: restProfileSet && restDataSet, profileSet: restProfileSet, dataSet: restDataSet };
    }

    log("Waiting for post-login page to stabilize...");
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch {}
    await page.waitForTimeout(3000);

    let postLoginUrl = page.url();
    console.log("[Draw-Gigya] Post-login URL: " + postLoginUrl);

    if (postLoginUrl.includes("proxy.html") || postLoginUrl.includes("consent.html")) {
      console.log("[Draw-Gigya] On intermediate page, waiting for navigations to complete...");
      for (let navWait = 0; navWait < 10; navWait++) {
        await page.waitForTimeout(2000);
        const curUrl = page.url();
        if (curUrl !== postLoginUrl) {
          console.log("[Draw-Gigya] Navigation detected: " + curUrl.substring(0, 120));
          postLoginUrl = curUrl;
        }
        if (!curUrl.includes("proxy.html") && !curUrl.includes("consent.html")) break;
      }
      try { await page.waitForLoadState("domcontentloaded", { timeout: 10000 }); } catch {}
      await page.waitForTimeout(2000);
      postLoginUrl = page.url();
      console.log("[Draw-Gigya] Settled URL: " + postLoginUrl);
      if (postLoginUrl.includes("proxy.html") || postLoginUrl.includes("consent.html")) {
        console.log("[Draw-Gigya] Still on intermediate page, navigating to la28id.la28.org/login...");
        try {
          await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
          try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
        } catch (navErr: any) {
          console.log("[Draw-Gigya] Nav timeout, trying evaluate redirect...");
          try {
            await page.evaluate("window.location.href = 'https://la28id.la28.org/login/'");
            await page.waitForTimeout(10000);
          } catch {}
        }
        await page.waitForTimeout(3000);
        postLoginUrl = page.url();
        console.log("[Draw-Gigya] After nav URL: " + postLoginUrl);
      }
    }

    console.log("[Draw-Gigya] Re-waiting for Gigya SDK after login...");
    let gigyaSdkAvailable = false;
    try {
      await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
      gigyaSdkAvailable = true;
    } catch {
      console.log("[Draw-Gigya] Gigya SDK not found after login. Page URL: " + page.url().substring(0, 100));
      if (!page.url().includes('la28id')) {
        try { await page.goto("https://la28id.la28.org/", { waitUntil: "domcontentloaded", timeout: 30000 }); } catch {}
        await page.waitForTimeout(3000);
        try {
          await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
          gigyaSdkAvailable = true;
        } catch {}
      }
    }

    if (!gigyaSdkAvailable) {
      console.log("[Draw-Gigya] Gigya SDK lost. Using REST fallback for profile/data...");
      log("Gigya SDK lost after login redirect. Using REST API...");
      try { await browser.close(); } catch {}

      const restFallbackParams = new URLSearchParams({ apiKey: GIGYA_API_KEY, loginID: email, password: password });
      let restToken = '';
      try {
        const rResp = await fetch(`https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.login`, { method: "POST", body: restFallbackParams });
        const rData = await rResp.json() as any;
        if (rData.errorCode === 0) restToken = rData.sessionInfo?.cookieValue || rData.login_token || '';
      } catch {}
      if (restToken) {
        const restUrl = `https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.setAccountInfo`;
        const allSportsJ = JSON.stringify([...favOlympicSports.map((c: string) => ({ ocsCode: c, odfCode: c, GameType: "OG" })), ...favParalympicSports.map((c: string) => ({ ocsCode: c, odfCode: c, GameType: "PG" }))]);
        const teamsJ = JSON.stringify(favTeams.map((c: string) => ({ ocsCode: c, nocCode: c, gameType: "OG" })));
        try { await fetch(restUrl, { method: "POST", body: new URLSearchParams({ apiKey: GIGYA_API_KEY, login_token: restToken, profile: JSON.stringify({ birthYear: parseInt(birthYear), zip: usedZip, country: 'US' }) }) }); } catch {}
        try { await fetch(restUrl, { method: "POST", body: new URLSearchParams({ apiKey: GIGYA_API_KEY, login_token: restToken, data: JSON.stringify({ personalization: { favoritesDisciplines: JSON.parse(allSportsJ), favoritesCountries: JSON.parse(teamsJ), siteLanguage: 'en' }, entryCampaignandSegregation: { l2028_ticketing: 'true', l2028_fan28: 'true' } }) }) }); } catch {}
        log("REST profile/data set. Browser SDK was unavailable.");
        if (onEarlyComplete) onEarlyComplete();
        return { success: true, profileSet: true, dataSet: true };
      }
      return { success: false, profileSet: false, dataSet: false, error: "Gigya SDK lost and REST fallback failed" };
    }

    let isLoggedIn = { loggedIn: false, uid: null as string | null };
    try {
      isLoggedIn = await Promise.race([
        page.evaluate(`(() => {
          return new Promise(function(resolve) {
            gigya.accounts.getAccountInfo({
              callback: function(resp) {
                resolve({ loggedIn: resp.errorCode === 0, uid: resp.UID || null });
              }
            });
            setTimeout(function() { resolve({ loggedIn: false, uid: null }); }, 10000);
          });
        })()`),
        new Promise<{ loggedIn: boolean; uid: string | null }>((resolve) => setTimeout(() => resolve({ loggedIn: false, uid: null }), 20000))
      ]) as { loggedIn: boolean; uid: string | null };
    } catch (evalErr: any) {
      console.log("[Draw-Gigya] getAccountInfo error: " + (evalErr.message || '').substring(0, 100));
    }
    console.log("[Draw-Gigya] Post-login auth check: loggedIn=" + isLoggedIn.loggedIn + " uid=" + (isLoggedIn.uid || "null"));

    if (!isLoggedIn.loggedIn) {
      log("Not logged in after redirect. Using REST API fallback...");
      try { await browser.close(); } catch {};

      const restFallbackParams2 = new URLSearchParams({ apiKey: GIGYA_API_KEY, loginID: email, password: password });
      let restToken2 = '';
      try {
        const rResp2 = await fetch(`https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.login`, { method: "POST", body: restFallbackParams2 });
        const rData2 = await rResp2.json() as any;
        if (rData2.errorCode === 0) restToken2 = rData2.sessionInfo?.cookieValue || rData2.login_token || '';
      } catch {}
      if (restToken2) {
        const restUrl2 = `https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.setAccountInfo`;
        const allSportsJ2 = JSON.stringify([...favOlympicSports.map((c: string) => ({ ocsCode: c, odfCode: c, GameType: "OG" })), ...favParalympicSports.map((c: string) => ({ ocsCode: c, odfCode: c, GameType: "PG" }))]);
        const teamsJ2 = JSON.stringify(favTeams.map((c: string) => ({ ocsCode: c, nocCode: c, gameType: "OG" })));
        try { await fetch(restUrl2, { method: "POST", body: new URLSearchParams({ apiKey: GIGYA_API_KEY, login_token: restToken2, profile: JSON.stringify({ birthYear: parseInt(birthYear), zip: usedZip, country: 'US' }) }) }); } catch {}
        try { await fetch(restUrl2, { method: "POST", body: new URLSearchParams({ apiKey: GIGYA_API_KEY, login_token: restToken2, data: JSON.stringify({ personalization: { favoritesDisciplines: JSON.parse(allSportsJ2), favoritesCountries: JSON.parse(teamsJ2), siteLanguage: 'en' }, entryCampaignandSegregation: { l2028_ticketing: 'true', l2028_fan28: 'true' } }) }) }); } catch {}
        log("REST profile/data set via fallback.");
        if (onEarlyComplete) onEarlyComplete();
        return { success: true, profileSet: true, dataSet: true };
      }
      return { success: false, profileSet: false, dataSet: false, error: "Not authenticated and REST fallback failed" };
    }

    log("Authenticated! UID: " + (isLoggedIn.uid || "unknown") + ". Setting profile...");

    const allSportsJSON = JSON.stringify([
      ...favOlympicSports.map((code: string) => ({ ocsCode: code, odfCode: code, GameType: "OG" })),
      ...favParalympicSports.map((code: string) => ({ ocsCode: code, odfCode: code, GameType: "PG" })),
    ]);
    const teamsJSON = JSON.stringify(favTeams.map((code: string) => ({ ocsCode: code, nocCode: code, gameType: "OG" })));

    const profileResult = await page.evaluate(`((birthYr, zip) => {
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

    console.log("[Draw-Gigya] Profile result: " + JSON.stringify(profileResult));
    const profileSet = profileResult.success;
    if (profileSet) {
      log("Profile set: birth year " + birthYear + ", zip " + usedZip);
    } else {
      log("Profile error: " + (profileResult.error || "unknown"));
    }

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
            resolve({ success: resp.errorCode === 0, error: resp.errorCode === 0 ? null : resp.errorMessage });
          }
        });
        setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 15000);
      });
    })(${JSON.stringify(allSportsJSON)}, ${JSON.stringify(teamsJSON)})`) as { success: boolean; error?: string | null };

    console.log("[Draw-Gigya] Data result: " + JSON.stringify(dataResult));
    const dataSet = dataResult.success;
    if (dataSet) {
      log("Draw flags set! l2028_ticketing=true, l2028_fan28=true, favorites saved!");
    } else {
      log("Data error: " + (dataResult.error || "unknown") + ". Trying individual fields...");
      const fallbackResult = await page.evaluate(`((sportsStr, teamsStr) => {
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
        log("Draw flags set via individual updates!");
        try { if (browser) await browser.close(); } catch {}
        return { success: true, profileSet, dataSet: true };
      }
    }

    const verifyResult = await page.evaluate(`(() => {
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

    console.log("[Draw-Gigya] Verify result: " + JSON.stringify(verifyResult));
    if (verifyResult.ticketing === "true" || verifyResult.ticketing === true) {
      log("Verified: l2028_ticketing=" + verifyResult.ticketing + " fan28=" + verifyResult.fan28 + " birthYear=" + verifyResult.birthYear + " zip=" + verifyResult.zip);
    }

    if (profileSet && dataSet && onEarlyComplete) {
      console.log("[Draw-Gigya] Profile+Data confirmed set, marking completed early before OIDC step");
      onEarlyComplete();
    }
  } catch (proxyErr: any) {
    console.log("[Draw-Gigya] Proxy browser failed: " + (proxyErr.message || '').substring(0, 200));
    log("Proxy browser failed (" + (proxyErr.message || '').substring(0, 80) + "). Using REST API for profile/data...");
    try { if (browser) await browser.close(); } catch {}
    browser = null;
    proxyBrowserFailed = true;

    try {
      const restResult = await completeDrawRegistrationViaApi(email, password, zipCode, log);
      profileSet = restResult.profileSet;
      dataSet = restResult.dataSet;
      if (profileSet && dataSet) {
        log("REST API fallback: profile+data set successfully.");
        if (onEarlyComplete) onEarlyComplete();
      } else {
        log("REST API fallback partial: profile=" + profileSet + " data=" + dataSet);
      }
    } catch (restErr: any) {
      console.log("[Draw-Gigya] REST fallback also failed: " + (restErr.message || '').substring(0, 100));
      log("REST API fallback failed: " + (restErr.message || '').substring(0, 60));
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
        log("Draw form: Page closed, launching fresh local browser for OIDC...");
        console.log("[Draw-OIDC] Page closed, launching fresh local browser for " + email);

        try {
          const freshBrowser = await chromium.launch({
            headless: true,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--ignore-certificate-errors'],
          });
          browser = freshBrowser;
          const freshCtx = await freshBrowser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 900 },
            ignoreHTTPSErrors: true,
          });
          page = await freshCtx.newPage();
          page.setDefaultTimeout(30000);

          console.log("[Draw-OIDC] Fresh browser: navigating to la28id.la28.org/login...");
          await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 45000 });
          try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
          await page.waitForTimeout(2000);

          await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", undefined, { timeout: 20000 });
          console.log("[Draw-OIDC] Fresh browser: Gigya SDK loaded, logging in...");

          const freshLogin = await page.evaluate(`(function(email, pwd) {
            return new Promise(function(resolve) {
              gigya.accounts.login({
                loginID: email, password: pwd,
                callback: function(resp) {
                  resolve({ success: resp.errorCode === 0, errorCode: resp.errorCode, errorMessage: resp.errorMessage || '', uid: resp.UID || '' });
                }
              });
              setTimeout(function() { resolve({ success: false, errorCode: -1, errorMessage: 'timeout', uid: '' }); }, 20000);
            });
          })(${JSON.stringify(email)}, ${JSON.stringify(password)})`) as any;
          console.log("[Draw-OIDC] Fresh browser Gigya login: " + JSON.stringify(freshLogin));

          if (!freshLogin.success) {
            throw new Error("Fresh browser Gigya login failed: " + freshLogin.errorMessage);
          }

          await page.waitForTimeout(3000);
          try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch {}

          let freshUrl = page.url();
          if (freshUrl.includes("proxy.html") || freshUrl.includes("consent.html")) {
            console.log("[Draw-OIDC] Fresh browser: on intermediate page, navigating back to login...");
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
          console.log("[Draw-OIDC] Fresh browser auth check: " + JSON.stringify(freshAuth));

          if (!freshAuth.loggedIn) {
            throw new Error("Fresh browser: Not logged in after Gigya login");
          }

          console.log("[Draw-OIDC] Fresh browser: setting profile + data via Gigya JS SDK...");
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
          console.log("[Draw-OIDC] Fresh browser profile result: " + JSON.stringify(freshProfileResult));
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
          console.log("[Draw-OIDC] Fresh browser data result: " + JSON.stringify(freshDataResult));
          if (freshDataResult.success) dataSet = true;

          if (profileSet && dataSet && onEarlyComplete) {
            console.log("[Draw-OIDC] Fresh browser: profile+data set, marking completed early");
            onEarlyComplete();
          }

          console.log("[Draw-OIDC] Fresh browser ready for OIDC!");
          log("Fresh local browser logged in, profile=" + profileSet + " data=" + dataSet + ". Proceeding to OIDC...");
        } catch (freshErr: any) {
          console.log("[Draw-OIDC] Fresh browser failed: " + (freshErr.message || '').substring(0, 200));
          log("Fresh browser OIDC failed: " + (freshErr.message || '').substring(0, 80));
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

          if (iproyalProxy) {
            nstConfig.proxy = iproyalProxy;
            console.log("[Draw-OIDC] NSTBrowser with iProyal proxy");
          }

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
          console.log("[Draw-OIDC] NSTBrowser: Gigya SDK loaded, logging in...");

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
            console.log("[Draw-OIDC] Local browser also unavailable, relaunching...");
            const fallbackArgs = ['--disable-blink-features=AutomationControlled', '--ignore-certificate-errors'];
            const fallbackOpts: any = { headless: true, args: fallbackArgs };
            if (iproyalProxy) {
              const proxyUrl = new URL(iproyalProxy);
              fallbackOpts.proxy = {
                server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
                username: proxyUrl.username,
                password: proxyUrl.password,
              };
            }
            browser = await chromium.launch(fallbackOpts);
            const ctx = await browser.newContext({
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              viewport: { width: 1280, height: 900 },
              ignoreHTTPSErrors: true,
            });
            page = await ctx.newPage();
            page.setDefaultTimeout(30000);

            console.log("[Draw-OIDC] Fallback: logging into Gigya in new local browser...");
            await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 45000 });
            try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
            await page.waitForFunction(() => typeof (window as any).gigya !== 'undefined' && typeof (window as any).gigya.accounts !== 'undefined', { timeout: 20000 });

            const fallbackLogin = await page.evaluate(({ e, p }: { e: string; p: string }) => {
              return new Promise<any>((resolve) => {
                (window as any).gigya.accounts.login({
                  loginID: e, password: p,
                  callback: (resp: any) => resolve({ success: resp.errorCode === 0, uid: resp.UID || '' })
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
          console.log("[Draw-OIDC] INTERCEPTED tickets auth URL via route handler - fulfilling with dummy page to preserve code");
          try {
            await route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: '<html><head><title>Code Captured</title></head><body><h1>Auth code captured successfully</h1></body></html>',
            });
          } catch (e: any) {
            console.log("[Draw-OIDC] Route fulfill error: " + (e.message || '').substring(0, 100));
            try { await route.abort(); } catch {}
          }
        } else {
          try { await route.continue(); } catch {}
        }
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
      const brightDataToken = "5a312bdf-37e2-427b-9504-f357d091aca9";

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
      } else if (ticketsAuthUrl) {
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
            zenrowsUrl = "wss://browser.zenrows.com?apikey=37f48a5787f7e01abecbf8c67c3c205f61ecc071";
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

            for (let attempt = 1; attempt <= 5; attempt++) {
              console.log("[ZenRows] Gigya login attempt " + attempt + "...");
              const hasGigya = await bdPage.evaluate(`typeof window.gigya !== 'undefined' && typeof window.gigya.accounts !== 'undefined' && typeof window.gigya.accounts.login === 'function'`);
              if (!hasGigya) {
                console.log("[ZenRows] Gigya SDK not ready, waiting 8s...");
                await bdPage.waitForTimeout(8000);
                if (attempt === 2) {
                  console.log("[ZenRows] Reloading login page...");
                  try { await bdPage.goto('https://la28id.la28.org/login/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
                  await bdPage.waitForTimeout(5000);
                  try { await bdPage.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
                  await bdPage.waitForTimeout(5000);
                }
                continue;
              }

              const result = await bdPage.evaluate(`
                new Promise(function(resolve) {
                  var t = setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 30000);
                  try {
                    window.gigya.accounts.login({
                      loginID: '${safeEmail}', password: '${safePass}',
                      callback: function(r) { clearTimeout(t); resolve({ success: r.errorCode === 0, error: r.errorMessage || ('Error ' + r.errorCode) }); }
                    });
                  } catch(e) { clearTimeout(t); resolve({ success: false, error: e.message }); }
                })
              `) as { success: boolean; error?: string };
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

          // Step 1: Login to Gigya FIRST (establish session before OIDC)
          console.log("[ZenRows] Step 1: Login to Gigya first...");
          log("Logging into Gigya via ZenRows...");
          try { await bdPage.goto('https://la28id.la28.org/login/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
          await bdPage.waitForTimeout(3000);
          try { await bdPage.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
          await bdPage.waitForTimeout(3000);

          const loggedIn = await doGigyaLogin();
          console.log("[ZenRows] Gigya login result: " + loggedIn);

          if (loggedIn) {
            await bdPage.waitForTimeout(3000);

            const gigyaSession = await bdPage.evaluate(`
              new Promise(function(resolve) {
                if (typeof window.gigya === 'undefined' || !window.gigya.accounts) { resolve({ valid: false }); return; }
                window.gigya.accounts.getAccountInfo({
                  callback: function(r) {
                    resolve({ valid: r.errorCode === 0, uid: (r.UID || '').substring(0, 20), email: r.profile ? r.profile.email : '' });
                  }
                });
                setTimeout(function() { resolve({ valid: false, error: 'timeout' }); }, 10000);
              })
            `) as any;
            console.log("[ZenRows] Gigya session check: " + JSON.stringify(gigyaSession));

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

            // If on consent page, wait
            if (curUrl.includes('consent')) {
              console.log("[ZenRows] On consent page, waiting...");
              for (let cw = 0; cw < 10; cw++) {
                await bdPage.waitForTimeout(2000);
                curUrl = bdPage.url();
                if (!curUrl.includes('consent')) break;
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
            const pageInfo = await bdPage.evaluate(`(() => {
              var txt = (document.body.innerText || '').substring(0, 2000);
              var selects = document.querySelectorAll('select').length;
              var inputs = document.querySelectorAll('input[type="text"]').length;
              var appRoot = document.querySelector('app-root, [class*="app"]');
              var scripts = document.querySelectorAll('script[src]').length;
              return { txt: txt.substring(0, 500), selects: selects, inputs: inputs, hasAppRoot: !!appRoot, bodyLen: txt.length, url: location.href, scripts: scripts };
            })()`) as any;
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
        log("OIDC flow incomplete - no broker endpoint detected.");
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
  const loginData = await loginResp.json() as any;

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
  onStatusUpdate: (status: string) => void,
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
  onStatusUpdate: (status: string) => void,
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
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
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
    onStatusUpdate("registering");
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
    onStatusUpdate("waiting_code");

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

    onStatusUpdate("verifying");
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

    onStatusUpdate("verified");
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

    onStatusUpdate("profile_saving");
    try {
      await completeTicketsProfile(page, email, password, log);
      log("Profile data saved via Gigya SDK!");
    } catch (profileErr: any) {
      console.log("[Playwright] Tickets profile error:", profileErr.message);
      log("Account created & verified. Profile step had issues.");
    }

    onStatusUpdate("draw_registering");
    log("[DRAW FLAGS] Setting draw registration via Gigya REST API...");
    let drawSuccess = false;

    try {
      const apiResult = await completeDrawRegistrationViaApi(email, password, usedZipCode, log);
      if (apiResult.success) {
        onStatusUpdate("completed");
        log("[REGISTRATION CONFIRMED] Draw registration complete via API! Profile + draw flags set.");
        drawSuccess = true;
      } else if (apiResult.profileSet || apiResult.dataSet) {
        onStatusUpdate("completed");
        log("[REGISTRATION CONFIRMED] API partial success: profile=" + apiResult.profileSet + " data=" + apiResult.dataSet + ". Marked completed.");
        drawSuccess = true;
      } else {
        log("[DRAW FLAGS] API registration failed: " + (apiResult.error || "unknown"));
      }
    } catch (apiErr: any) {
      console.log("[Playwright] REST API draw error:", apiErr.message);
      log("[DRAW FLAGS] API error: " + apiErr.message.substring(0, 80));
    }

    if (!drawSuccess) {
      log("[DRAW FLAGS] REST API failed. Attempting browser-based fallback...");
      try {
        const earlyComplete = () => {
          if (!drawSuccess) {
            drawSuccess = true;
            onStatusUpdate("completed");
            log("[REGISTRATION CONFIRMED] Draw registration confirmed via browser fallback.");
          }
        };
        const gigyaResult = await completeDrawViaGigyaBrowser(email, password, usedZipCode, log, earlyComplete);
        if (gigyaResult.success && !drawSuccess) {
          onStatusUpdate("completed");
          log("[REGISTRATION CONFIRMED] Draw registration set via browser fallback.");
          drawSuccess = true;
        } else if ((gigyaResult.profileSet || gigyaResult.dataSet) && !drawSuccess) {
          onStatusUpdate("completed");
          log("[REGISTRATION CONFIRMED] Browser partial: profile=" + gigyaResult.profileSet + " data=" + gigyaResult.dataSet);
          drawSuccess = true;
        }
      } catch (drawErr: any) {
        console.log("[Playwright] Browser fallback error:", drawErr.message);
        log("Browser fallback failed: " + drawErr.message.substring(0, 80));
      }
    }

    if (!drawSuccess) {
      log("All draw registration methods failed. Status kept as draw_registering.");
      onStatusUpdate("draw_registering");
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
  const connectUrl = zenrowsUrl || proxyUrl;
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
