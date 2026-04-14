import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
chromium.use(StealthPlugin());

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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
  const allReqs: string[] = [];
  context.on("request", req => {
    const u = req.url();
    if (!u.includes("oaistatic") && !u.includes("cdn-cgi/challenge-platform/h/")) {
      allReqs.push(`${req.method()} ${u.slice(0, 120)}`);
    }
  });
  context.on("response", async resp => {
    const u = resp.url();
    if (u.includes("backend-api/sentinel") || u.includes("sentinel.openai.com/sentinel")) {
      let b = "";
      try { b = (await resp.text()).slice(0, 100); } catch { b = "(error reading)"; }
      console.log(`RESP ${resp.status()} ${u.slice(0, 80)} | ${b}`);
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

  // Poll every 5 seconds for 60 seconds
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const t = (await page.evaluate(() => document.body?.innerText?.slice(0, 80) ?? "(empty)")).replace(/\n/g, " ").trim();
    const inp = await page.evaluate(() =>
      [...document.querySelectorAll("input")].map(i => `${(i as any).type}[${(i as any).name}]`).join(", ")
    );
    console.log(`[${((i+1)*5)}s] text: ${t.slice(0,60)} | inputs: ${inp || "none"}`);
    if (inp) break; // form appeared!
  }

  console.log("\nAll requests (unique):");
  const unique = [...new Set(allReqs)];
  for (const r of unique) console.log(" ", r);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
