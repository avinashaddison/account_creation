import { chromium } from "playwright";
import fs from "fs";

async function main() {
  const execPath = chromium.executablePath();
  if (!fs.existsSync(execPath)) {
    console.error("Chromium not found. Run: npx playwright install chromium");
    return;
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
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
    console.log("Page loaded. URL:", page.url());

    try {
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    } catch {
      console.log("Network idle timeout, continuing...");
    }

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
    console.log("Overlays removed.");

    await page.waitForTimeout(2000);

    console.log("Step 3: Filling credentials via JS...");
    const emailFilled = await page.evaluate(`((name, val) => {
      var inputs = document.querySelectorAll('input[data-gigya-name="' + name + '"]');
      var visible = null;
      var lastNonHidden = null;
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (el.type === 'hidden') continue;
        lastNonHidden = el;
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          visible = el;
        }
      }
      var target = visible || lastNonHidden;
      if (!target) return false;
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (setter && setter.set) {
        setter.set.call(target, val);
      } else {
        target.value = val;
      }
      target.dispatchEvent(new Event('focus', { bubbles: true }));
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    })("loginID", "${email}")`);
    console.log("Email filled:", emailFilled);

    const pwdFilled = await page.evaluate(`((name, val) => {
      var inputs = document.querySelectorAll('input[data-gigya-name="' + name + '"]');
      var visible = null;
      var lastNonHidden = null;
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (el.type === 'hidden') continue;
        lastNonHidden = el;
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          visible = el;
        }
      }
      var target = visible || lastNonHidden;
      if (!target) return false;
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (setter && setter.set) {
        setter.set.call(target, val);
      } else {
        target.value = val;
      }
      target.dispatchEvent(new Event('focus', { bubbles: true }));
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    })("password", "${password.replace(/"/g, '\\"')}")`);
    console.log("Password filled:", pwdFilled);

    if (!emailFilled || !pwdFilled) {
      console.log("Failed to fill one or both fields. Dumping all inputs:");
      const allInputs = await page.$$eval("input", (els: any[]) =>
        els.map((e: any) => ({
          type: e.type,
          name: e.name,
          gigyaName: e.getAttribute("data-gigya-name"),
          visible: e.offsetWidth > 0 && e.offsetHeight > 0,
        }))
      );
      console.log(JSON.stringify(allInputs, null, 2));
      await browser.close();
      return;
    }

    console.log("Step 4: Clicking submit...");
    const submitClicked = await page.evaluate(`(() => {
      var btn = document.querySelector('input.gigya-input-submit[type="submit"]') ||
                document.querySelector('.gigya-input-submit') ||
                document.querySelector('button[type="submit"]') ||
                document.querySelector('input[type="submit"]');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    console.log("Submit clicked:", submitClicked);

    if (!submitClicked) {
      console.log("No submit button found.");
      await browser.close();
      return;
    }

    console.log("Step 5: Waiting for response...");
    await page.waitForTimeout(15000);

    const finalUrl = page.url();
    console.log(`\n=== RESULT ===`);
    console.log(`Final URL: ${finalUrl}`);

    const errorElements = await page.$$('.gigya-error-msg, .gigya-error-msg-active, [class*="error"], [role="alert"]');
    for (const el of errorElements) {
      const text = await el.textContent();
      if (text && text.trim()) {
        console.log("Error message:", text.trim());
      }
    }

    const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 1500) || "");
    console.log("\nPage text after login attempt:");
    console.log(pageText);

  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main();
