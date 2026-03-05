import { chromium } from "playwright";
import fs from "fs";

async function main() {
  const execPath = chromium.executablePath();
  if (!fs.existsSync(execPath)) {
    console.error("Chromium not found.");
    return;
  }

  const browser = await chromium.launch({
    headless: true,
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

  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  const email = "wildhawk7117@dollicons.com";
  const password = "9q5arNZN@wwjs#";

  try {
    console.log("Step 1: Navigating to la28id.la28.org/login/ ...");
    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    } catch {}

    await page.waitForTimeout(5000);

    console.log("Step 2: Removing overlays...");
    await page.evaluate(`(() => {
      var selectors = [
        '[id*="onetrust"]', '[class*="onetrust"]',
        '[id*="cookie"]', '[class*="cookie-banner"]',
        '[class*="cookie-consent"]', '[class*="consent-banner"]',
        '[id*="consent"]', '[class*="gdpr"]', '[id*="gdpr"]',
        '.modal-overlay', '.overlay', '[role="dialog"]'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) {
          els[j].style.display = 'none';
          els[j].remove();
        }
      }
      var divs = document.querySelectorAll('div');
      for (var k = 0; k < divs.length; k++) {
        var style = window.getComputedStyle(divs[k]);
        if (style.position === 'fixed' && style.zIndex && parseInt(style.zIndex) > 999 && divs[k].offsetHeight > 100) {
          divs[k].remove();
        }
      }
    })()`);

    await page.waitForTimeout(2000);

    console.log("Step 3: Attempting login via Gigya accounts.login API...");
    const loginResult = await page.evaluate(`
      new Promise((resolve) => {
        if (typeof gigya !== 'undefined' && gigya.accounts) {
          gigya.accounts.login({
            loginID: "${email}",
            password: "${password.replace(/"/g, '\\"')}",
            callback: function(response) {
              resolve({
                status: response.status,
                statusMessage: response.statusMessage,
                errorCode: response.errorCode,
                errorMessage: response.errorMessage,
                UID: response.UID || null,
                profile: response.profile || null
              });
            }
          });
        } else {
          resolve({ error: "Gigya SDK not available" });
        }
      })
    `);

    console.log("Gigya login response:", JSON.stringify(loginResult, null, 2));

    await page.waitForTimeout(5000);
    const finalUrl = page.url();
    console.log(`\nFinal URL after login: ${finalUrl}`);

    const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 1500) || "");
    console.log("\nPage text:");
    console.log(pageText);

  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main();
