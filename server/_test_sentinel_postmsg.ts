/**
 * Intercepts postMessage between Sentinel iframe and main page.
 * Run: npx tsx server/_test_sentinel_postmsg.ts
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== Sentinel postMessage Diagnostic ===\n");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,800", "--lang=en-US",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });

  // Hook postMessage BEFORE any scripts load
  await context.addInitScript(() => {
    const origAEL = window.addEventListener.bind(window);
    window.addEventListener = function(type: string, listener: any, opts?: any) {
      if (type === "message") {
        const wrapped = (e: MessageEvent) => {
          console.log("[PM]", JSON.stringify({ origin: e.origin, data: e.data }));
          listener(e);
        };
        return origAEL(type, wrapped, opts);
      }
      return origAEL(type, listener, opts);
    };

    // Also hook the native postMessage
    const origPM = window.postMessage.bind(window);
    window.postMessage = function(msg: any, origin: any, ...rest: any[]) {
      console.log("[SENT PM]", JSON.stringify({ msg, origin }));
      return origPM(msg, origin, ...rest);
    };

    // WebGL masking
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    const origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
      if (parameter === 37445) return "Intel Inc.";
      if (parameter === 37446) return "Intel Iris OpenGL Engine";
      return origGetParam.call(this, parameter);
    };
  });

  const page = await context.newPage();

  // Capture console.log from page
  page.on("console", msg => {
    if (msg.text().startsWith("[PM]") || msg.text().startsWith("[SENT PM]")) {
      console.log("PAGE:", msg.text().slice(0, 200));
    }
  });

  // Watch for any auth.openai.com requests after Sentinel
  const authRequests: string[] = [];
  context.on("request", req => {
    const u = req.url();
    if (u.includes("auth.openai.com") && !u.includes("authorize")) {
      authRequests.push(`${req.method()} ${u.slice(0, 100)}`);
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

  // Wait for Sentinel to finish
  await new Promise(r => setTimeout(r, 20_000));

  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "(empty)");
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map(i => `${(i as HTMLInputElement).type}[${(i as HTMLInputElement).name}]`).join(", ")
  );
  console.log(`\nPage text: ${text.replace(/\n/g, " ").trim().slice(0, 150)}`);
  console.log(`Inputs: ${inputs || "(none)"}`);
  console.log(`Auth requests: ${authRequests.join(", ") || "(none)"}`);

  // Try injecting a fake Sentinel success message from the iframe origin
  console.log("\n--- Attempting Sentinel bypass via postMessage injection ---");
  await page.evaluate(() => {
    // Try common sentinel token message formats
    const formats = [
      { sentinel_token: "fake-token-123", type: "sentinel_token" },
      { type: "sentinel_success", token: "fake-token" },
      { sentinel: "success", token: "fake-token" },
      { event: "sentinel_done", data: { token: "fake-token" } },
    ];
    for (const msg of formats) {
      window.postMessage(msg, "*");
    }
    // Try posting from sentinel.openai.com origin (fake it)
    window.dispatchEvent(new MessageEvent("message", {
      data: { sentinel_token: "bypass-123" },
      origin: "https://sentinel.openai.com",
    }));
  });
  await new Promise(r => setTimeout(r, 3000));

  const text2 = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "(empty)");
  const inputs2 = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map(i => `${(i as HTMLInputElement).type}[${(i as HTMLInputElement).name}]`).join(", ")
  );
  console.log(`\nAfter postMessage injection:`);
  console.log(`Page text: ${text2.replace(/\n/g, " ").trim().slice(0, 150)}`);
  console.log(`Inputs: ${inputs2 || "(none)"}`);

  await browser.close();
  console.log("\nDone.");
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
