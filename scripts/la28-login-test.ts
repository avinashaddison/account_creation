import { chromium } from "playwright";
import fs from "fs";

async function main() {
  const execPath = chromium.executablePath();
  if (!fs.existsSync(execPath)) {
    console.error("Chromium not found.");
    return;
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--js-flags=--max-old-space-size=256",
      "--disable-http2",
    ],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const email = "wildhawk7117@dollicons.com";
  const password = "9q5arNZN@wwjs#";

  const urlHistory: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      urlHistory.push(frame.url());
      console.log(`[NAV] ${frame.url()}`);
    }
  });

  try {
    console.log("=== Approach: Login on login page, intercept consent redirect ===");
    
    await page.route("**/consent.html*", async (route) => {
      console.log("[INTERCEPTED] Consent page redirect blocked!");
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<html><head><title>Consent Bypassed</title></head><body>
          <script>window.location.href = "https://tickets.la28.org/mycustomerdata/?#/myCustomerData";</script>
        </body></html>`
      });
    });

    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 60000 });
    try { await page.waitForLoadState("networkidle", { timeout: 30000 }); } catch {}
    await page.waitForTimeout(5000);

    await page.evaluate(`(() => {
      var selectors = ['[id*="onetrust"]','[class*="onetrust"]','[id*="cookie"]','[class*="cookie-banner"]','.modal-overlay','.overlay'];
      for (var i = 0; i < selectors.length; i++) { var els = document.querySelectorAll(selectors[i]); for (var j = 0; j < els.length; j++) { els[j].remove(); } }
    })()`);
    await page.waitForTimeout(2000);

    console.log("Logging in...");
    const loginResult: any = await page.evaluate(`
      new Promise((resolve) => {
        gigya.accounts.login({
          loginID: "${email}",
          password: "${password.replace(/"/g, '\\"')}",
          callback: function(response) {
            resolve({ status: response.status, errorCode: response.errorCode, UID: response.UID || null });
          }
        });
      })
    `);
    console.log("Login:", JSON.stringify(loginResult));

    console.log("Waiting for redirects...");
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5000);
      const url = page.url();
      console.log(`  [${(i + 1) * 5}s] URL: ${url}`);
      
      if (url.includes("tickets") || url.includes("mycustomerdata")) {
        console.log("  SUCCESS - reached tickets portal!");
        break;
      }
    }

    console.log("\n========== RESULT ==========");
    console.log(`FINAL URL: ${page.url()}`);
    console.log(`FINAL TITLE: ${await page.title()}`);
    
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "");
    if ((text as string).trim()) console.log("Text:", text);

    console.log("\nFull history:");
    urlHistory.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));

  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main();
