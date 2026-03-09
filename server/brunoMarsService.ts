import type { Page, Browser } from "playwright-core";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const PRESALE_URL = "https://signup.ticketmaster.ca/brunomars";

export async function brunoMarsPresaleStep(
  page: Page,
  browser: Browser | null,
  log: (msg: string) => void,
  onStatusUpdate: (status: string) => void,
  proxyUrl?: string
): Promise<{ success: boolean; error?: string }> {
  let ownBrowser: Browser | null = null;

  try {
    if (!page || !browser) {
      log("🌐 Opening new browser for presale (no active session)...");
      ownBrowser = await chromium.connectOverCDP(proxyUrl!, { timeout: 60000 });
      const ctx = ownBrowser.contexts()[0];
      page = ctx ? (ctx.pages()[0] || await ctx.newPage()) : await ownBrowser.newPage();
    }

    onStatusUpdate("presale_loading");
    log("🔗 Navigating to Bruno Mars presale page...");

    await page.route("**/*contentsquare*", (route) => route.abort()).catch(() => {});
    await page.route("**/*cs-sdk*", (route) => route.abort()).catch(() => {});

    await page.goto(PRESALE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

    for (let w = 0; w < 20; w++) {
      await page.waitForTimeout(2000);
      const text = await page.evaluate(() => (document.body?.innerText || "").substring(0, 500).toLowerCase());
      if (text.includes("select your events") || text.includes("sign up") || text.includes("inglewood") || text.includes("vancouver") || text.includes("ciudad")) {
        log("📄 Presale page loaded!");
        break;
      }
      if (text.includes("checking") || text.includes("one moment") || text.includes("loading")) {
        log(`⏳ Waiting for page to load... (${w * 2}s)`);
        continue;
      }
      if (w >= 19) {
        const url = page.url();
        log("⚠️ Page may not have fully loaded. URL: " + url.substring(0, 100));
      }
    }

    await page.evaluate(`(() => {
      var selectors = ['[id*="onetrust"]', '[class*="onetrust"]', '[id*="cookie"]', '[class*="cookie"]', '[class*="consent-banner"]', '[id*="consent"]', '.modal-overlay', '.overlay'];
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) { els[j].remove(); }
      }
    })()`);

    await page.waitForTimeout(1000);

    onStatusUpdate("presale_events");
    log("🎵 Selecting ALL events...");

    const eventResult = await page.evaluate(`(() => {
      var results = [];
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var eventCheckboxes = [];
      for (var i = 0; i < checkboxes.length; i++) {
        var label = checkboxes[i].closest('label') || checkboxes[i].parentElement;
        var text = (label ? label.innerText : '').trim();
        if (text && (text.includes('SEP') || text.includes('OCT') || text.includes('NOV') || text.includes('DEC') || text.includes('JAN') || text.includes('FEB') || text.includes('MAR') || text.includes('INGLEWOOD') || text.includes('VANCOUVER') || text.includes('CIUDAD') || text.includes('Stadium') || text.includes('Place') || text.includes('Seguros') || text.includes('PRESALE'))) {
          eventCheckboxes.push({ checkbox: checkboxes[i], text: text.substring(0, 80) });
        }
      }
      if (eventCheckboxes.length === 0) {
        var allCbs = document.querySelectorAll('input[type="checkbox"]');
        var nonConsent = [];
        for (var j = 0; j < allCbs.length; j++) {
          var lbl = allCbs[j].closest('label') || allCbs[j].parentElement;
          var t = (lbl ? lbl.innerText : '').toLowerCase();
          if (!t.includes('consent') && !t.includes('privacy') && !t.includes('marketing') && !t.includes('submitting') && !t.includes('email address')) {
            nonConsent.push({ checkbox: allCbs[j], text: (lbl ? lbl.innerText : '').substring(0, 80) });
          }
        }
        eventCheckboxes = nonConsent;
      }
      for (var k = 0; k < eventCheckboxes.length; k++) {
        var cb = eventCheckboxes[k].checkbox;
        if (!cb.checked) {
          cb.click();
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        results.push(eventCheckboxes[k].text.replace(/\\n/g, ' ').substring(0, 60));
      }
      return { selected: results, total: checkboxes.length };
    })()`) as any;

    if (eventResult.selected && eventResult.selected.length > 0) {
      log(`✅ Selected ${eventResult.selected.length} events:`);
      for (const ev of eventResult.selected) {
        log(`  ☑ ${ev}`);
      }
    } else {
      log(`⚠️ No event checkboxes found (total checkboxes on page: ${eventResult.total})`);
    }

    await page.waitForTimeout(500);

    log("☑ Checking consent boxes...");
    const consentResult = await page.evaluate(`(() => {
      var checked = 0;
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < checkboxes.length; i++) {
        var label = checkboxes[i].closest('label') || checkboxes[i].parentElement;
        var text = (label ? label.innerText : '').toLowerCase();
        if (text.includes('consent') || text.includes('privacy') || text.includes('submitting') || text.includes('marketing') || text.includes('email address') || text.includes('mobile phone') || text.includes('fan list')) {
          if (!checkboxes[i].checked) {
            checkboxes[i].click();
            checkboxes[i].dispatchEvent(new Event('change', { bubbles: true }));
            checked++;
          } else {
            checked++;
          }
        }
      }
      return checked;
    })()`) as number;
    log(`✅ ${consentResult} consent box(es) checked`);

    await page.waitForTimeout(1000);

    onStatusUpdate("presale_submitting");
    log("🔘 Clicking Sign Up button...");

    const submitResult = await page.evaluate(`(() => {
      var buttons = document.querySelectorAll('button, input[type="submit"], a');
      for (var i = 0; i < buttons.length; i++) {
        var t = (buttons[i].textContent || buttons[i].value || '').toLowerCase().trim();
        if (t === 'sign up' || t === 'signup' || t === 'register' || t === 'submit') {
          buttons[i].click();
          return 'clicked: ' + (buttons[i].textContent || buttons[i].value || '').trim();
        }
      }
      for (var j = 0; j < buttons.length; j++) {
        var t2 = (buttons[j].textContent || buttons[j].value || '').toLowerCase().trim();
        if (t2.includes('sign up') || t2.includes('signup')) {
          buttons[j].click();
          return 'clicked: ' + (buttons[j].textContent || buttons[j].value || '').trim();
        }
      }
      return 'not-found: buttons=' + buttons.length;
    })()`) as string;

    log("Submit: " + submitResult);

    if (submitResult.startsWith("clicked")) {
      log("⏳ Waiting for confirmation...");
      await page.waitForTimeout(8000);

      const afterText = await page.evaluate(() => (document.body?.innerText || "").substring(0, 800));
      const afterLower = afterText.toLowerCase();

      if (afterLower.includes("your selections") || afterLower.includes("edit selections")) {
        onStatusUpdate("completed");
        log("✅ SUCCESS! Bruno Mars presale confirmed - YOUR SELECTIONS page visible!");
        return { success: true };
      } else if (afterLower.includes("thank") || afterLower.includes("success") || afterLower.includes("confirmed") || afterLower.includes("registered")) {
        onStatusUpdate("completed");
        log("✅ SUCCESS! Bruno Mars presale signup confirmed!");
        return { success: true };
      } else {
        log("⚠️ Form submitted but no clear confirmation found. Response: " + afterText.substring(0, 200).replace(/\n/g, ' '));
        return { success: false, error: "Form submitted but no confirmation detected: " + afterText.substring(0, 150).replace(/\n/g, ' ') };
      }
    } else {
      log("❌ Could not find Sign Up button. " + submitResult);
      return { success: false, error: "Sign Up button not found" };
    }
  } catch (err: any) {
    log("❌ Presale error: " + err.message.substring(0, 200));
    return { success: false, error: err.message };
  } finally {
    try {
      if (ownBrowser) await ownBrowser.close();
      else if (browser) await browser.close();
    } catch {}
  }
}
