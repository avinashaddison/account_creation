import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const ZENROWS_WSS = "wss://browser.zenrows.com?apikey=16ad08cfa1bc9df048d189ed3fafd0e1957d178a";

async function testShakiraPresale() {
  console.log("[Test] Connecting to ZenRows browser...");
  const browser = await chromium.connectOverCDP(ZENROWS_WSS, { timeout: 60000 });
  const ctx = browser.contexts()[0];
  const page = ctx ? (ctx.pages()[0] || await ctx.newPage()) : await browser.newPage();
  page.setDefaultTimeout(60000);

  const log = (msg: string) => console.log(`[Shakira] ${msg}`);

  try {
    log("Navigating to Shakira presale page...");
    await page.goto("https://signup.ticketmaster.es/shakira", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const title = await page.title().catch(() => "");
    log(`Page title: ${title}`);
    log(`URL: ${page.url()}`);
    const bodyText = await page.evaluate(`document.body?.innerText?.substring(0, 400) || ''`);
    log(`Body text: ${String(bodyText).replace(/\n/g, ' ')}`);

    // Dump all checkboxes
    const checkboxes = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      return Array.from(cbs).map(cb => {
        var p = cb.closest('label, li, div, tr, section') || cb.parentElement;
        return { id: cb.id, checked: cb.checked, text: (p ? (p.innerText||'').trim() : '').substring(0, 100) };
      });
    })()`);
    log(`Checkboxes found (${(checkboxes as any[]).length}): ${JSON.stringify(checkboxes, null, 2)}`);

    // Select ONLY Sept 26
    const dateResult = await page.evaluate(`(() => {
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var result = { checked26: false, unchecked25: false, unchecked27: false, found: [] };
      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        var parent = cb.closest('label, li, div, tr, section') || cb.parentElement;
        var text = parent ? (parent.innerText || parent.textContent || '').trim() : '';
        var isConsent = text.toLowerCase().includes('consent') || text.toLowerCase().includes('marketing')
          || text.toLowerCase().includes('fan list') || text.toLowerCase().includes('live nation')
          || text.toLowerCase().includes('privacy') || text.toLowerCase().includes('mailing');
        if (isConsent) continue;
        var has26 = /\\b26\\b/.test(text) || text.includes('26 SEPT') || text.includes('26\\nSEPT');
        var has25 = /\\b25\\b/.test(text) || text.includes('25 SEPT') || text.includes('25\\nSEPT');
        var has27 = /\\b27\\b/.test(text) || text.includes('27 SEPT') || text.includes('27\\nSEPT');
        result.found.push({ text: text.substring(0, 60), has25, has26, has27, checked: cb.checked });
        if (has26) { if (!cb.checked) { cb.click(); cb.dispatchEvent(new Event('change', { bubbles: true })); } result.checked26 = true; }
        else if (has25 || has27) { if (cb.checked) { cb.click(); cb.dispatchEvent(new Event('change', { bubbles: true })); } if (has25) result.unchecked25 = true; if (has27) result.unchecked27 = true; }
      }
      return result;
    })()`);
    log(`Date selection result: ${JSON.stringify(dateResult, null, 2)}`);

    await page.waitForTimeout(1000);

    // Check all consent boxes
    const consentsChecked = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      var count = 0;
      for (var i = 0; i < cbs.length; i++) {
        var cb = cbs[i];
        var p = cb.closest('label, li, div, tr, section') || cb.parentElement;
        var text = (p ? p.innerText || p.textContent || '' : '').toLowerCase();
        var isConsent = text.includes('consent') || text.includes('marketing') || text.includes('fan list') || text.includes('live nation') || text.includes('privacy') || text.includes('mailing');
        if (isConsent) { if (!cb.checked) { cb.click(); cb.dispatchEvent(new Event('change', { bubbles: true })); } count++; }
      }
      return count;
    })()`);
    log(`Consent boxes checked: ${consentsChecked}`);

    // Final state
    const finalState = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      return Array.from(cbs).filter(cb => {
        var p = cb.closest('label, li, div, tr, section') || cb.parentElement;
        var text = (p ? p.innerText || '' : '').trim();
        return text.length > 5 && !text.includes('Switch Label') && !text.includes('checkbox label');
      }).map(cb => {
        var p = cb.closest('label, li, div, tr, section') || cb.parentElement;
        return { checked: cb.checked, text: (p ? (p.innerText||'').trim() : '').substring(0, 80) };
      });
    })()`);
    log(`Final checkbox states: ${JSON.stringify(finalState, null, 2)}`);

    // Click Sign Up
    const signUpResult = await page.evaluate(`(() => {
      var buttons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          var text = (btn.innerText || btn.textContent || btn.value || '').trim().toLowerCase();
          if (text.includes('sign up') || text === 'submit' || text.includes('register')) {
            btn.click();
            return 'clicked:' + text;
          }
        }
      }
      return 'not-found';
    })()`);
    log(`Sign Up click result: ${signUpResult}`);

    // Wait and see where we land
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2000);
      const url = page.url();
      const text = String(await page.evaluate(`document.body?.innerText?.substring(0, 150) || ''`));
      log(`[${(i+1)*2}s] URL: ${url.substring(0, 120)}`);
      log(`[${(i+1)*2}s] Page snippet: ${text.replace(/\n/g, ' ').substring(0, 100)}`);
      if (!url.includes("shakira")) {
        log("✅ Left Shakira page! Flow redirected successfully.");
        break;
      }
    }

  } finally {
    await browser.close().catch(() => {});
    log("Done.");
  }
}

testShakiraPresale().catch(err => { console.error("[Test] FAILED:", err.message); process.exit(1); });
