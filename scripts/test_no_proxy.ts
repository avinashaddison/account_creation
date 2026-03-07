import { chromium } from 'playwright-extra';

async function test() {
  const execPath = '/home/runner/workspace/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
  const browser = await chromium.launch({ headless: true, executablePath: execPath });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  console.log("Test 1: la28id.la28.org/register/ (NO PROXY)...");
  try {
    await page.goto("https://la28id.la28.org/register/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const hasGigya = await page.evaluate("typeof gigya !== 'undefined'");
    const title = await page.title();
    console.log("  OK! Title:", title, "| Gigya loaded:", hasGigya);
  } catch (e: any) {
    console.log("  FAIL:", e.message.substring(0, 200));
  }

  console.log("\nTest 2: la28id.la28.org/login/ (NO PROXY)...");
  try {
    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const hasGigya = await page.evaluate("typeof gigya !== 'undefined'");
    const title = await page.title();
    console.log("  OK! Title:", title, "| Gigya loaded:", hasGigya);
  } catch (e: any) {
    console.log("  FAIL:", e.message.substring(0, 200));
  }

  console.log("\nTest 3: tickets.la28.org (NO PROXY)...");
  try {
    await page.goto("https://tickets.la28.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const url = page.url();
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
    console.log("  URL:", url.substring(0, 100));
    console.log("  Title:", title);
    console.log("  Text:", text.substring(0, 200));
  } catch (e: any) {
    console.log("  FAIL:", e.message.substring(0, 200));
  }

  console.log("\nTest 4: consent.html (NO PROXY)...");
  try {
    await page.goto("https://la28id.la28.org/consent.html", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const title = await page.title();
    const hasGigya = await page.evaluate("typeof gigya !== 'undefined'");
    console.log("  OK! Title:", title, "| Gigya:", hasGigya);
  } catch (e: any) {
    console.log("  FAIL:", e.message.substring(0, 200));
  }

  await context.close();
  await browser.close();
  console.log("\nAll tests done!");
}

test().catch(e => console.error("Fatal:", e.message));
