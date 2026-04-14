import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { db } from "./db";
import { chatgptAccounts } from "../shared/schema";
import { desc } from "drizzle-orm";
import fs from "fs";

(chromium as any).use(StealthPlugin());

const BROWSER_ARGS = [
  "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader",
];
const CONTEXT_OPTS = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  locale: "en-US",
  viewport: { width: 1280, height: 800 },
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const accounts = await db.select().from(chatgptAccounts).orderBy(desc(chatgptAccounts.id)).limit(10);
  const acc = accounts.find(a => a.password && a.email.includes("addison.asia"));
  if (!acc) { console.log("No account found"); process.exit(1); }
  console.log("Testing with:", acc.email, "pass:", acc.password);

  // Step 1: Log in via no-proxy browser
  console.log("--- Logging in via no-proxy browser ---");
  const browser1 = await (chromium as any).launch({ headless: true, args: BROWSER_ARGS });
  const ctx1 = await browser1.newContext(CONTEXT_OPTS);
  const page1 = await ctx1.newPage();

  await page1.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(3000);

  // Find and click Log in
  const loginBtn = await page1.$("a[href*='login'], button:text('Log in')");
  if (loginBtn) {
    await loginBtn.click();
    await sleep(3000);
  } else {
    await page1.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(3000);
  }
  console.log("After login nav:", page1.url());

  // Fill email
  const emailInput = await page1.$("input[type=email]");
  if (emailInput) {
    await emailInput.fill(acc.email);
    await page1.keyboard.press("Enter");
    await sleep(3000);
  }

  // Fill password
  const pwInput = await page1.$("input[type=password]");
  if (pwInput) {
    await pwInput.fill(acc.password!);
    await page1.keyboard.press("Enter");
    await sleep(6000);
  }
  console.log("After login URL:", page1.url());

  const cookies = await ctx1.cookies();
  console.log("Got", cookies.length, "cookies");
  await browser1.close();

  // Step 2: Transfer cookies to Indian proxy browser
  console.log("--- Switching to Indian proxy browser ---");
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

  // Verify logged in
  await page2.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(4000);
  console.log("Proxy chatgpt URL:", page2.url());

  // Navigate to explore/plus
  console.log("Navigating to explore/plus...");
  await page2.goto("https://chatgpt.com/explore/plus", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(6000);
  console.log("explore/plus URL:", page2.url());

  const btns = await page2.evaluate(() =>
    [...document.querySelectorAll("button,a")]
      .map((b: any) => ({ text: b.textContent?.trim()?.slice(0, 60), href: b.href ?? "" }))
      .filter((b: any) => b.text && b.text.length > 2 && b.text.length < 60)
  );
  const unique = [...new Map(btns.map((b: any) => [b.text, b])).values()].slice(0, 20);
  console.log("Buttons on explore/plus:", JSON.stringify(unique, null, 2));

  const shot = await page2.screenshot({ type: "png", fullPage: false });
  fs.writeFileSync("/tmp/explore_plus_loggedin.png", shot);

  // Also navigate to pricing to check button hrefs when logged in
  console.log("Navigating to /pricing as logged-in user...");
  await page2.goto("https://chatgpt.com/pricing", { waitUntil: "networkidle", timeout: 40_000 }).catch(() => {});
  await sleep(5000);
  await page2.evaluate(() => window.scrollBy(0, 500));
  await sleep(2000);

  const pricingBtns = await page2.evaluate(() =>
    [...document.querySelectorAll("button,a")]
      .map((b: any) => ({ text: b.textContent?.trim()?.slice(0, 60), href: b.href ?? "" }))
      .filter((b: any) => b.text && b.text.length > 2 && (b.text.toLowerCase().includes("plus") || b.text.toLowerCase().includes("upgrade") || b.text.toLowerCase().includes("get") || b.href?.includes("checkout")))
  );
  console.log("Pricing Plus-related buttons:", JSON.stringify(pricingBtns.slice(0, 10), null, 2));

  const shot2 = await page2.screenshot({ type: "png", fullPage: false });
  fs.writeFileSync("/tmp/pricing_loggedin.png", shot2);

  await browser2.close();
  console.log("Done");
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
