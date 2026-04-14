/**
 * Diagnostic: inspect the OpenAI Sentinel bot-detection iframe.
 * Run: npx tsx server/_test_sentinel.ts
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== Sentinel Iframe Diagnostic ===\n");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
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
  });

  const page = await context.newPage();

  const SIGNUP_URL =
    "https://auth.openai.com/authorize" +
    "?client_id=app_X8zY6vW2pQ9tR3dE7nK1jL5gH" +
    "&scope=openid%20email%20profile%20offline_access%20model.request%20model.read%20organization.read%20organization.write" +
    "&response_type=code" +
    "&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Fopenai" +
    "&audience=https%3A%2F%2Fapi.openai.com%2Fv1" +
    "&screen_hint=signup";

  console.log("Navigating...");
  await page.goto(SIGNUP_URL, { waitUntil: "load", timeout: 60_000 });
  await new Promise(r => setTimeout(r, 6000));

  // Check main page
  const mainUrl = page.url();
  const mainHtmlLen = await page.evaluate(() => document.body?.innerHTML?.length ?? 0);
  const mainText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "(empty)");
  console.log(`Main page URL: ${mainUrl.slice(0, 100)}`);
  console.log(`Main HTML length: ${mainHtmlLen}`);
  console.log(`Main text: ${mainText.replace(/\n/g, " ").trim()}`);

  // Get the raw HTML snippet around sentinel
  const sentinelHtml = await page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    return iframe?.outerHTML?.slice(0, 500) ?? "(no iframe)";
  });
  console.log(`\nSentinel iframe HTML: ${sentinelHtml}`);

  // Get ALL hidden inputs (for CSRF tokens etc.)
  const hiddenInputs = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="hidden"]')]
      .map(i => `name=${(i as HTMLInputElement).name} value=${(i as HTMLInputElement).value?.slice(0, 50)}`)
      .join("\n")
  );
  console.log(`\nHidden inputs:\n${hiddenInputs || "(none)"}`);

  // Get all links
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .map(a => (a as HTMLAnchorElement).href.slice(0, 80))
      .slice(0, 10)
      .join("\n")
  );
  console.log(`\nLinks:\n${links || "(none)"}`);

  // Access the Sentinel iframe directly
  console.log("\n--- Accessing Sentinel iframe directly ---");
  const sentinelPage = await context.newPage();
  const sentinelUrl = "https://sentinel.openai.com/backend-api/sentinel/frame.html?sv=20260219f9f6";
  try {
    await sentinelPage.goto(sentinelUrl, { waitUntil: "load", timeout: 30_000 });
    await new Promise(r => setTimeout(r, 3000));
    const sUrl = sentinelPage.url();
    const sTitle = await sentinelPage.title();
    const sText = await sentinelPage.evaluate(() => document.body?.innerText?.slice(0, 400) ?? "(empty)");
    const sHtmlLen = await sentinelPage.evaluate(() => document.body?.innerHTML?.length ?? 0);
    const sInputs = await sentinelPage.evaluate(() =>
      [...document.querySelectorAll("input")].map(i => `${(i as HTMLInputElement).type}[${(i as HTMLInputElement).name}]`).join(", ")
    );
    const sChallengeType = await sentinelPage.evaluate(() => {
      // Check for Arkose Labs / FunCaptcha
      const fcScript = [...document.querySelectorAll("script")].some(s => s.src.includes("funcaptcha") || s.src.includes("arkoselabs") || (s.textContent ?? "").includes("arkose"));
      // Check for hCaptcha
      const hcScript = [...document.querySelectorAll("script")].some(s => s.src.includes("hcaptcha"));
      // Check for Turnstile
      const tsScript = [...document.querySelectorAll("script")].some(s => s.src.includes("challenges.cloudflare"));
      return { fcScript, hcScript, tsScript };
    });
    console.log(`Sentinel URL: ${sUrl}`);
    console.log(`Sentinel title: "${sTitle}"`);
    console.log(`Sentinel text: ${sText.replace(/\n/g, " ").trim()}`);
    console.log(`Sentinel HTML length: ${sHtmlLen}`);
    console.log(`Sentinel inputs: ${sInputs || "(none)"}`);
    console.log(`Sentinel challenge type: ${JSON.stringify(sChallengeType)}`);

    // Get scripts list
    const scripts = await sentinelPage.evaluate(() =>
      [...document.querySelectorAll("script[src]")].map(s => (s as HTMLScriptElement).src.slice(0, 100)).join("\n")
    );
    console.log(`\nSentinel scripts:\n${scripts || "(none)"}`);
  } catch (e: any) {
    console.log(`Sentinel frame error: ${e.message}`);
  }

  // Also try: wait on main page and poll for inputs appearing
  console.log("\n--- Waiting up to 20s for email input on main page ---");
  try {
    await page.waitForSelector('input[type="email"], input[name="email"], input[id*="email"]', { timeout: 20_000 });
    const emailInput = await page.evaluate(() => {
      const i = document.querySelector('input[type="email"], input[name="email"]');
      return i ? `Found: ${(i as HTMLInputElement).outerHTML.slice(0, 100)}` : "Not found";
    });
    console.log(`Email input: ${emailInput}`);
  } catch {
    console.log("Email input did NOT appear within 20s");
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
