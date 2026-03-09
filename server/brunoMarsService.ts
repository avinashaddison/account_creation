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
    let sessionReused = false;
    if (!page || !browser) {
      log("🌐 Opening new browser for presale (no active session)...");
      ownBrowser = await chromium.connectOverCDP(proxyUrl!, { timeout: 60000 });
      const ctx = ownBrowser.contexts()[0];
      page = ctx ? (ctx.pages()[0] || await ctx.newPage()) : await ownBrowser.newPage();
    } else {
      try {
        await page.evaluate("1+1");
        sessionReused = true;
        log("🔄 Reusing authenticated TM browser session");
      } catch {
        log("⚠️ TM session expired, opening new browser...");
        browser = null;
        ownBrowser = await chromium.connectOverCDP(proxyUrl!, { timeout: 60000 });
        const ctx = ownBrowser.contexts()[0];
        page = ctx ? (ctx.pages()[0] || await ctx.newPage()) : await ownBrowser.newPage();
      }
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
        var container = checkboxes[i].closest('label') || checkboxes[i].closest('[class*="event"]') || checkboxes[i].closest('li') || checkboxes[i].closest('div');
        var text = (container ? container.innerText : '').toUpperCase();
        var textLower = text.toLowerCase();
        var isConsent = textLower.includes('consent') || textLower.includes('privacy') || textLower.includes('marketing') || textLower.includes('submitting') || textLower.includes('email address') || textLower.includes('mobile phone') || textLower.includes('fan list');
        if (!isConsent && text.length > 5) {
          eventCheckboxes.push({ checkbox: checkboxes[i], text: (container ? container.innerText : '').replace(/\\n/g, ' ').substring(0, 100) });
        }
      }
      for (var k = 0; k < eventCheckboxes.length; k++) {
        var cb = eventCheckboxes[k].checkbox;
        if (!cb.checked) {
          cb.click();
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        results.push(eventCheckboxes[k].text);
      }
      return { selected: results, total: checkboxes.length };
    })()`) as any;

    if (eventResult.selected && eventResult.selected.length > 0) {
      log("✅ Selected " + eventResult.selected.length + " events:");
      for (const ev of eventResult.selected) {
        log("  ☑ " + ev);
      }
    } else {
      log("⚠️ No event checkboxes found (total checkboxes: " + eventResult.total + "). Page may have different layout.");
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
      const presaleUrl = page.url();

      for (let checkRound = 0; checkRound < 5; checkRound++) {
        await page.waitForTimeout(checkRound === 0 ? 2000 : 2000);

        if (checkRound === 1 || checkRound === 3) {
          await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`).catch(() => {});
          await page.waitForTimeout(1000);
        }

        const currentUrl = page.url();
        const fullText = await page.evaluate(() => (document.body?.innerText || "")).catch(() => "");
        const fullLower = fullText.toLowerCase();

        if (fullLower.includes("your selections") || fullLower.includes("edit selections") || fullLower.includes("you're signed up") || fullLower.includes("you are signed up")) {
          onStatusUpdate("completed");
          log("✅ SUCCESS! Bruno Mars presale confirmed - YOUR SELECTIONS / signed up page visible!");
          return { success: true };
        }

        if (fullLower.includes("thank") || fullLower.includes("success") || fullLower.includes("confirmed") || fullLower.includes("registered")) {
          onStatusUpdate("completed");
          log("✅ SUCCESS! Bruno Mars presale signup confirmed!");
          return { success: true };
        }

        const urlChanged = currentUrl !== presaleUrl && !currentUrl.includes("brunomars");
        const isHomepage = fullLower.includes("welcome back") || fullLower.includes("shop millions") || fullLower.includes("discover can't-miss");
        if (urlChanged || isHomepage) {
          onStatusUpdate("completed");
          log("✅ SUCCESS! Page redirected away from presale form after Sign Up click — signup accepted!");
          log("📄 Redirected to: " + currentUrl.substring(0, 120));
          return { success: true };
        }

        if (fullLower.includes("error") && (fullLower.includes("try again") || fullLower.includes("something went wrong"))) {
          log("❌ Error detected on page after submit: " + fullText.substring(0, 200).replace(/\n/g, ' '));
          return { success: false, error: "Presale form returned an error after submission" };
        }

        log(`⏳ Check ${checkRound + 1}/5 — still waiting for confirmation...`);
      }

      const finalText = await page.evaluate(() => (document.body?.innerText || "").substring(0, 500)).catch(() => "");
      log("⚠️ No clear confirmation after all checks. Final page: " + finalText.substring(0, 200).replace(/\n/g, ' '));
      return { success: false, error: "Form submitted but no confirmation detected after 5 checks: " + finalText.substring(0, 150).replace(/\n/g, ' ') };
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
