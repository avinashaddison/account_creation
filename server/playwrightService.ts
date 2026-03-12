import { chromium, type Browser, type Page } from "playwright";
import { execSync } from "child_process";

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

export async function completeDrawViaGigyaBrowser(
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

  log("Draw via Gigya browser: launching headless browser (no proxy)...");
  console.log("[Draw-Gigya] Starting for " + email);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) return route.abort();
      return route.continue();
    });

    log("Navigating to la28id.la28.org/login...");
    console.log("[Draw-Gigya] Navigating to la28id.la28.org/login...");
    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
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
      return { success: false, profileSet: false, dataSet: false, error: "Gigya SDK not loaded" };
    }

    log("Gigya SDK loaded. Logging in...");
    console.log("[Draw-Gigya] Gigya SDK loaded, logging in...");

    let loginOk = false;
    try {
      const loginResult = await page.evaluate(`((loginEmail, loginPass) => {
        return new Promise(function(resolve) {
          gigya.accounts.login({
            loginID: loginEmail,
            password: loginPass,
            callback: function(resp) {
              resolve({
                ok: resp.errorCode === 0,
                uid: resp.UID || null,
                err: resp.errorCode === 0 ? null : (resp.errorMessage || 'Code: ' + resp.errorCode),
                code: resp.errorCode
              });
            }
          });
          setTimeout(function() { resolve({ ok: false, uid: null, err: 'timeout', code: -1 }); }, 20000);
        });
      })("${email.replace(/"/g, '\\"')}", "${password.replace(/"/g, '\\"')}")`) as { ok: boolean; uid: string | null; err: string | null; code: number };

      console.log("[Draw-Gigya] Login result: ok=" + loginResult.ok + " uid=" + (loginResult.uid || "null") + " err=" + loginResult.err);
      if (!loginResult.ok) {
        log("Gigya login failed: " + (loginResult.err || "unknown"));
        return { success: false, profileSet: false, dataSet: false, error: "Login failed: " + loginResult.err };
      }
      loginOk = true;
      log("Logged in! UID: " + (loginResult.uid || "unknown"));
    } catch (loginErr: any) {
      if (loginErr.message.includes("context was destroyed") || loginErr.message.includes("navigation")) {
        console.log("[Draw-Gigya] Login caused page navigation (expected for successful login)");
        loginOk = true;
        log("Login triggered redirect (likely successful).");
      } else {
        console.log("[Draw-Gigya] Login error: " + loginErr.message.substring(0, 150));
        return { success: false, profileSet: false, dataSet: false, error: "Login error: " + loginErr.message.substring(0, 80) };
      }
    }

    if (!loginOk) {
      return { success: false, profileSet: false, dataSet: false, error: "Login did not succeed" };
    }

    log("Waiting for post-login page to stabilize...");
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch {}
    await page.waitForTimeout(3000);

    const postLoginUrl = page.url();
    console.log("[Draw-Gigya] Post-login URL: " + postLoginUrl);

    console.log("[Draw-Gigya] Re-waiting for Gigya SDK after login...");
    try {
      await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 20000 });
    } catch {
      log("Gigya SDK not available after login redirect. Navigating to la28id homepage...");
      await page.goto("https://la28id.la28.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
      try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
      await page.waitForTimeout(3000);
      try {
        await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 20000 });
      } catch {
        return { success: false, profileSet: false, dataSet: false, error: "Gigya SDK lost after login" };
      }
    }

    const isLoggedIn = await page.evaluate(`(() => {
      return new Promise(function(resolve) {
        gigya.accounts.getAccountInfo({
          callback: function(resp) {
            resolve({ loggedIn: resp.errorCode === 0, uid: resp.UID || null });
          }
        });
        setTimeout(function() { resolve({ loggedIn: false, uid: null }); }, 10000);
      });
    })()`) as { loggedIn: boolean; uid: string | null };
    console.log("[Draw-Gigya] Post-login auth check: loggedIn=" + isLoggedIn.loggedIn + " uid=" + (isLoggedIn.uid || "null"));

    if (!isLoggedIn.loggedIn) {
      log("Not logged in after redirect. Login may have failed.");
      return { success: false, profileSet: false, dataSet: false, error: "Not authenticated after login redirect" };
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
    })("${birthYear}", "${usedZip}")`) as { success: boolean; error?: string | null };

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
    })('${allSportsJSON.replace(/'/g, "\\'")}', '${teamsJSON.replace(/'/g, "\\'")}')`) as { success: boolean; error?: string | null };

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
      })('${allSportsJSON.replace(/'/g, "\\'")}', '${teamsJSON.replace(/'/g, "\\'")}')`) as { success: boolean; error?: string | null };

      if (fallbackResult.success) {
        log("Draw flags set via individual updates!");
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

    let oidcLinked = false;
    try {
      log("Attempting OIDC account linking with Eventim/Keycloak...");
      console.log("[Draw-Gigya] Starting OIDC flow for Keycloak account linking...");

      let capturedRedirectUrl: string | null = null;
      page.on('response', (resp: any) => {
        const loc = resp.headers()['location'] || '';
        if (loc.includes('tickets.la28.org') && loc.includes('code=')) {
          capturedRedirectUrl = loc;
        }
      });

      const oidcAuthUrl = 'https://public-api.eventim.com/identity/auth/realms/la28-org/protocol/openid-connect/auth?' + new URLSearchParams({
        response_type: 'code', client_id: 'web-sso__la28-org', scope: 'openid',
        kc_idp_hint: 'gigya', ui_locales: 'en',
        redirect_uri: 'https://tickets.la28.org/mycustomerdata/'
      }).toString();

      try {
        await page.goto(oidcAuthUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch {}

      for (let qi = 0; qi < 30 && !capturedRedirectUrl; qi++) {
        await page.waitForTimeout(3000);
        if (qi % 10 === 0 && qi > 0) {
          console.log("[Draw-Gigya] Waiting for Queue-it... " + (qi * 3) + "s");
        }
      }

      if (capturedRedirectUrl) {
        oidcLinked = true;
        const codeUrl = new URL(capturedRedirectUrl);
        const authCode = codeUrl.searchParams.get('code');
        console.log("[Draw-Gigya] OIDC account linked! Auth code: " + (authCode?.substring(0, 20) || "unknown"));
        log("OIDC account linked with Eventim/Keycloak successfully!");
      } else {
        console.log("[Draw-Gigya] OIDC linking: Queue-it timeout or no redirect captured. URL: " + page.url().substring(0, 150));
        log("OIDC linking attempted but Queue-it timeout. Gigya data is still set correctly.");
      }
    } catch (oidcErr: any) {
      console.log("[Draw-Gigya] OIDC linking error (non-fatal): " + oidcErr.message.substring(0, 100));
      log("OIDC linking skipped: " + oidcErr.message.substring(0, 60));
    }

    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}

    const success = profileSet && dataSet;
    return { success, profileSet, dataSet, oidcLinked };
  } catch (err: any) {
    console.log("[Draw-Gigya] Error: " + err.message.substring(0, 200));
    log("Draw via Gigya browser error: " + err.message.substring(0, 100));
    try { if (browser) await browser.close(); } catch {}
    return { success: false, profileSet: false, dataSet: false, error: err.message };
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

  log("REST API draw registration: logging in...");

  const loginParams = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    loginID: email,
    password: password,
  });
  const loginResp = await fetch(`https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.login`, { method: "POST", body: loginParams });
  const loginData = await loginResp.json() as any;

  if (loginData.errorCode !== 0) {
    log("REST login failed: " + (loginData.errorMessage || "code " + loginData.errorCode));
    return { success: false, profileSet: false, dataSet: false, error: loginData.errorMessage || "Login failed" };
  }

  const loginToken = loginData.sessionInfo?.cookieValue || loginData.login_token;
  if (!loginToken) {
    log("No session token from login response");
    return { success: false, profileSet: false, dataSet: false, error: "No session token" };
  }

  log("Logged in via REST API. UID: " + (loginData.UID || "unknown"));

  const apiUrl = `https://accounts.${GIGYA_DATACENTER}.gigya.com/accounts.setAccountInfo`;

  log("Setting profile: birth year " + birthYear + ", zip " + usedZip + "...");
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
    log("Profile set: birth year " + birthYear + ", zip " + usedZip);
  } else {
    log("Profile error: " + (profileData.errorMessage || "code " + profileData.errorCode));
  }

  const allSports = [
    ...favOlympicSports.map(code => ({ ocsCode: code, odfCode: code, GameType: "OG" })),
    ...favParalympicSports.map(code => ({ ocsCode: code, odfCode: code, GameType: "PG" })),
  ];
  const teamObjs = favTeams.map(code => ({ ocsCode: code, nocCode: code, gameType: "OG" }));

  log("Setting favorites: " + favOlympicSports.length + " Olympic + " + favParalympicSports.length + " Paralympic sports, " + favTeams.length + " teams, + draw flags...");
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
    log("Draw registration data set: l2028_ticketing=true, l2028_fan28=true, favorites saved!");
  } else {
    log("Data error: " + (dataData.errorMessage || "code " + dataData.errorCode));
  }

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
    log("Verified: ticketing=" + ticketing + " fan28=" + fan28 + " birthYear=" + bYear + " zip=" + zip);
  }

  const success = profileSet && dataSet;
  if (success) {
    log("REST API draw registration complete! Profile and draw flags set successfully.");
  } else {
    log("REST API draw registration partial: profile=" + profileSet + " data=" + dataSet);
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
    log("Setting draw registration via Gigya browser (no proxy needed)...");
    try {
      const gigyaResult = await completeDrawViaGigyaBrowser(email, password, usedZipCode, log);
      if (gigyaResult.success) {
        onStatusUpdate("completed");
        log("Full flow complete! Draw registration set via Gigya browser.");
      } else if (gigyaResult.profileSet || gigyaResult.dataSet) {
        onStatusUpdate("completed");
        log("Draw registration partially set (profile=" + gigyaResult.profileSet + " data=" + gigyaResult.dataSet + "). Marked as completed.");
      } else {
        log("Gigya browser draw failed: " + (gigyaResult.error || "unknown") + ". Keeping as draw_registering for retry.");
        onStatusUpdate("draw_registering");
      }
    } catch (drawErr: any) {
      console.log("[Playwright] Draw error:", drawErr.message);
      log("Draw error (" + drawErr.message.substring(0, 80) + "). Status kept as draw_registering for retry.");
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
  const browser = await chromium.connectOverCDP(proxyUrl, { timeout: 60000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    log("Connected to browser.");

    const result = await loginAndSubmitTicketRegistration(page, email, password, log, proxyUrl, zipCode || undefined);
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
