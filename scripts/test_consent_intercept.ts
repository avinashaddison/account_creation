import { chromium } from 'playwright';

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
  page.on('console', msg => {
    if (msg.type() !== 'warning') console.log('[PAGE]', msg.text());
  });

  console.log("Step 1: Login...");
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

  console.log("Step 2: Wait for consent page...");
  try {
    await page.waitForURL("**/consent.html*", { timeout: 20000 });
    console.log("On consent page:", page.url().substring(0, 80));
  } catch {
    const url = page.url();
    if (url.includes("proxy.html")) {
      console.log("On proxy.html, waiting...");
      await page.waitForTimeout(10000);
    }
    console.log("Current URL:", page.url().substring(0, 80));
    if (!page.url().includes("consent.html")) {
      console.log("No consent page - account may be complete already!");
      await context.close(); await browser.close();
      return;
    }
  }

  console.log("Step 3: Wait for Gigya SDK on consent page...");
  await page.waitForFunction("typeof gigya !== 'undefined' && typeof gigya.accounts !== 'undefined'", { timeout: 15000 });
  console.log("Gigya SDK loaded!");

  console.log("Step 4: Inject container and show screen-set...");
  await page.evaluate(`(() => {
    var div = document.createElement('div');
    div.id = 'consent-container';
    div.style.cssText = 'width:600px;margin:20px auto;min-height:400px;';
    document.body.appendChild(div);
  })()`);

  const screenResult = await page.evaluate(`
    new Promise(function(resolve) {
      gigya.accounts.showScreenSet({
        screenSet: 'Default-RegistrationLogin',
        startScreen: 'gigya-complete-registration-screen',
        containerID: 'consent-container',
        onAfterScreenLoad: function(e) {
          resolve({ ok: true, screen: e.currentScreen });
        },
        onError: function(e) {
          resolve({ ok: false, error: e.errorCode + ': ' + (e.errorMessage || '') });
        }
      });
      setTimeout(function() { resolve({ ok: false, error: 'timeout' }); }, 20000);
    })
  `);
  console.log("Screen-set result:", JSON.stringify(screenResult));

  if (!(screenResult as any).ok) {
    console.log("Screen-set failed. Exiting.");
    await context.close(); await browser.close();
    return;
  }

  await page.waitForTimeout(2000);

  // Inspect what's in the form
  const formInfo = await page.evaluate(`(() => {
    var c = document.getElementById('consent-container');
    if (!c) return { error: 'no container' };
    var inputs = c.querySelectorAll('input, select, textarea');
    var fields = [];
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      fields.push({
        tag: inp.tagName,
        type: inp.type || '',
        name: inp.name || inp.getAttribute('data-gigya-name') || '',
        value: inp.value || '',
        visible: inp.getBoundingClientRect().width > 0
      });
    }
    return { fields: fields, html: c.innerHTML.substring(0, 1000) };
  })()`);
  console.log("Form fields:", JSON.stringify(formInfo, null, 2));

  console.log("Step 5: Fill and submit...");
  await page.evaluate(`(() => {
    var container = document.getElementById('consent-container');
    if (!container) return;
    var selects = container.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].value === '1990') {
          sel.value = sel.options[j].value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
    var checkboxes = container.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) {
      if (!checkboxes[i].checked) {
        checkboxes[i].checked = true;
        checkboxes[i].dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  })()`);

  await page.waitForTimeout(1000);
  
  // Click submit
  await page.evaluate(`(() => {
    var btn = document.querySelector('#consent-container input[type="submit"]');
    if (btn) btn.click();
  })()`);
  
  console.log("Submit clicked. Waiting...");
  await page.waitForTimeout(10000);
  
  const finalUrl = page.url();
  console.log("Final URL:", finalUrl);
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("Page text:", text.substring(0, 300));

  // Check for form errors
  const errors = await page.evaluate(`(() => {
    var errs = document.querySelectorAll('.gigya-error-msg-active, .gigya-error-msg');
    var result = [];
    for (var i = 0; i < errs.length; i++) {
      var t = errs[i].textContent.trim();
      if (t) result.push(t);
    }
    return result;
  })()`) as string[];
  if (errors.length > 0) console.log("Form errors:", errors);

  await context.close();
  await browser.close();
}

test().catch(e => console.error("Fatal:", e.message));
