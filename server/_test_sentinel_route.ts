/**
 * Intercept chatgpt.com/backend-api/sentinel/ and return a fake response.
 * If the form appears, the Sentinel doesn't validate the token server-side.
 * Run: npx tsx server/_test_sentinel_route.ts
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== Sentinel Route Interception Test ===\n");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-blink-features=AutomationControlled","--window-size=1280,800"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    const orig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p: number) {
      if (p === 37445) return "Intel Inc.";
      if (p === 37446) return "Intel Iris OpenGL Engine";
      return orig.call(this, p);
    };
  });

  const page = await context.newPage();

  // Intercept ALL chatgpt.com/backend-api/sentinel/ requests
  await page.route("**/backend-api/sentinel/**", async route => {
    const url = route.request().url();
    const method = route.request().method();
    let body = "";
    try { body = route.request().postData() ?? ""; } catch {}
    console.log(`[INTERCEPTED] ${method} ${url.slice(0, 80)}`);
    console.log(`[BODY] ${body.slice(0, 100)}`);

    // Return a fake "accepted" response
    // Real chatgpt.com sentinel token is a JWT-like string; try various formats
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.fake.fake",
        expiry: Date.now() + 3600000,
        status: "accepted",
      }),
    });
  });

  // Also capture actual chatgpt.com sentinel requests that weren't intercepted
  context.on("request", req => {
    const u = req.url();
    if (u.includes("chatgpt.com/backend-api/sentinel") || u.includes("chatgpt.com/ces")) {
      console.log(`[ACTUAL REQ] ${req.method()} ${u.slice(0, 100)}`);
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

  console.log("Navigating...");
  await page.goto(SIGNUP_URL, { waitUntil: "load", timeout: 60_000 });

  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const t = (await page.evaluate(() => document.body?.innerText?.slice(0, 100) ?? "(empty)")).replace(/\n/g, " ").trim();
    const inp = await page.evaluate(() =>
      [...document.querySelectorAll("input")].map((i: any) => `${i.type}[${i.name}]`).join(", ")
    );
    console.log(`[${(i+1)*5}s] text: "${t.slice(0,60)}" | inputs: ${inp || "none"}`);
    if (inp && inp.includes("email")) { console.log("🎉 EMAIL INPUT FOUND!"); break; }
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
