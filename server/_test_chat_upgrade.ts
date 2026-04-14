/**
 * Test: Find the upgrade button in the chat interface for a logged-in user
 * Uses cookie transfer from a freshly created account
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { db } from "./db";
import { chatgptAccounts } from "../shared/schema";
import { desc } from "drizzle-orm";
import fs from "fs";

(chromium as any).use(StealthPlugin());

const BROWSER_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader"];
const CONTEXT_OPTS = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  locale: "en-US",
  viewport: { width: 1280, height: 800 },
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

(async () => {
  // Get a recently created account
  const accounts = await db.select().from(chatgptAccounts).orderBy(desc(chatgptAccounts.id)).limit(20);
  const acc = accounts.find(a => a.password && a.email.includes("addison.asia") && a.status !== "failed");
  if (!acc) { console.log("No account found"); process.exit(1); }
  console.log("Testing with:", acc.email, "pass:", acc.password);

  // Step 1: Log in via no-proxy browser using chatgpt.com/auth/login (cookie method)
  console.log("--- Step 1: Login via no-proxy browser ---");
  const browser1 = await (chromium as any).launch({ headless: true, args: BROWSER_ARGS });
  const ctx1 = await browser1.newContext(CONTEXT_OPTS);
  const page1 = await ctx1.newPage();

  // Use a direct login URL that opens the email form
  await page1.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(3000);
  console.log("Login page URL:", page1.url());

  // Check if there's a "Log in" button to click
  const loginLink = await page1.$("a[href*='login']:not([href*='auth/login']), button:has-text('Log in')");
  if (loginLink) {
    await loginLink.click();
    await sleep(3000);
  }

  // Check for email input
  let emailInput = await page1.$("input[type=email], input[name=email]");
  if (!emailInput) {
    // Navigate directly to auth.openai.com
    await page1.goto("https://auth.openai.com/authorize?response_type=code&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Flogin-web&client_id=pdlLIX2Y72MIl2rhLhTE9VV9bN9LdLpi&scope=openid+profile+email+offline_access&audience=https%3A%2F%2Fapi.openai.com%2Fv1&prompt=login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(3000);
    emailInput = await page1.$("input[type=email], input[name=email]");
  }

  if (emailInput) {
    console.log("Email input found, filling...");
    await emailInput.fill(acc.email);
    await page1.keyboard.press("Enter");
    await sleep(3000);
    const pwInput = await page1.$("input[type=password]");
    if (pwInput) {
      await pwInput.fill(acc.password!);
      await page1.keyboard.press("Enter");
      await sleep(8000);
      console.log("After login URL:", page1.url());
    }
  } else {
    console.log("No email input found on any login page");
  }

  const cookies = await ctx1.cookies();
  console.log("Got", cookies.length, "cookies");
  const authCookies = cookies.filter(c => c.name.includes("token") || c.name.includes("session") || c.name.includes("auth"));
  console.log("Auth cookies:", authCookies.map(c => c.name));
  await browser1.close();

  // Step 2: Transfer to Indian proxy browser
  console.log("--- Step 2: Transfer to proxy + explore chat interface ---");
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

  // Monitor all requests
  page2.on("request", (req: any) => {
    const url = req.url();
    if (url.includes("checkout") || url.includes("stripe") || url.includes("subscription") || url.includes("billing") || url.includes("upgrade") || url.includes("purchase")) {
      console.log(`  REQUEST: ${req.method()} ${url.slice(0, 150)}`);
    }
  });
  page2.on("response", (resp: any) => {
    const url = resp.url();
    if (url.includes("checkout") || url.includes("stripe") || url.includes("subscription") || url.includes("billing") || url.includes("upgrade") || url.includes("purchase")) {
      console.log(`  RESPONSE [${resp.status()}]: ${url.slice(0, 150)}`);
    }
  });

  // Load chatgpt.com
  await page2.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(5000);
  console.log("Proxy chatgpt URL:", page2.url());

  // Take screenshot of the chat interface
  fs.writeFileSync("/tmp/chat_home.png", await page2.screenshot({ type: "png" }));

  // Look for upgrade-related buttons in chat
  const upgradeEls = await page2.evaluate(() =>
    [...document.querySelectorAll("button, a, [role=button]")]
      .map((b: any) => ({
        text: b.textContent?.trim()?.slice(0, 60),
        href: b.href ?? "",
        class: b.className?.slice(0, 80),
        "aria-label": b.getAttribute("aria-label") ?? "",
      }))
      .filter((b: any) => {
        const t = b.text?.toLowerCase() ?? "";
        return t.includes("upgrade") || t.includes("plus") || t.includes("plan") || t.includes("pro") || t.includes("subscribe");
      })
  ).catch(() => []);
  console.log("Upgrade elements in chat:", JSON.stringify(upgradeEls.slice(0, 10), null, 2));

  // Also dump the full button list
  const allBtns = await page2.evaluate(() =>
    [...document.querySelectorAll("button, a")]
      .map((b: any) => b.textContent?.trim()?.slice(0, 40))
      .filter((t: any) => t && t.length > 1)
  );
  console.log("All buttons (first 20):", JSON.stringify([...new Set(allBtns)].slice(0, 20)));

  // Try clicking upgrade button if found
  if (upgradeEls.length > 0) {
    const upgradeBtn = upgradeEls[0];
    console.log(`\nClicking: "${upgradeBtn.text}"`);
    const btnEl = await page2.locator(`text=${upgradeBtn.text}`).first();
    await btnEl.click().catch(() => {});
    await sleep(5000);
    console.log("After upgrade click URL:", page2.url());
    fs.writeFileSync("/tmp/after_upgrade_click.png", await page2.screenshot({ type: "png" }));

    // Look for pricing modal/dialog
    const modalBtns = await page2.evaluate(() =>
      [...document.querySelectorAll("button, a")]
        .map((b: any) => ({
          text: b.textContent?.trim()?.slice(0, 60),
          href: (b as HTMLAnchorElement).href ?? "",
        }))
        .filter((b: any) => b.text && b.text.length > 2 && (
          b.text.toLowerCase().includes("plus") || b.text.toLowerCase().includes("upgrade") ||
          b.href.includes("checkout") || b.href.includes("stripe")
        ))
    );
    console.log("Post-click buttons:", JSON.stringify(modalBtns.slice(0, 10), null, 2));
  }

  await browser2.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
