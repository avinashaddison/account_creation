import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

async function test() {
  const execPath = '/home/runner/workspace/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
  const browser = await chromium.launch({ headless: true, executablePath: execPath, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Login
  await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
  try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
  await page.waitForTimeout(3000);
  await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
  await page.evaluate(`(() => {
    var ef = document.querySelectorAll('input[data-gigya-name="loginID"]');
    var pf = document.querySelectorAll('input[type="password"][data-gigya-name="password"]');
    var ve, vp;
    for (var i = 0; i < ef.length; i++) { if (ef[i].getBoundingClientRect().width > 0) { ve = ef[i]; break; } }
    for (var i = 0; i < pf.length; i++) { if (pf[i].getBoundingClientRect().width > 0) { vp = pf[i]; break; } }
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    ns.call(ve, 'epiceagle9772@dollicons.com'); ve.dispatchEvent(new Event('input', {bubbles:true})); ve.dispatchEvent(new Event('change', {bubbles:true}));
    ns.call(vp, '$$UD9un8dHeEw9'); vp.dispatchEvent(new Event('input', {bubbles:true})); vp.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await page.waitForTimeout(500);
  await page.evaluate(`(() => { var b = document.querySelectorAll('input[type="submit"]'); for (var i = 0; i < b.length; i++) { if (b[i].getBoundingClientRect().width > 0) { b[i].click(); break; } } })()`);

  try { await page.waitForURL("**/consent.html*", { timeout: 20000 }); } catch {
    console.log("No consent:", page.url().substring(0, 80));
    if (!page.url().includes("consent.html")) { await context.close(); await browser.close(); return; }
  }
  console.log("On consent! Filling form...");
  await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Show screen-set, fill, and submit
  await page.evaluate(`(() => { var d = document.createElement('div'); d.id='cc'; d.style.cssText='width:600px;margin:20px auto;'; document.body.appendChild(d); })()`);
  
  const loaded = await page.evaluate(`
    new Promise(function(resolve) {
      gigya.accounts.showScreenSet({
        screenSet: 'Default-RegistrationLogin',
        startScreen: 'gigya-complete-registration-screen',
        containerID: 'cc',
        onAfterScreenLoad: function() { resolve(true); },
        onError: function() { resolve(false); }
      });
      setTimeout(function() { resolve(false); }, 15000);
    })
  `);
  if (!loaded) { console.log("Screen failed"); await context.close(); await browser.close(); return; }
  await page.waitForTimeout(1000);

  // Fill fields with Playwright
  const ei = page.locator('#cc input[name="email"]');
  await ei.click({ clickCount: 3 }); await page.keyboard.type('epiceagle9772@dollicons.com', { delay: 5 });
  await page.locator('#cc select[name="profile.birthYear"]').selectOption('1990');
  const zi = page.locator('#cc input[name="profile.zip"]');
  await zi.click({ clickCount: 3 }); await page.keyboard.type('90001', { delay: 5 });
  const sc = page.locator('#cc input[name="data.subscribe"]');
  if (!(await sc.isChecked())) await sc.check();

  // Submit and wait for afterSubmit
  const submitOk = await page.evaluate(`
    new Promise(function(resolve) {
      window._submitDone = false;
      gigya.accounts.addEventHandlers({
        onAfterSubmit: function(e) {
          window._submitDone = true;
          resolve(true);
        }
      });
      var btn = document.querySelector('#cc input[type="submit"]');
      if (btn) btn.click();
      setTimeout(function() { resolve(window._submitDone); }, 15000);
    })
  `);
  console.log("Form submitted:", submitOk);

  // Now call redirectToContinue
  console.log("Calling redirectToContinue...");
  try {
    await page.evaluate(`gigya.fidm.oidc.op.redirectToContinue()`);
  } catch {}
  
  // Also try navigating directly 
  await page.waitForTimeout(3000);
  const urlAfterRedirect = page.url();
  console.log("URL after redirectToContinue:", urlAfterRedirect.substring(0, 100));

  if (urlAfterRedirect.includes("consent.html")) {
    // The redirect didn't work, try navigating to proxy.html manually
    console.log("Still on consent. Trying proxy.html...");
    try {
      await page.goto("https://la28id.la28.org/proxy.html?mode=afterLogin", { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(10000);
      console.log("After proxy.html:", page.url().substring(0, 100));
    } catch(e: any) {
      console.log("proxy.html error:", e.message.substring(0, 80));
    }
  }

  // Track where we end up
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (url.includes("tickets.la28.org")) {
      console.log("TICKETS PORTAL REACHED:", url.substring(0, 100));
      await page.waitForTimeout(5000);
      const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
      console.log("Text:", text.substring(0, 300));
      break;
    }
  }

  console.log("\nFinal URL:", page.url().substring(0, 120));
  const ft = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
  console.log("Final text:", ft.substring(0, 200));

  await context.close();
  await browser.close();
}

test().catch(e => console.error("Fatal:", e.message));
