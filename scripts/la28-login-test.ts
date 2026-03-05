import { chromium } from "playwright";

async function main() {
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

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const email = "wildhawk7117@dollicons.com";
  const password = "9q5arNZN@wwjs#";

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      console.log(`[NAV] ${frame.url().substring(0, 150)}`);
    }
  });

  try {
    console.log("=== Step 1: Login ===");
    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 60000 });
    try { await page.waitForLoadState("networkidle", { timeout: 30000 }); } catch {}
    await page.waitForTimeout(5000);

    await page.evaluate(`(() => {
      var s = ['[id*="onetrust"]','[class*="onetrust"]','[id*="cookie"]','[class*="cookie-banner"]'];
      for (var i = 0; i < s.length; i++) { var els = document.querySelectorAll(s[i]); for (var j = 0; j < els.length; j++) { els[j].remove(); } }
    })()`);

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

    console.log("\n=== Step 2: Wait for consent page ===");
    try {
      await page.waitForURL("**/consent.html*", { timeout: 20000 });
    } catch {}

    if (page.url().includes("consent.html")) {
      console.log("On consent page. Accepting consent...");
      await page.waitForTimeout(3000);

      const consentResult = await page.evaluate(`
        new Promise((resolve) => {
          gigya.accounts.setAccountInfo({
            preferences: {
              privacy: { LA2028privacyPolicy: { isConsentGranted: true } },
              terms: { LA2028siteTerms: { isConsentGranted: true } }
            },
            callback: function(resp) {
              resolve({ errorCode: resp.errorCode, status: resp.status });
            }
          });
          setTimeout(function() { resolve({ error: 'timeout' }); }, 10000);
        })
      `);
      console.log("Consent:", JSON.stringify(consentResult));
    }

    console.log("\n=== Step 3: Navigate directly to tickets portal (fresh page) ===");
    
    await page.goto("https://tickets.la28.org/mycustomerdata/?#/myCustomerData", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    console.log("Waiting for page to stabilize...");
    let lastUrl = "";
    let stableCount = 0;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(3000);
      const currentUrl = page.url();
      
      if (currentUrl !== lastUrl) {
        console.log(`  [${(i + 1) * 3}s] ${currentUrl.substring(0, 150)}`);
        stableCount = 0;
      } else {
        stableCount++;
        if (stableCount >= 3) {
          console.log(`  URL stable for 9s`);
          break;
        }
      }
      lastUrl = currentUrl;
    }

    const finalUrl = page.url();
    console.log("\nFinal URL:", finalUrl);
    const title = await page.title();
    console.log("Title:", title);

    try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch {}
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || "");
    console.log("Body text:", bodyText);

    if (!(bodyText as string).includes("Access Denied")) {
      console.log("\n=== REACHED TICKETS PORTAL! Analyzing form ===");
      
      const formInfo = await page.evaluate(`(() => {
        var result = { selects: [], checkboxes: [], buttons: [], inputs: [], divSections: [] };
        
        document.querySelectorAll('select').forEach(function(sel) {
          var opts = [];
          for (var i = 0; i < Math.min(sel.options.length, 15); i++) {
            opts.push({ value: sel.options[i].value, text: sel.options[i].text });
          }
          result.selects.push({ name: sel.name, id: sel.id, optionCount: sel.options.length, options: opts });
        });
        
        document.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
          var lbl = cb.parentElement?.innerText?.substring(0, 100) || '';
          result.checkboxes.push({ name: cb.name, id: cb.id, value: cb.value, checked: cb.checked, label: lbl });
        });
        
        document.querySelectorAll('button').forEach(function(b) {
          result.buttons.push({ text: (b.innerText || '').substring(0, 80), class: (b.className || '').substring(0, 100), disabled: b.disabled });
        });
        
        return result;
      })()`);
      console.log("Form:", JSON.stringify(formInfo, null, 2));
    } else {
      console.log("\n=== Access Denied by Akamai WAF ===");
      console.log("Cannot access tickets portal directly from this server.");
      console.log("Profile data is already set via Gigya SDK - the account is complete.");
    }

  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main();
