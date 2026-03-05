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
      urlHistory.push(frame.url());
      console.log(`[NAV] ${frame.url()}`);
    }
  });

  try {
    console.log("=== Step 1: Login ===");
    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 60000 });
    try { await page.waitForLoadState("networkidle", { timeout: 30000 }); } catch {}
    await page.waitForTimeout(5000);

    await page.evaluate(`(() => {
      var selectors = ['[id*="onetrust"]','[class*="onetrust"]','[id*="cookie"]','[class*="cookie-banner"]','.modal-overlay','.overlay'];
      for (var i = 0; i < selectors.length; i++) { var els = document.querySelectorAll(selectors[i]); for (var j = 0; j < els.length; j++) { els[j].remove(); } }
    })()`);
    await page.waitForTimeout(2000);

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
    await page.waitForTimeout(3000);

    console.log("\n=== Step 2: Get JWT and session info ===");
    const jwtResult = await page.evaluate(`
      new Promise((resolve) => {
        gigya.accounts.getJWT({
          callback: function(resp) {
            resolve({ errorCode: resp.errorCode, id_token: resp.id_token?.substring(0, 50) + '...' });
          }
        });
      })
    `);
    console.log("JWT:", JSON.stringify(jwtResult));

    console.log("\n=== Step 3: Intercept consent redirect and go to profile instead ===");
    await page.waitForTimeout(5000);

    const destinations = [
      "https://la28id.la28.org/profile/",
      "https://la28id.la28.org/en/profile.html",
      "https://la28.org/en/profile.html",
      "https://la28.org/en.html",
      "https://tickets.la28.org/en/dashboard",
    ];

    for (const dest of destinations) {
      console.log(`\nTrying: ${dest}`);
      try {
        await page.goto(dest, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(3000);
        const title = await page.title();
        const currentUrl = page.url();
        console.log(`  Result URL: ${currentUrl}`);
        console.log(`  Title: ${title}`);
        
        if (!currentUrl.includes("login") && !currentUrl.includes("consent")) {
          const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
          console.log(`  Page text: ${text}`);
          console.log("  SUCCESS - landed on authenticated page!");
          break;
        } else {
          console.log("  Redirected back to login/consent.");
        }
      } catch (e: any) {
        console.log(`  Error: ${e.message.substring(0, 100)}`);
      }
    }

    console.log("\n\n========== FULL NAVIGATION HISTORY ==========");
    urlHistory.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
    console.log(`\nFINAL URL: ${page.url()}`);
    console.log(`FINAL TITLE: ${await page.title()}`);

  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main();
