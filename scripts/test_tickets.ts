import { chromium } from 'playwright-extra';

async function test() {
  const execPath = '/home/runner/workspace/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
  const browser = await chromium.launch({ headless: true, executablePath: execPath });
  const context = await browser.newContext({
    proxy: {
      server: 'http://global.rp.lokiproxy.com:10000',
      username: 'USER133737-zone-custom',
      password: '7f2355'
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  
  try {
    console.log("Login with new account...");
    await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
    try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
    await page.waitForTimeout(5000);
    await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
    
    await page.evaluate(`(() => {
      var emailFields = document.querySelectorAll('input[name="username"], input[data-gigya-name="loginID"]');
      var passFields = document.querySelectorAll('input[type="password"][data-gigya-name="password"]');
      var visibleEmail = null, visiblePass = null;
      for (var i = 0; i < emailFields.length; i++) { if (emailFields[i].getBoundingClientRect().width > 0) { visibleEmail = emailFields[i]; break; } }
      for (var i = 0; i < passFields.length; i++) { if (passFields[i].getBoundingClientRect().width > 0) { visiblePass = passFields[i]; break; } }
      var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSet.call(visibleEmail, 'epiceagle9772@dollicons.com');
      visibleEmail.dispatchEvent(new Event('input', {bubbles: true}));
      visibleEmail.dispatchEvent(new Event('change', {bubbles: true}));
      nativeSet.call(visiblePass, '$$UD9un8dHeEw9');
      visiblePass.dispatchEvent(new Event('input', {bubbles: true}));
      visiblePass.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    await page.waitForTimeout(500);
    await page.evaluate(`(() => {
      var btns = document.querySelectorAll('input[type="submit"]');
      for (var i = 0; i < btns.length; i++) { if (btns[i].getBoundingClientRect().width > 0) { btns[i].click(); break; } }
    })()`);
    
    // Track URL changes
    console.log("Waiting for redirects...");
    await page.waitForTimeout(15000);
    const finalUrl = page.url();
    console.log("Final URL:", finalUrl);
    
    // Check if we ended up on consent.html or somewhere else
    if (finalUrl.includes("consent.html")) {
      console.log("STILL ON CONSENT PAGE - consent not yet resolved");
      
      // Check if there's a gigya screen-set form
      const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
      console.log("Consent text:", text.substring(0, 300));
    } else {
      console.log("NOT on consent page - good sign!");
      const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
      console.log("Page:", text.substring(0, 300));
    }
    
  } catch (err: any) {
    console.log("Error:", err.message.substring(0, 300));
  }
  
  await context.close();
  await browser.close();
}

test();
