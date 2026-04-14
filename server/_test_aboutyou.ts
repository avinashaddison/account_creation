// Test to diagnose the about-you page content
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getSmtpDevEmail } from "./smtpDevService";
import * as crypto from "crypto";

chromium.use(StealthPlugin());
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function jsClick(page: import("playwright").Page, text: string) {
  return page.evaluate((t) => {
    const btn = [...document.querySelectorAll("button, a")].find(b => {
      const txt = b.textContent?.trim().toLowerCase() ?? "";
      return txt === t.toLowerCase() || txt.includes(t.toLowerCase());
    });
    if (btn) { (btn as HTMLElement).click(); return true; }
    return false;
  }, text);
}

async function solveTurnstile(page: import("playwright").Page) {
  const frames = page.frames();
  for (const frame of frames) {
    const url = frame.url();
    if (url.includes("challenges.cloudflare.com")) {
      console.log("[Turnstile] Frame found:", url.slice(0, 80));
      // Attempt click on checkbox
      const checkbox = await frame.$('input[type="checkbox"]').catch(() => null);
      if (checkbox) await checkbox.click().catch(() => {});
    }
  }
}

async function main() {
  const email = `diag_aboutyou_${Date.now()}@addison.asia`;
  const password = "P@ssw0rd!" + crypto.randomBytes(3).toString("hex");
  console.log("Using email:", email);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-blink-features=AutomationControlled","--disable-dev-shm-usage","--disable-gpu"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();

  // Step 1: chatgpt.com → Sign Up
  console.log("[1] Navigating to chatgpt.com…");
  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(4000);

  // Click sign up
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(b =>
      b.textContent?.trim().toLowerCase().includes("sign up")
    );
    if (btn) (btn as HTMLElement).click();
  });
  console.log("[1] Sign up clicked");

  // Step 2: Wait for email input in modal
  console.log("[2] Waiting for email input…");
  await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 20_000 });
  const emailInput = await page.$('input[name="email"], input[type="email"]');
  await emailInput!.click();
  await emailInput!.fill(email);
  await sleep(1000);
  await jsClick(page, "Continue");
  console.log("[2] Email submitted, waiting for load…");
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await sleep(3000);
  console.log("[2] URL:", page.url());

  // Step 3: Password
  console.log("[3] Looking for password input…");
  const pwInput = await page.waitForSelector('input[type="password"]', { timeout: 20_000 }).catch(() => null);
  if (pwInput) {
    await pwInput.click();
    await pwInput.fill(password);
    await sleep(1000);
    const clickedContinue = await jsClick(page, "Continue");
    if (!clickedContinue) await page.click('button[type="submit"]').catch(() => {});
    console.log("[3] Password submitted, waiting…");
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await sleep(3000);
    console.log("[3] URL:", page.url());
  } else {
    console.log("[3] No password input found");
  }

  // Step 4: OTP
  if (page.url().includes("email-verification")) {
    console.log("[4] Email verification step — polling for OTP…");
    let otp = "";
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      try {
        const msgs = await getSmtpDevEmail(email);
        if (msgs && msgs.length > 0) {
          const body = msgs[0].body || JSON.stringify(msgs[0]);
          const match = body.match(/\b(\d{6})\b/);
          if (match) { otp = match[1]; break; }
        }
      } catch {}
    }
    if (!otp) { console.error("[4] OTP not received"); await browser.close(); return; }
    console.log("[4] OTP received:", otp);

    const otpInput = await page.$('input[autocomplete="one-time-code"]');
    if (otpInput) {
      await otpInput.click();
      await otpInput.fill(otp);
    } else {
      const digits = await page.$$('input[maxlength="1"]');
      for (let i = 0; i < 6 && i < digits.length; i++) await digits[i].fill(otp[i]);
    }
    await solveTurnstile(page);
    const otpContinue = await jsClick(page, "Continue");
    if (!otpContinue) await page.click('button[type="submit"]').catch(() => {});
    console.log("[4] OTP submitted, waiting…");
    await sleep(5000);
    console.log("[4] URL:", page.url());
  }

  // Step 5: About-you — diagnose the page
  console.log("[5] Diagnosing about-you page…");
  const url5 = page.url();
  console.log("[5] URL:", url5);

  const allText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "").catch(() => "error");
  console.log("[5] Page text:", allText.replace(/\n+/g, " ").trim().slice(0, 300));

  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll("input, textarea, select")].map(el => {
      const i = el as HTMLInputElement;
      return `${i.tagName}[type=${i.type}][name=${i.name}][placeholder=${i.placeholder}]`;
    }).join("\n")
  ).catch(() => "error");
  console.log("[5] Inputs:\n", inputs);

  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map(b => `"${b.textContent?.trim()}" type=${b.type} disabled=${b.disabled}`).join("\n")
  ).catch(() => "error");
  console.log("[5] Buttons:\n", buttons);

  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a")].map(a => `"${a.textContent?.trim().slice(0,30)}" href=${a.href?.slice(0,50)}`).join("\n")
  ).catch(() => "error");
  console.log("[5] Links:\n", links);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
