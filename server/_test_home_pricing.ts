/**
 * Test: What does chatgpt.com/#pricing look like for a freshly logged-in user
 * using the cookie transfer approach (same as production flow)
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";

(chromium as any).use(StealthPlugin());

const BROWSER_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader"];
const CONTEXT_OPTS = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  locale: "en-US",
  viewport: { width: 1280, height: 800 },
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Use the most recently created account's password — update manually
const EMAIL = "daniel_green@addison.asia";
const PASSWORD = "B1B9BFq9O5!A1";

(async () => {
  // Step 1: Fresh signup on no-proxy browser (simulating just-created account state)
  console.log("--- Step 1: Login via no-proxy browser ---");
  const browser1 = await (chromium as any).launch({ headless: true, args: BROWSER_ARGS });
  const ctx1 = await browser1.newContext(CONTEXT_OPTS);
  const page1 = await ctx1.newPage();

  await page1.goto("https://auth.openai.com/authorize?response_type=code&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Flogin-web&client_id=pdlLIX2Y72MIl2rhLhTE9VV9bN9LdLpi&scope=openid+profile+email+offline_access&audience=https%3A%2F%2Fapi.openai.com%2Fv1&prompt=login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(3000);
  console.log("Login URL:", page1.url());

  const emailInput = await page1.$("input[type=email]");
  if (emailInput) {
    await emailInput.fill(EMAIL);
    await page1.keyboard.press("Enter");
    await sleep(3000);
    const pwInput = await page1.$("input[type=password]");
    if (pwInput) {
      await pwInput.fill(PASSWORD);
      await page1.keyboard.press("Enter");
      await sleep(7000);
      console.log("After login URL:", page1.url());
    }
  }

  const cookies = await ctx1.cookies();
  console.log("Got", cookies.length, "cookies from login");
  await browser1.close();

  // Step 2: Transfer to Indian proxy browser
  console.log("--- Step 2: Indian proxy browser ---");
  const browser2 = await (chromium as any).launch({
    headless: true,
    proxy: {
      server: "http://proxy.nsocks.com:2312",
      username: "ns-mrqq7v2x6zlr_area-IN_session-fR44mD0VSI_life-5",
      password: process.env.NSOCKS_PROXY_PASSWORD ?? "",
    },
    args: BROWSER_ARGS,
  });
  const ctx2 = await browser2.newContext(CONTEXT_OPTS);
  await ctx2.addCookies(cookies);
  const page2 = await ctx2.newPage();

  // Monitor requests
  page2.on("request", (req: any) => {
    const url = req.url();
    if (url.includes("checkout") || url.includes("stripe") || url.includes("subscription") || url.includes("billing") || url.includes("upgrade")) {
      console.log(`  REQUEST: ${req.method()} ${url.slice(0, 150)}`);
    }
  });
  page2.on("response", (resp: any) => {
    const url = resp.url();
    if (url.includes("checkout") || url.includes("stripe") || url.includes("subscription") || url.includes("billing") || url.includes("upgrade")) {
      console.log(`  RESPONSE [${resp.status()}]: ${url.slice(0, 150)}`);
    }
  });

  // Verify logged in
  await page2.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(4000);
  console.log("Proxy chatgpt URL:", page2.url());
  const loggedInCheck = await page2.evaluate(() => !!document.querySelector("a[href*=login]") === false && document.body.textContent?.length > 100);
  console.log("Appears logged in (no login link):", loggedInCheck);

  fs.writeFileSync("/tmp/home_logged_in.png", await page2.screenshot({ type: "png" }));

  // Navigate to chatgpt.com/#pricing
  console.log("--- Navigating to chatgpt.com/#pricing ---");
  await page2.goto("https://chatgpt.com/#pricing", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(5000);
  console.log("After #pricing URL:", page2.url());

  const allBtns = await page2.evaluate(() =>
    [...document.querySelectorAll("button,a")]
      .map((b: any) => ({ text: b.textContent?.trim()?.slice(0, 50), href: b.href ?? "" }))
      .filter((b: any) => b.text && b.text.length > 2)
  );
  const relevant = allBtns.filter((b: any) =>
    b.text.toLowerCase().includes("plus") || b.text.toLowerCase().includes("upgrade") ||
    b.text.toLowerCase().includes("get") || b.href.includes("checkout") || b.href.includes("stripe")
  );
  console.log("Relevant buttons on #pricing:", JSON.stringify(relevant.slice(0, 10), null, 2));

  fs.writeFileSync("/tmp/home_pricing.png", await page2.screenshot({ type: "png" }));
  console.log("Screenshot saved to /tmp/home_pricing.png");

  // Now try to find and click any upgrade button
  if (relevant.length > 0) {
    const btn = relevant.find((b: any) => b.href.includes("checkout")) ??
      relevant.find((b: any) => b.text.toLowerCase().includes("get plus")) ??
      relevant.find((b: any) => b.text.toLowerCase().includes("upgrade"));
    if (btn) {
      console.log(`\nClicking: "${btn.text}" → ${btn.href}`);
      if (btn.href) {
        await page2.goto(btn.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } else {
        const el = await page2.locator(`text=${btn.text}`).first();
        await el.click();
      }
      await sleep(5000);
      console.log("After click URL:", page2.url());
      fs.writeFileSync("/tmp/after_click.png", await page2.screenshot({ type: "png" }));
    }
  }

  await browser2.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
