import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const execPath = '/home/runner/workspace/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';

async function main() {
  const browser = await chromium.launch({ 
    headless: true, executablePath: execPath, 
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] 
  });
  const context = await browser.newContext({ 
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  console.log("Navigating to tickets.la28.org...");
  await page.goto("https://tickets.la28.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
  
  // Wait for Akamai challenge to resolve
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);
    const title = await page.title();
    const url = page.url();
    console.log(`[${i*2}s] Title: "${title}" | URL: ${url.substring(0, 80)}`);
    
    if (title !== 'Challenge Page' && title !== '') {
      console.log("Challenge resolved!");
      const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
      console.log("Page text:", text.substring(0, 200));
      break;
    }
  }

  // Now try navigating to mycustomerdata
  console.log("\nNavigating to /mycustomerdata/...");
  try {
    await page.goto("https://tickets.la28.org/mycustomerdata/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const title = await page.title();
    const url = page.url();
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log("Title:", title);
    console.log("URL:", url.substring(0, 100));
    console.log("Text:", text.substring(0, 300));
  } catch (e: any) {
    console.log("Error:", e.message.substring(0, 150));
  }

  await context.close();
  await browser.close();
}

main().catch(e => console.error("Fatal:", e.message));
