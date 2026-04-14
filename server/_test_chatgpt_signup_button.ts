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
  });

  const page = await context.newPage();
  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await new Promise(r => setTimeout(r, 4000));

  // Log all links/buttons
  const allBtns = await page.evaluate(() =>
    [...document.querySelectorAll("button, a")].map(b => ({
      text: b.textContent?.trim().slice(0, 50),
      href: (b as HTMLAnchorElement).href?.slice(0, 60),
      tag: b.tagName,
    })).filter(b => b.text).slice(0, 40)
  );
  console.log("chatgpt.com buttons:");
  for (const b of allBtns) console.log(` ${b.tag}: "${b.text}" → ${b.href || "(no href)"}`);

  // Try to click sign up
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button, a")].find(b =>
      (b.textContent?.trim().toLowerCase() || "").includes("sign up")
    );
    if (btn) {
      (btn as HTMLElement).click();
      return btn.textContent?.trim() || "clicked";
    }
    return null;
  });
  console.log("\nClicked:", clicked);

  for (let i = 1; i <= 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const url = page.url();
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll("input")].map(inp => `${inp.type}[${inp.name}]`).join(", ")
    );
    const dialogs = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"],[aria-modal],[data-testid*="modal"],[data-testid*="dialog"]')]
        .map(m => m.textContent?.trim().slice(0, 80)).filter(Boolean).join(" | ")
    );
    console.log(`[${i*2}s] url: ${url.slice(0, 70)} | inputs: ${inputs || "none"} | dialogs: ${dialogs || "none"}`);
    if (url.includes("auth.openai.com") || inputs) break;
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
