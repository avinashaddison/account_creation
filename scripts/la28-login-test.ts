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
      var selectors = ['[id*="onetrust"]','[class*="onetrust"]','[id*="cookie"]','.modal-overlay','.overlay'];
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
    await page.waitForTimeout(10000);

    console.log("\n=== Step 2: On consent page - try accepting via Gigya SDK ===");

    const getConsentInfo = await page.evaluate(`
      new Promise((resolve) => {
        gigya.accounts.getAccountInfo({
          include: 'preferences,profile,data',
          extraFields: 'preferences',
          callback: function(resp) {
            resolve({
              errorCode: resp.errorCode,
              preferences: resp.preferences,
              missingRequiredFields: resp.missingRequiredFields || null,
              riskAssessment: resp.riskAssessment || null,
              regSource: resp.regSource || null,
            });
          }
        });
      })
    `);
    console.log("Account consent info:", JSON.stringify(getConsentInfo, null, 2));

    console.log("\n=== Step 3: Get schema to find missing consents ===");
    const schema = await page.evaluate(`
      new Promise((resolve) => {
        gigya.accounts.getSchema({
          callback: function(resp) {
            var result = { errorCode: resp.errorCode, preferences: {} };
            if (resp.preferencesSchema) {
              for (var key in resp.preferencesSchema) {
                var s = resp.preferencesSchema[key];
                result.preferences[key] = {
                  type: s.type,
                  required: s.required,
                  currentDocVersion: s.currentDocVersion,
                  currentDocDate: s.currentDocDate,
                  minDocVersion: s.minDocVersion,
                  writeAccess: s.writeAccess
                };
              }
            }
            resolve(result);
          }
        });
      })
    `);
    console.log("Schema:", JSON.stringify(schema, null, 2));

    console.log("\n=== Step 4: Compare and find what's missing ===");
    const currentPrefs = (getConsentInfo as any).preferences || {};
    const requiredPrefs = (schema as any).preferences || {};
    
    const missingConsents: any = {};
    for (const [key, val] of Object.entries(requiredPrefs)) {
      const v = val as any;
      let current: any = null;

      const parts = key.split('.');
      if (parts.length === 2) {
        current = currentPrefs[parts[0]]?.[parts[1]];
      } else {
        current = currentPrefs[key];
      }

      const needsUpdate = !current || 
        !current.isConsentGranted || 
        (v.currentDocVersion && current.docVersion !== v.currentDocVersion);
      
      if (needsUpdate) {
        console.log(`  MISSING/OUTDATED: ${key} (current docVersion: ${current?.docVersion}, required: ${v.currentDocVersion})`);
        const entry: any = { isConsentGranted: true };
        if (v.currentDocVersion) entry.docVersion = v.currentDocVersion;
        if (v.currentDocDate) entry.docDate = v.currentDocDate;
        missingConsents[key] = entry;
      } else {
        console.log(`  OK: ${key} (version ${current?.docVersion})`);
      }
    }

    if (Object.keys(missingConsents).length > 0) {
      console.log("\nSetting missing consents:", JSON.stringify(missingConsents, null, 2));
      
      const setResult = await page.evaluate(`
        new Promise((resolve) => {
          gigya.accounts.setAccountInfo({
            preferences: ${JSON.stringify(missingConsents)},
            callback: function(resp) {
              resolve({ errorCode: resp.errorCode, errorMessage: resp.errorMessage });
            }
          });
        })
      `);
      console.log("Set result:", JSON.stringify(setResult));

      if ((setResult as any).errorCode !== 0) {
        console.log("Trying one at a time...");
        for (const [key, val] of Object.entries(missingConsents)) {
          const singleResult = await page.evaluate(`
            new Promise((resolve) => {
              gigya.accounts.setAccountInfo({
                preferences: { '${key}': ${JSON.stringify(val)} },
                callback: function(resp) {
                  resolve({ key: '${key}', errorCode: resp.errorCode, errorMessage: resp.errorMessage });
                }
              });
            })
          `);
          console.log(`  ${key}:`, JSON.stringify(singleResult));
        }
      }
    } else {
      console.log("All consents appear to be up to date!");
    }

    console.log("\n=== Step 5: Try finalizeRegistration or navigate ===");
    const finalizeResult = await page.evaluate(`
      new Promise((resolve) => {
        if (gigya.accounts.finalizeRegistration) {
          gigya.accounts.finalizeRegistration({
            callback: function(resp) {
              resolve({ method: 'finalizeRegistration', errorCode: resp.errorCode, errorMessage: resp.errorMessage });
            }
          });
        } else {
          resolve({ error: 'finalizeRegistration not available' });
        }
      })
    `);
    console.log("Finalize:", JSON.stringify(finalizeResult));
    
    await page.waitForTimeout(5000);

    console.log("\nTrying direct navigation to tickets portal...");
    await page.goto("https://tickets.la28.org/mycustomerdata/?#/myCustomerData", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(10000);
    
    console.log(`\nFINAL URL: ${page.url()}`);
    console.log(`FINAL TITLE: ${await page.title()}`);
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 1500) || "");
    if (text.trim()) console.log("Text:", text);

    console.log("\nFull history:");
    urlHistory.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));

  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main();
