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
    log("🎵 Selecting events (up to 3)...");

    const pageDebug = await page.evaluate(`(() => {
      var allEls = document.querySelectorAll('*');
      var eventKeywords = ['inglewood', 'vancouver', 'ciudad', 'sofi', 'bc place', 'estadio', 'gnp'];
      var foundElements = [];
      for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        var text = (el.innerText || '').toLowerCase().substring(0, 200);
        for (var k = 0; k < eventKeywords.length; k++) {
          if (text.includes(eventKeywords[k]) && el.children.length < 20) {
            foundElements.push({
              tag: el.tagName,
              classes: (el.className || '').toString().substring(0, 100),
              role: el.getAttribute('role') || '',
              ariaChecked: el.getAttribute('aria-checked') || '',
              dataTestId: el.getAttribute('data-testid') || '',
              clickable: typeof el.onclick === 'function' || el.style.cursor === 'pointer',
              text: (el.innerText || '').replace(/\\n/g, ' ').substring(0, 80)
            });
            break;
          }
        }
      }
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var cbInfo = [];
      for (var j = 0; j < checkboxes.length; j++) {
        var lbl = checkboxes[j].closest('label') || checkboxes[j].parentElement;
        cbInfo.push({
          id: checkboxes[j].id,
          name: checkboxes[j].name,
          visible: checkboxes[j].offsetParent !== null,
          checked: checkboxes[j].checked,
          labelText: (lbl ? lbl.innerText : '').replace(/\\n/g, ' ').substring(0, 80)
        });
      }
      return { eventElements: foundElements.slice(0, 30), checkboxes: cbInfo };
    })()`) as any;

    log("🔍 Page structure: " + (pageDebug.eventElements?.length || 0) + " event elements, " + (pageDebug.checkboxes?.length || 0) + " checkboxes");
    for (const el of (pageDebug.eventElements || []).slice(0, 10)) {
      log("  Element: <" + el.tag + "> role=" + el.role + " aria-checked=" + el.ariaChecked + " data-testid=" + el.dataTestId + " classes=" + el.classes.substring(0, 50));
    }
    for (const cb of (pageDebug.checkboxes || [])) {
      log("  Checkbox: id=" + cb.id + " name=" + cb.name + " visible=" + cb.visible + " checked=" + cb.checked + " label=" + cb.labelText.substring(0, 50));
    }

    const eventResult = await page.evaluate(`(() => {
      var results = [];
      var maxEvents = 3;

      var cards = document.querySelectorAll('[role="checkbox"], [role="option"], [data-testid*="event"], [class*="event-card"], [class*="EventCard"], [class*="event_card"]');
      if (cards.length > 0) {
        var count = 0;
        for (var i = 0; i < cards.length && count < maxEvents; i++) {
          var isChecked = cards[i].getAttribute('aria-checked') === 'true' || cards[i].classList.contains('selected') || cards[i].classList.contains('checked');
          if (!isChecked) {
            cards[i].click();
            count++;
          } else {
            count++;
          }
          results.push((cards[i].innerText || '').replace(/\\n/g, ' ').substring(0, 80));
        }
        if (count > 0) return { selected: results, method: 'aria-role', total: cards.length };
      }

      var allDivs = document.querySelectorAll('div, li, article, section, button');
      var eventKeywords = ['INGLEWOOD', 'VANCOUVER', 'CIUDAD', 'SOFI', 'BC PLACE', 'ESTADIO'];
      var eventCards = [];
      for (var j = 0; j < allDivs.length; j++) {
        var el = allDivs[j];
        var text = (el.innerText || '').toUpperCase();
        var directText = '';
        for (var c = 0; c < el.childNodes.length; c++) {
          if (el.childNodes[c].nodeType === 3) directText += el.childNodes[c].textContent;
        }
        var childCount = el.querySelectorAll('*').length;
        if (childCount > 30) continue;
        
        var hasKeyword = false;
        for (var k = 0; k < eventKeywords.length; k++) {
          if (text.includes(eventKeywords[k])) { hasKeyword = true; break; }
        }
        if (!hasKeyword) continue;
        
        var hasDate = text.includes('SEP') || text.includes('OCT') || text.includes('DEC') || text.includes('PRESALE');
        if (!hasDate) continue;

        var isDuplicate = false;
        for (var d = 0; d < eventCards.length; d++) {
          if (eventCards[d].el.contains(el) || el.contains(eventCards[d].el)) {
            if (el.querySelectorAll('*').length < eventCards[d].el.querySelectorAll('*').length) {
              eventCards[d] = { el: el, text: text };
            }
            isDuplicate = true;
            break;
          }
        }
        if (!isDuplicate) eventCards.push({ el: el, text: text });
      }

      var selected = 0;
      for (var m = 0; m < eventCards.length && selected < maxEvents; m++) {
        eventCards[m].el.click();
        selected++;
        results.push((eventCards[m].el.innerText || '').replace(/\\n/g, ' ').substring(0, 80));
      }
      if (selected > 0) return { selected: results, method: 'keyword-click', total: eventCards.length };

      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var evtCbs = [];
      for (var n = 0; n < checkboxes.length; n++) {
        var container = checkboxes[n].closest('label') || checkboxes[n].parentElement;
        var cText = (container ? container.innerText : '').toLowerCase();
        var isConsent = cText.includes('consent') || cText.includes('privacy') || cText.includes('marketing') || cText.includes('submitting') || cText.includes('email address') || cText.includes('mobile phone') || cText.includes('fan list');
        if (!isConsent && checkboxes[n].offsetParent !== null) {
          evtCbs.push({ cb: checkboxes[n], text: (container ? container.innerText : '').replace(/\\n/g, ' ').substring(0, 80) });
        }
      }
      for (var p = 0; p < evtCbs.length && p < maxEvents; p++) {
        if (!evtCbs[p].cb.checked) {
          evtCbs[p].cb.click();
          evtCbs[p].cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        results.push(evtCbs[p].text);
      }
      if (results.length > 0) return { selected: results, method: 'checkbox', total: evtCbs.length };

      return { selected: [], method: 'none', total: 0 };
    })()`) as any;

    log("Selection method: " + (eventResult.method || 'unknown'));
    if (eventResult.selected && eventResult.selected.length > 0) {
      log("✅ Selected " + eventResult.selected.length + " events:");
      for (const ev of eventResult.selected) {
        log("  ☑ " + ev);
      }
    } else {
      log("⚠️ No events could be selected. Total found: " + eventResult.total);
    }

    await page.waitForTimeout(1500);

    const verifySelection = await page.evaluate(`(() => {
      var checked = document.querySelectorAll('[aria-checked="true"], .selected, .checked, input[type="checkbox"]:checked');
      var texts = [];
      for (var i = 0; i < checked.length; i++) {
        var t = (checked[i].innerText || '').replace(/\\n/g, ' ').substring(0, 60);
        if (t) texts.push(t);
      }
      return { count: checked.length, items: texts };
    })()`) as any;
    log("📋 Verified selections: " + verifySelection.count + " items checked");

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
