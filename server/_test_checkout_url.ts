/**
 * Find the checkout URL for ChatGPT Plus for a logged-in user
 */
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

(async () => {
  const accounts = await db.select().from(chatgptAccounts).orderBy(desc(chatgptAccounts.id)).limit(20);
  const acc = accounts.find(a => a.password && a.email.includes("addison.asia") && a.status !== "failed");
  if (!acc) { console.log("No account found"); process.exit(1); }
  console.log("Testing with:", acc.email, "pass:", acc.password);

  // Use Indian proxy
  const browser = await (chromium as any).launch({
    headless: true,
    proxy: {
      server: "http://proxy.nsocks.com:2312",
      username: "ns-mrqq7v2x6zlr_area-IN_session-fR44mD0VSI_life-5",
      password: process.env.NSOCKS_PROXY_PASSWORD ?? "",
    },
    args: BROWSER_ARGS,
  });
  const ctx = await browser.newContext(CONTEXT_OPTS);
  const page = await ctx.newPage();

  // Log all navigations
  page.on("response", (resp: any) => {
    const url = resp.url();
    if (url.includes("checkout") || url.includes("stripe") || url.includes("explore/plus") || url.includes("subscription") || url.includes("billing")) {
      console.log(`  RESPONSE [${resp.status()}]: ${url.slice(0, 120)}`);
    }
  });
  page.on("request", (req: any) => {
    const url = req.url();
    if (url.includes("checkout") || url.includes("stripe") || url.includes("explore/plus") || url.includes("subscription") || url.includes("billing")) {
      console.log(`  REQUEST: ${url.slice(0, 120)}`);
    }
  });

  // Log in via auth.openai.com
  console.log("--- Logging in ---");
  await page.goto("https://auth.openai.com/authorize?response_type=code&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Flogin-web&client_id=pdlLIX2Y72MIl2rhLhTE9VV9bN9LdLpi&scope=openid+profile+email+offline_access&audience=https%3A%2F%2Fapi.openai.com%2Fv1&prompt=login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(4000);
  console.log("Auth URL:", page.url());

  const emailInput = await page.$("input[type=email]");
  if (emailInput) {
    await emailInput.fill(acc.email);
    await page.keyboard.press("Enter");
    await sleep(3000);
    const pwInput = await page.$("input[type=password]");
    if (pwInput) {
      await pwInput.fill(acc.password!);
      await page.keyboard.press("Enter");
      await sleep(7000);
    }
  }
  console.log("After login URL:", page.url());

  // Try potential checkout URLs
  const candidateUrls = [
    "https://chatgpt.com/explore/plus",
    "https://chatgpt.com/plans/plus",
    "https://chatgpt.com/subscription",
    "https://chatgpt.com/checkout",
    "https://chatgpt.com/checkout/billing",
  ];

  for (const url of candidateUrls) {
    console.log(`\n--- Trying: ${url} ---`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
    await sleep(4000);
    console.log(`  Final URL: ${page.url()}`);
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll("button,a")]
        .map((b: any) => ({ text: b.textContent?.trim()?.slice(0, 40), href: b.href ?? "" }))
        .filter((b: any) => b.text && b.text.length > 2 && (b.text.toLowerCase().includes("plus") || b.text.toLowerCase().includes("upgrade") || b.text.toLowerCase().includes("subscribe") || b.href?.includes("checkout")))
    ).catch(() => []);
    if (btns.length > 0) console.log("  Relevant buttons:", JSON.stringify(btns.slice(0, 5)));
    
    const shot = await page.screenshot({ type: "png" });
    fs.writeFileSync(`/tmp/checkout_${url.split("/").pop()}.png`, shot);
  }

  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
