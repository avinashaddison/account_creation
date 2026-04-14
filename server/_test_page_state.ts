/**
 * Diagnostic: navigate to auth.openai.com signup URL and report everything on the page.
 * Run: npx tsx server/_test_page_state.ts
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== Page State Diagnostic ===");

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

  console.log(`Navigating to: ${SIGNUP_URL.slice(0, 80)}...`);

  // Navigate with networkidle to ensure full render
  await page.goto(SIGNUP_URL, { waitUntil: "load", timeout: 60_000 });
  console.log("Initial load done.");

  // Wait longer
  await new Promise(r => setTimeout(r, 6000));

  const url1 = page.url();
  const title1 = await page.title();
  const innerText1 = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "(empty)");
  const htmlLen1 = await page.evaluate(() => document.body?.innerHTML?.length ?? 0);
  const inputs1 = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map(i => `${i.type}[name=${i.name}][id=${i.id}]`).join(", ")
  );
  const iframes1 = await page.evaluate(() =>
    [...document.querySelectorAll("iframe")].map(f => f.src || f.name || "(iframe)").join(", ")
  );

  console.log(`\n--- After 6s ---`);
  console.log(`URL: ${url1}`);
  console.log(`Title: "${title1}"`);
  console.log(`innerText (500c): ${innerText1.replace(/\n/g, " ").trim()}`);
  console.log(`innerHTML length: ${htmlLen1}`);
  console.log(`Inputs: ${inputs1 || "(none)"}`);
  console.log(`Iframes: ${iframes1 || "(none)"}`);

  // Wait more
  await new Promise(r => setTimeout(r, 30_000));

  const url2 = page.url();
  const title2 = await page.title();
  const innerText2 = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "(empty)");
  const inputs2 = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map(i => `${i.type}[name=${i.name}][id=${i.id}]`).join(", ")
  );

  console.log(`\n--- After 36s ---`);
  console.log(`URL: ${url2}`);
  console.log(`Title: "${title2}"`);
  console.log(`innerText (500c): ${innerText2.replace(/\n/g, " ").trim()}`);
  console.log(`Inputs: ${inputs2 || "(none)"}`);

  await browser.close();
  console.log("\nDone.");
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
