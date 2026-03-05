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
  page.setDefaultTimeout(60000);

  const email = "wildhawk7117@dollicons.com";
  const password = "9q5arNZN@wwjs#";

  const urlHistory: string[] = [];

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      urlHistory.push(url);
      console.log(`[NAV] Navigated to: ${url}`);
    }
  });

  try {
    console.log("Step 1: Navigating to la28id.la28.org/login/ ...");
    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    } catch {}

    await page.waitForTimeout(5000);

    console.log("\nStep 2: Removing overlays...");
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

    console.log("\nStep 3: Logging in via Gigya API...");
    const loginResult = await page.evaluate(`
      new Promise((resolve) => {
        if (typeof gigya !== 'undefined' && gigya.accounts) {
          gigya.accounts.login({
            loginID: "${email}",
            password: "${password.replace(/"/g, '\\"')}",
            callback: function(response) {
              resolve({
                status: response.status,
                errorCode: response.errorCode,
                errorMessage: response.errorMessage,
                UID: response.UID || null
              });
            }
          });
        } else {
          resolve({ error: "Gigya SDK not available" });
        }
      })
    `);
    console.log("Login response:", JSON.stringify(loginResult));

    console.log("\nStep 4: Tracking redirects for 30 seconds...");
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5000);
      const currentUrl = page.url();
      console.log(`  [${(i + 1) * 5}s] Current URL: ${currentUrl}`);
      console.log(`  [${(i + 1) * 5}s] Title: ${await page.title()}`);
    }

    console.log("\nStep 5: Checking if consent page needs action...");
    const currentUrl = page.url();
    if (currentUrl.includes("consent")) {
      console.log("On consent page. Looking for accept/agree buttons...");
      
      const buttons = await page.$$eval("button, input[type='submit'], a.btn, [role='button']", (els: any[]) =>
        els.map((e: any) => ({
          text: e.textContent?.trim()?.substring(0, 100),
          tag: e.tagName,
          type: e.type,
          visible: e.offsetWidth > 0 && e.offsetHeight > 0,
        }))
      );
      console.log("Buttons found:", JSON.stringify(buttons, null, 2));

      const acceptBtn = await page.$('button:has-text("Accept"), button:has-text("Agree"), button:has-text("Continue"), input[type="submit"]');
      if (acceptBtn) {
        console.log("Clicking accept/continue button...");
        await acceptBtn.click();
        await page.waitForTimeout(10000);
        console.log(`After consent click URL: ${page.url()}`);
      } else {
        const gigyaSubmit = await page.$('.gigya-input-submit, input.gigya-input-submit');
        if (gigyaSubmit) {
          console.log("Found Gigya submit on consent page, clicking...");
          await gigyaSubmit.click();
          await page.waitForTimeout(10000);
          console.log(`After Gigya submit URL: ${page.url()}`);
        }
      }
    }

    console.log("\n\n========== FULL NAVIGATION HISTORY ==========");
    urlHistory.forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
    console.log(`\nFINAL URL: ${page.url()}`);
    console.log(`FINAL TITLE: ${await page.title()}`);

    const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "");
    console.log("\nPage text at final URL:");
    console.log(pageText);

  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main();
