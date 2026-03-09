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
    log("🎵 Selecting Inglewood, CA - SoFi Stadium (Sep 30) event only...");

    const eventResult = await page.evaluate(`(() => {
      var results = [];
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var found = false;
      for (var i = 0; i < checkboxes.length; i++) {
        var container = checkboxes[i].closest('label') || checkboxes[i].closest('[class*="event"]') || checkboxes[i].closest('li') || checkboxes[i].closest('div');
        var text = (container ? container.innerText : '').toUpperCase();
        if ((text.includes('INGLEWOOD') || text.includes('SOFI')) && (text.includes('SEP') || text.includes('30'))) {
          if (!checkboxes[i].checked) {
            checkboxes[i].click();
            checkboxes[i].dispatchEvent(new Event('change', { bubbles: true }));
          }
          found = true;
          results.push((container ? container.innerText : '').replace(/\\n/g, ' ').substring(0, 100));
        }
      }
      if (!found) {
        for (var j = 0; j < checkboxes.length; j++) {
          var c2 = checkboxes[j].closest('label') || checkboxes[j].closest('[class*="event"]') || checkboxes[j].closest('li') || checkboxes[j].closest('div');
          var t2 = (c2 ? c2.innerText : '').toUpperCase();
          if (t2.includes('INGLEWOOD') || t2.includes('SOFI')) {
            if (!checkboxes[j].checked) {
              checkboxes[j].click();
              checkboxes[j].dispatchEvent(new Event('change', { bubbles: true }));
            }
            found = true;
            results.push((c2 ? c2.innerText : '').replace(/\\n/g, ' ').substring(0, 100));
          }
        }
      }
      return { selected: results, found: found, total: checkboxes.length };
    })()`) as any;

    if (eventResult.found && eventResult.selected.length > 0) {
      log(`✅ Selected Inglewood event:`);
      for (const ev of eventResult.selected) {
        log(`  ☑ ${ev}`);
      }
    } else {
      log(`⚠️ Inglewood/SoFi event not found (total checkboxes: ${eventResult.total}). Page may have different layout.`);
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
