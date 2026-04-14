/**
 * Diagnostic: intercept Sentinel API responses to expose the signup form.
 * Run: npx tsx server/_test_sentinel_intercept.ts
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== Sentinel Interception Diagnostic ===\n");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1280,800",
      "--lang=en-US",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    (window as any).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    // WebGL masking
    const origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
      if (parameter === 37445) return "Intel Inc.";
      if (parameter === 37446) return "Intel Iris OpenGL Engine";
      return origGetParam.call(this, parameter);
    };
  });

  const page = await context.newPage();

  // Log ALL sentinel.openai.com requests and responses
  const sentinelRequests: string[] = [];
  context.on("request", req => {
    if (req.url().includes("sentinel")) {
      sentinelRequests.push(`REQ: ${req.method()} ${req.url().slice(0, 120)}`);
      console.log(`→ ${req.method()} ${req.url().slice(0, 100)}`);
    }
  });
  context.on("response", async resp => {
    if (resp.url().includes("sentinel")) {
      let body = "";
      try { body = await resp.text(); } catch {}
      console.log(`← ${resp.status()} ${resp.url().slice(0, 80)} | body: ${body.slice(0, 200)}`);
    }
  });

  const SIGNUP_URL =
    "https://auth.openai.com/authorize" +
    "?client_id=app_X8zY6vW2pQ9tR3dE7nK1jL5gH" +
    "&scope=openid%20email%20profile%20offline_access%20model.request%20model.read%20organization.read%20organization.write" +
    "&response_type=code" +
    "&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Fopenai" +
    "&audience=https%3A%2F%2Fapi.openai.com%2Fv1" +
    "&screen_hint=signup";

  console.log("Navigating...\n");
  await page.goto(SIGNUP_URL, { waitUntil: "load", timeout: 60_000 });

  // Wait 10s and monitor network
  await new Promise(r => setTimeout(r, 10_000));

  console.log("\n--- Page state after 10s ---");
  const url = page.url();
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "(empty)");
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map(i => `${(i as HTMLInputElement).type}[${(i as HTMLInputElement).name}]`).join(", ")
  );
  console.log(`URL: ${url.slice(0, 80)}`);
  console.log(`Text: ${text.replace(/\n/g, " ").trim().slice(0, 150)}`);
  console.log(`Inputs: ${inputs || "(none)"}`);

  // Check what auth.openai.com requests are being made
  context.on("request", req => {
    if (req.url().includes("auth.openai.com")) {
      console.log(`AUTH REQ: ${req.method()} ${req.url().slice(0, 120)}`);
    }
  });

  // Wait more and check again
  await new Promise(r => setTimeout(r, 15_000));

  console.log("\n--- Page state after 25s ---");
  const url2 = page.url();
  const text2 = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "(empty)");
  const inputs2 = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map(i => `${(i as HTMLInputElement).type}[${(i as HTMLInputElement).name}]`).join(", ")
  );
  console.log(`URL: ${url2.slice(0, 80)}`);
  console.log(`Text: ${text2.replace(/\n/g, " ").trim().slice(0, 150)}`);
  console.log(`Inputs: ${inputs2 || "(none)"}`);
  console.log(`\nAll Sentinel requests:\n${sentinelRequests.join("\n")}`);

  await browser.close();
  console.log("\nDone.");
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
