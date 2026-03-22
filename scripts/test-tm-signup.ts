import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

async function testTMSignup() {
  // Use a fresh random email for testing
  const rand = Math.floor(Math.random() * 99999);
  const email = `testuser${rand}@sharebot.net`;
  // Generate a unique random password to avoid HIBP (Have I Been Pwned) rejection
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let rawPwd = pick(upper) + pick(upper) + pick(lower) + pick(lower) + pick(lower)
    + pick(digits) + pick(digits) + pick(special) + pick(special);
  const all = upper + lower + digits;
  for (let i = 0; i < 6; i++) rawPwd += pick(all);
  const tmPassword = rawPwd.split("").sort(() => Math.random() - 0.5).join("");
  const firstName = "John";
  const lastName = "Smith";

  const proxyUrl = "http://package-339278-country-us-sessionid-diag001test-sessionlength-300-opt-wb:ejOmfeLuOA4CLYRh@proxy.soax.com:5000";

  console.log(`\n=== TM Signup Diagnostic Test ===`);
  console.log(`Email: ${email}`);
  console.log(`TM Password: ${tmPassword}`);

  chromium.use(StealthPlugin());
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "America/New_York",
    ignoreHTTPSErrors: true,
    proxy: {
      server: "http://proxy.soax.com:5000",
      username: "package-339278-country-us-sessionid-diag001test-sessionlength-300-opt-wb",
      password: "ejOmfeLuOA4CLYRh"
    }
  });
  const page = await context.newPage();

  try {
    const authUrl = "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https://identity.ticketmaster.com/exchange&visualPresets=tm&lang=en-us&placementId=tmolMyAccount&showHeader=true&hideLeftPanel=false&integratorId=prd116.tmol&intSiteToken=tm-us";

    console.log("\n[1] Navigating to TM auth...");
    await page.goto(authUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(5000);
    console.log("[1] URL:", page.url().substring(0, 100));
    let page1Text = "";
    try { page1Text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || ""); } catch {}
    console.log("[1] Page text:", page1Text.replace(/\n/g, ' | '));

    // Wait for Akamai challenge to resolve (up to 60s)
    console.log("[1] Waiting for challenge to resolve...");
    let emailInput = null;
    for (let i = 0; i < 20; i++) {
      try { emailInput = await page.$('input[type="email"], input[name="email"]'); } catch {}
      if (emailInput) break;
      try {
        const currentText = await page.evaluate(() => document.body?.innerText?.substring(0, 100) || "");
        console.log(`[1] Wait ${(i+1)*3}s: ${currentText.replace(/\n/g, ' | ')}`);
      } catch { console.log(`[1] Wait ${(i+1)*3}s: (navigation in progress)`); }
      await page.waitForTimeout(3000);
    }

    // Fill email
    console.log("\n[2] Filling email...");
    if (!emailInput) { console.log("❌ No email field found after challenge wait!"); return; }
    await emailInput.fill(email);
    await page.waitForTimeout(500);

    // Click Continue
    const continueBtn = await page.$('button:has-text("Continue"), button:has-text("continue"), button:has-text("Next")');
    if (continueBtn) { await continueBtn.click(); }
    else {
      const allBtns = await page.$$('button');
      if (allBtns.length > 0) { await allBtns[0].click(); }
    }
    console.log("[2] Clicked Continue");
    await page.waitForTimeout(6000);

    const page2Text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log("[2] After Continue:", page2Text.replace(/\n/g, ' | '));
    console.log("[2] URL:", page.url().substring(0, 150));

    // Check for password field (sign-up form)
    const pwField = await page.$('input[type="password"], input[name="password"]');
    if (!pwField) {
      console.log("❌ No password field - page did not show sign-up form");
      console.log("Fields found:", await page.$$eval('input, select', els => els.map(e => ({type: (e as any).type, name: (e as any).name, id: e.id}))));
      return;
    }

    // Fill the sign-up form
    console.log("\n[3] Filling sign-up form...");
    const fields = await page.$$eval('input, select', els => els.map(e => ({ type: (e as any).type, name: (e as any).name, id: e.id, visible: (e.getBoundingClientRect() as any).width > 0 })).filter(f => f.visible));
    console.log("[3] Visible fields:", JSON.stringify(fields));

    await page.fill('input[name="firstName"]', firstName).catch(() => console.log("firstName fill failed"));
    await page.fill('input[name="lastName"]', lastName).catch(() => console.log("lastName fill failed"));

    // Password - type slowly
    await pwField.click();
    await page.keyboard.type(tmPassword, { delay: 40 });
    await page.waitForTimeout(500);

    // Country
    const countryResult = await page.evaluate(`(() => {
      var sel = document.querySelector('select[name="countryCode"]');
      if (!sel) return 'no-select';
      sel.value = 'US';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'US:' + sel.value;
    })()`);
    console.log("[3] Country set:", countryResult);

    // Postal code
    const zipField = await page.$('input[name="postalCode"]');
    if (zipField) { await zipField.fill("90001"); }

    // Check privacy checkbox
    await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      cbs.forEach(cb => { if (!cb.checked) cb.click(); });
    })()`);

    await page.waitForTimeout(1000);

    // Verify fields before submit
    const verifyFields = await page.evaluate(`(() => {
      var pw = document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]');
      var fn = document.querySelector('input[name="firstName"]');
      var ln = document.querySelector('input[name="lastName"]');
      var zip = document.querySelector('input[name="postalCode"]');
      var country = document.querySelector('select[name="countryCode"]');
      return { pw: pw?.value?.length || 0, fn: fn?.value || '', ln: ln?.value || '', zip: zip?.value || '', country: country?.value || '' };
    })()`);
    console.log("[3] Pre-submit field values:", JSON.stringify(verifyFields));

    // Intercept network requests to capture TM's submit API call
    const capturedRequests: string[] = [];
    const capturedResponses: string[] = [];
    page.on('request', req => {
      const url = req.url();
      if (url.includes('pingone') || url.includes('ticketmaster') || url.includes('identity')) {
        capturedRequests.push(`${req.method()} ${url.substring(0, 120)}`);
      }
    });
    page.on('response', async resp => {
      const url = resp.url();
      if (url.includes('pingone') || url.includes('ticketmaster') || url.includes('identity')) {
        let body = "";
        try { body = (await resp.text()).substring(0, 150); } catch {}
        capturedResponses.push(`${resp.status()} ${url.substring(0, 80)} → ${body.replace(/\n/g, ' ')}`);
      }
    });

    // Submit
    console.log("\n[4] Submitting form...");
    let submitBtn = await page.$('button:has-text("Next"), button:has-text("Create Account"), button:has-text("Sign Up"), button:has-text("Register")');
    if (!submitBtn) {
      const buttons = await page.$$('button');
      submitBtn = buttons[buttons.length - 1] || null;
    }
    if (submitBtn) {
      const btnText = await submitBtn.evaluate(el => el.textContent?.trim());
      console.log("[4] Clicking button:", btnText);
      await submitBtn.click();
    } else {
      console.log("❌ No submit button found");
      return;
    }

    // Immediate response (1s)
    await page.waitForTimeout(1000);
    const immediate = await page.evaluate(() => document.body?.innerText?.substring(0, 800) || "");
    console.log("\n[4] IMMEDIATE response (1s):", immediate.replace(/\n/g, ' | '));

    // 3 second response
    await page.waitForTimeout(2000);
    const after3s = await page.evaluate(() => document.body?.innerText?.substring(0, 800) || "");
    console.log("[4] 3-second response:", after3s.replace(/\n/g, ' | '));
    console.log("[4] URL after submit:", page.url().substring(0, 200));

    // Any error messages in DOM
    const errors = await page.evaluate(`(() => {
      var errorEls = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"], [class*="warning"], [class*="invalid"]');
      return Array.from(errorEls).map(el => ({ class: el.className, text: el.textContent?.trim().substring(0, 100) })).filter(e => e.text);
    })()`);
    console.log("[4] DOM errors:", JSON.stringify(errors));

    // Check every 3s for up to 30s
    for (let wi = 0; wi < 10; wi++) {
      await page.waitForTimeout(3000);
      const wText = await page.evaluate(() => document.body?.innerText?.substring(0, 1200) || "");
      const wUrl = page.url().substring(0, 150);
      console.log(`[4] Wait ${(wi + 1) * 3 + 3}s [${wUrl}]: ${wText.replace(/\n/g, ' | ')}`);
      if (wText.toLowerCase().includes("almost there") || wText.toLowerCase().includes("verify") ||
          wText.toLowerCase().includes("check your email") || wText.toLowerCase().includes("confirm your account") ||
          wText.toLowerCase().includes("unable to create") || !wText.toLowerCase().includes("welcome")) {
        console.log("[4] Page reached final state, stopping wait");
        break;
      }
    }

    console.log("\n[NET] Captured requests:", capturedRequests.length);
    capturedRequests.forEach(r => console.log("  REQ:", r));
    console.log("[NET] Captured responses:", capturedResponses.length);
    capturedResponses.forEach(r => console.log("  RESP:", r));

  } finally {
    await browser.close();
  }
}

testTMSignup().catch(console.error);
