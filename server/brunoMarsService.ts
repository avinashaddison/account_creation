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
        ownBrowser = await chromium.connectOverCDP(bmCdpUrl, { timeout: 60000 });
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
    console.log("[BM-Presale] Starting event selection...");

    let selectedCount = 0;

    const domInfo = await page.evaluate(`(() => {
      var result = { checkboxInputs: [], eventRowHtml: '', firstRowParentHtml: '' };
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < cbs.length; i++) {
        var parent = cbs[i].closest('label') || cbs[i].closest('div') || cbs[i].parentElement;
        var grandparent = parent ? parent.parentElement : null;
        var text = '';
        var searchEl = parent;
        for (var depth = 0; depth < 5 && searchEl; depth++) {
          text = (searchEl.innerText || '').replace(/\\n/g, ' ').substring(0, 150);
          if (text.length > 20) break;
          searchEl = searchEl.parentElement;
        }
        result.checkboxInputs.push({
          id: cbs[i].id || '',
          name: cbs[i].name || '',
          checked: cbs[i].checked,
          visible: cbs[i].offsetParent !== null || cbs[i].offsetWidth > 0 || cbs[i].offsetHeight > 0,
          parentTag: parent ? parent.tagName : '',
          parentClasses: parent ? (parent.className || '').toString().substring(0, 100) : '',
          grandparentTag: grandparent ? grandparent.tagName : '',
          nearbyText: text,
          isConsent: text.toLowerCase().includes('consent') || text.toLowerCase().includes('submitting') || text.toLowerCase().includes('privacy') || text.toLowerCase().includes('fan list') || text.toLowerCase().includes('marketing')
        });
      }
      var inglewood = null;
      var allEls = document.querySelectorAll('*');
      for (var j = 0; j < allEls.length; j++) {
        if (allEls[j].children.length < 3 && (allEls[j].textContent || '').includes('INGLEWOOD')) {
          inglewood = allEls[j];
          break;
        }
      }
      if (inglewood) {
        var row = inglewood;
        for (var k = 0; k < 8; k++) {
          if (!row.parentElement) break;
          row = row.parentElement;
          var rowCbs = row.querySelectorAll('input[type="checkbox"]');
          if (rowCbs.length === 1) {
            result.eventRowHtml = row.outerHTML.substring(0, 800);
            result.firstRowParentHtml = row.parentElement ? row.parentElement.outerHTML.substring(0, 200) : '';
            break;
          }
        }
      }
      return result;
    })()`) as any;

    console.log("[BM-Presale] Found " + domInfo.checkboxInputs.length + " checkbox inputs total");
    for (const cb of domInfo.checkboxInputs) {
      console.log("[BM-Presale] CB: id=" + cb.id + " name=" + cb.name + " checked=" + cb.checked + " visible=" + cb.visible + " isConsent=" + cb.isConsent + " text=" + cb.nearbyText.substring(0, 60));
      log("  CB: id=" + cb.id + " checked=" + cb.checked + " consent=" + cb.isConsent + " text=" + cb.nearbyText.substring(0, 50));
    }
    console.log("[BM-Presale] Event row HTML: " + domInfo.eventRowHtml.substring(0, 500));

    const eventCheckboxes = domInfo.checkboxInputs.filter((cb: any) => !cb.isConsent);
    const consentCheckboxes = domInfo.checkboxInputs.filter((cb: any) => cb.isConsent);
    log("  Event checkboxes: " + eventCheckboxes.length + ", Consent checkboxes: " + consentCheckboxes.length);

    if (eventCheckboxes.length > 0) {
      log("🎯 Strategy 1: Click event checkbox inputs directly...");
      for (let i = 0; i < Math.min(3, eventCheckboxes.length); i++) {
        try {
          const cb = eventCheckboxes[i];
          let locator;
          if (cb.id) {
            locator = page.locator('#' + cb.id);
          } else if (cb.name) {
            locator = page.locator('input[type="checkbox"][name="' + cb.name + '"]').nth(i);
          } else {
            const allCbs = page.locator('input[type="checkbox"]');
            const idx = domInfo.checkboxInputs.indexOf(cb);
            locator = allCbs.nth(idx);
          }

          await locator.evaluate((el: any) => {
            el.scrollIntoView({ block: 'center' });
          }).catch(() => {});
          await page.waitForTimeout(300);

          const labelLocator = locator.locator('xpath=ancestor::label');
          const hasLabel = await labelLocator.count().catch(() => 0);
          if (hasLabel > 0) {
            await labelLocator.first().click({ timeout: 3000 });
            log("  ☑ Clicked label for event checkbox " + i);
          } else {
            await locator.click({ force: true, timeout: 3000 });
            log("  ☑ Force-clicked event checkbox " + i);
          }

          await page.waitForTimeout(300);
          const isNowChecked = await locator.isChecked().catch(() => false);
          if (!isNowChecked) {
            log("  ⚠️ Checkbox " + i + " not checked after click, trying dispatchEvent...");
            await locator.evaluate((el: any) => {
              el.checked = true;
              el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.waitForTimeout(200);
            const rechecked = await locator.isChecked().catch(() => false);
            if (!rechecked) {
              log("  ⚠️ Still not checked, trying parent click...");
              const parent = locator.locator('xpath=..');
              await parent.click({ timeout: 3000 }).catch(() => {});
            }
          }
          selectedCount++;
          console.log("[BM-Presale] Clicked event checkbox " + i + " (id=" + cb.id + ")");
          await page.waitForTimeout(500);
        } catch (cbErr: any) {
          log("  ⚠️ Checkbox click error: " + cbErr.message.substring(0, 80));
          console.log("[BM-Presale] Checkbox click error: " + cbErr.message.substring(0, 100));
        }
      }
    }

    if (selectedCount === 0) {
      log("🔍 Strategy 2: Find and click event row containers...");
      const eventCities = ["INGLEWOOD", "VANCOUVER", "CIUDAD DE MÉXICO"];
      for (const city of eventCities) {
        if (selectedCount >= 3) break;
        try {
          const cityEl = page.locator(`text=${city}`).first();
          const isVis = await cityEl.isVisible({ timeout: 2000 }).catch(() => false);
          if (!isVis) continue;

          let clickTarget = cityEl;
          for (let depth = 0; depth < 6; depth++) {
            const parent = clickTarget.locator('xpath=..');
            const hasCb = await parent.locator('input[type="checkbox"]').count().catch(() => 0);
            if (hasCb > 0) {
              const cbInRow = parent.locator('input[type="checkbox"]').first();
              const labelWrap = cbInRow.locator('xpath=ancestor::label');
              const hasLbl = await labelWrap.count().catch(() => 0);
              if (hasLbl > 0) {
                await labelWrap.first().click({ timeout: 3000 });
              } else {
                await cbInRow.click({ force: true, timeout: 3000 });
              }
              selectedCount++;
              log("  ☑ Clicked checkbox in row for " + city + " (depth " + depth + ")");
              console.log("[BM-Presale] Clicked checkbox in row for " + city);
              await page.waitForTimeout(500);
              break;
            }
            clickTarget = parent;
          }
        } catch (rowErr: any) {
          log("  ⚠️ Row search error for " + city + ": " + rowErr.message.substring(0, 80));
        }
      }
    }

    if (selectedCount === 0) {
      log("🔍 Strategy 3: Click all non-consent checkboxes by index...");
      try {
        const allCbs = page.locator('input[type="checkbox"]');
        const total = await allCbs.count();
        log("  Total checkboxes on page: " + total);
        let clicked = 0;
        for (let i = 0; i < total && clicked < 3; i++) {
          const cbText = await allCbs.nth(i).evaluate((el: any) => {
            var p = el;
            for (var d = 0; d < 5; d++) { p = p.parentElement; if (!p) break; }
            return (p ? p.innerText : '').toLowerCase().substring(0, 100);
          }).catch(() => '');
          const isConsent = cbText.includes('consent') || cbText.includes('submitting') || cbText.includes('privacy') || cbText.includes('fan list');
          if (!isConsent) {
            await allCbs.nth(i).click({ force: true, timeout: 3000 });
            clicked++;
            selectedCount++;
            log("  ☑ Clicked checkbox index " + i);
            await page.waitForTimeout(500);
          }
        }
      } catch (idxErr: any) {
        log("  ⚠️ Index click error: " + idxErr.message.substring(0, 80));
      }
    }

    const verifyChecked = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      var results = [];
      for (var i = 0; i < cbs.length; i++) {
        results.push({ idx: i, checked: cbs[i].checked, id: cbs[i].id || '' });
      }
      return results;
    })()`) as any[];
    log("📋 Checkbox states after selection:");
    for (const v of verifyChecked) {
      log("  [" + v.idx + "] " + (v.checked ? "✅" : "❌") + " id=" + v.id);
      console.log("[BM-Presale] Verify CB[" + v.idx + "] checked=" + v.checked + " id=" + v.id);
    }

    log("✅ Attempted " + selectedCount + " event selections");
    console.log("[BM-Presale] Total events attempted: " + selectedCount);
    await page.waitForTimeout(1000);

    log("☑ Checking consent boxes...");
    console.log("[BM-Presale] Checking consent boxes...");
    let consentChecked = 0;

    const consentIds = ["allow_artist_sms", "allow_marketing"];
    for (const consentId of consentIds) {
      try {
        const cb = page.locator('#' + consentId);
        const exists = await cb.count().catch(() => 0);
        if (exists > 0) {
          const alreadyChecked = await cb.isChecked().catch(() => false);
          if (!alreadyChecked) {
            const labelWrap = cb.locator('xpath=ancestor::label');
            const hasLabel = await labelWrap.count().catch(() => 0);
            if (hasLabel > 0) {
              await labelWrap.first().click({ timeout: 3000 });
            } else {
              await cb.click({ force: true, timeout: 3000 });
            }
            await page.waitForTimeout(300);
            const nowChecked = await cb.isChecked().catch(() => false);
            if (!nowChecked) {
              await cb.evaluate((el: any) => {
                el.checked = true;
                el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              });
            }
          }
          consentChecked++;
          log("  ☑ Consent: " + consentId + " checked");
          console.log("[BM-Presale] Consent: " + consentId + " checked");
        } else {
          log("  ⚠️ Consent CB #" + consentId + " not found");
        }
      } catch (consentErr: any) {
        log("  ⚠️ Consent error " + consentId + ": " + consentErr.message.substring(0, 60));
      }
    }

    if (consentChecked === 0) {
      log("  Trying fallback: check all non-event checkboxes...");
      const allCbs2 = page.locator('input[type="checkbox"]');
      const totalCbs2 = await allCbs2.count();
      for (let i = 0; i < totalCbs2; i++) {
        try {
          const cbName = await allCbs2.nth(i).getAttribute('name').catch(() => '');
          if (cbName !== 'markets') {
            const checked = await allCbs2.nth(i).isChecked().catch(() => false);
            if (!checked) {
              await allCbs2.nth(i).click({ force: true, timeout: 3000 });
              consentChecked++;
              log("  ☑ Fallback consent CB " + i + " (name=" + cbName + ")");
            } else {
              consentChecked++;
            }
          }
        } catch {}
      }
    }

    log("✅ " + consentChecked + " consent box(es) checked");
    console.log("[BM-Presale] Consent checked: " + consentChecked);
    await page.waitForTimeout(1000);

    const finalState = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      var r = [];
      for (var i = 0; i < cbs.length; i++) {
        r.push({ idx: i, id: cbs[i].id || '', name: cbs[i].name || '', checked: cbs[i].checked });
      }
      return r;
    })()`) as any[];
    log("📋 Final checkbox states before Sign Up:");
    for (const s of finalState) {
      log("  [" + s.idx + "] " + (s.checked ? "✅" : "❌") + " id=" + s.id + " name=" + s.name);
      console.log("[BM-Presale] Final CB[" + s.idx + "] checked=" + s.checked + " id=" + s.id + " name=" + s.name);
    }

    onStatusUpdate("presale_submitting");
    log("🔘 Clicking Sign Up button...");
    console.log("[BM-Presale] Clicking Sign Up...");

    let submitResult = "not-found";
    try {
      const signUpBtn = page.locator('button:has-text("Sign Up")').first();
      const btnVisible = await signUpBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (btnVisible) {
        const isDisabled = await signUpBtn.isDisabled().catch(() => false);
        log("  Sign Up button found, disabled=" + isDisabled);
        console.log("[BM-Presale] Sign Up button visible, disabled=" + isDisabled);
        await signUpBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        await signUpBtn.click({ timeout: 10000, force: true });
        submitResult = "clicked: Sign Up";
      } else {
        const altBtn = page.locator('button, input[type="submit"]').filter({ hasText: /sign up|signup|register|submit/i }).first();
        const altVisible = await altBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (altVisible) {
          await altBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await altBtn.click({ timeout: 10000, force: true });
          submitResult = "clicked: alt button";
        } else {
          log("  Trying evaluate click fallback...");
          const evalResult = await page.evaluate(`(() => {
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
              if ((btns[i].textContent || '').trim().toLowerCase().includes('sign up')) {
                btns[i].scrollIntoView();
                btns[i].click();
                return 'eval-clicked: ' + btns[i].textContent.trim();
              }
            }
            return 'eval-not-found';
          })()`) as string;
          submitResult = evalResult;
        }
      }
    } catch (btnErr: any) {
      log("  ⚠️ Button click error: " + btnErr.message.substring(0, 80));
      console.log("[BM-Presale] Button error, trying evaluate fallback...");
      try {
        const evalResult = await page.evaluate(`(() => {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').trim().toLowerCase().includes('sign up')) {
              btns[i].scrollIntoView();
              btns[i].click();
              return 'fallback-clicked: ' + btns[i].textContent.trim();
            }
          }
          return 'fallback-not-found';
        })()`) as string;
        submitResult = evalResult;
      } catch {
        submitResult = "error: " + btnErr.message.substring(0, 80);
      }
    }

    log("Submit: " + submitResult);
    console.log("[BM-Presale] Submit result: " + submitResult);

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
