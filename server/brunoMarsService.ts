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
    log("🎵 Selecting events (up to 3) using Playwright clicks...");
    console.log("[BM-Presale] Starting event selection...");

    const eventTexts = ["INGLEWOOD", "VANCOUVER", "CIUDAD DE MÉXICO"];
    let selectedCount = 0;

    for (const eventCity of eventTexts) {
      if (selectedCount >= 3) break;
      try {
        const locator = page.locator(`text=${eventCity}`).first();
        const isVisible = await locator.isVisible({ timeout: 3000 }).catch(() => false);
        if (isVisible) {
          await locator.click({ timeout: 5000 });
          selectedCount++;
          log("  ☑ Clicked: " + eventCity);
          console.log("[BM-Presale] Clicked event: " + eventCity);
          await page.waitForTimeout(500);
        } else {
          log("  ⚠️ Not visible: " + eventCity);
          console.log("[BM-Presale] Not visible: " + eventCity);
        }
      } catch (clickErr: any) {
        log("  ⚠️ Could not click " + eventCity + ": " + clickErr.message.substring(0, 80));
        console.log("[BM-Presale] Click error for " + eventCity + ": " + clickErr.message.substring(0, 100));
      }
    }

    if (selectedCount === 0) {
      log("🔍 Text-based click failed, trying alternative selectors...");
      console.log("[BM-Presale] Text click failed, dumping page structure...");

      const domDump = await page.evaluate(`(() => {
        var selectHeader = null;
        var allEls = document.querySelectorAll('h1, h2, h3, h4, h5');
        for (var i = 0; i < allEls.length; i++) {
          if ((allEls[i].textContent || '').toLowerCase().includes('select your events')) {
            selectHeader = allEls[i];
            break;
          }
        }
        var container = selectHeader ? selectHeader.parentElement : document.body;
        var children = container ? container.children : [];
        var dump = [];
        for (var j = 0; j < children.length && j < 20; j++) {
          dump.push({
            tag: children[j].tagName,
            classes: (children[j].className || '').toString().substring(0, 150),
            role: children[j].getAttribute('role') || '',
            ariaChecked: children[j].getAttribute('aria-checked') || '',
            childCount: children[j].querySelectorAll('*').length,
            text: (children[j].innerText || '').replace(/\\n/g, ' ').substring(0, 120),
            outerHtml: children[j].outerHTML.substring(0, 300)
          });
        }
        var allCheckboxLike = document.querySelectorAll('[role="checkbox"], [role="option"], [role="listitem"], [role="button"]');
        var cbDump = [];
        for (var k = 0; k < allCheckboxLike.length && k < 20; k++) {
          cbDump.push({
            tag: allCheckboxLike[k].tagName,
            role: allCheckboxLike[k].getAttribute('role'),
            ariaChecked: allCheckboxLike[k].getAttribute('aria-checked'),
            classes: (allCheckboxLike[k].className || '').toString().substring(0, 100),
            text: (allCheckboxLike[k].innerText || '').replace(/\\n/g, ' ').substring(0, 80)
          });
        }
        return { containerChildren: dump, ariaElements: cbDump, containerTag: container ? container.tagName : 'none' };
      })()`) as any;

      console.log("[BM-Presale] Container tag:", domDump.containerTag);
      for (const child of (domDump.containerChildren || [])) {
        console.log("[BM-Presale] Child:", child.tag, "role:", child.role, "aria-checked:", child.ariaChecked, "classes:", child.classes?.substring(0, 60), "text:", child.text?.substring(0, 60));
        log("  DOM: <" + child.tag + "> role=" + child.role + " classes=" + (child.classes || '').substring(0, 40) + " text=" + (child.text || '').substring(0, 50));
      }
      for (const ae of (domDump.ariaElements || [])) {
        console.log("[BM-Presale] ARIA:", ae.tag, "role:", ae.role, "aria-checked:", ae.ariaChecked, "text:", ae.text?.substring(0, 60));
      }

      try {
        const allClickable = page.locator('[role="checkbox"], [role="option"], [role="listitem"]');
        const count = await allClickable.count();
        log("  Found " + count + " ARIA clickable elements");
        for (let i = 0; i < Math.min(count, 3); i++) {
          await allClickable.nth(i).click({ timeout: 3000 });
          selectedCount++;
          const itemText = await allClickable.nth(i).innerText().catch(() => "unknown");
          log("  ☑ Clicked ARIA element " + i + ": " + itemText.replace(/\n/g, ' ').substring(0, 60));
          await page.waitForTimeout(500);
        }
      } catch (ariaErr: any) {
        log("  ⚠️ ARIA click failed: " + ariaErr.message.substring(0, 80));
      }
    }

    if (selectedCount === 0) {
      log("🔍 Trying to click event rows by visible structure...");
      try {
        const rows = page.locator('div:has(> div), li, article').filter({ hasText: /INGLEWOOD|VANCOUVER|CIUDAD/ });
        const rowCount = await rows.count();
        log("  Found " + rowCount + " matching rows");
        for (let i = 0; i < Math.min(rowCount, 3); i++) {
          await rows.nth(i).click({ timeout: 3000, force: true });
          selectedCount++;
          log("  ☑ Force-clicked row " + i);
          await page.waitForTimeout(500);
        }
      } catch (rowErr: any) {
        log("  ⚠️ Row click failed: " + rowErr.message.substring(0, 80));
      }
    }

    log("✅ Selected " + selectedCount + " events");
    console.log("[BM-Presale] Total events selected: " + selectedCount);
    await page.waitForTimeout(1000);

    log("☑ Checking consent boxes...");
    console.log("[BM-Presale] Checking consent boxes...");
    let consentChecked = 0;

    const consentTexts = [
      "submitting my mobile phone",
      "submitting my email address",
      "consent to receive",
      "consent to joining",
      "fan list"
    ];

    for (const consentText of consentTexts) {
      try {
        const consentLocator = page.locator(`text=${consentText}`).first();
        const isVis = await consentLocator.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVis) {
          await consentLocator.click({ timeout: 3000 });
          consentChecked++;
          log("  ☑ Consent: " + consentText.substring(0, 40));
          console.log("[BM-Presale] Clicked consent: " + consentText);
          await page.waitForTimeout(300);
        }
      } catch {
        // try next
      }
    }

    if (consentChecked === 0) {
      log("  Trying checkbox inputs for consent...");
      const cbCount = await page.evaluate(`(() => {
        var checked = 0;
        var checkboxes = document.querySelectorAll('input[type="checkbox"]');
        for (var i = 0; i < checkboxes.length; i++) {
          var label = checkboxes[i].closest('label') || checkboxes[i].closest('div') || checkboxes[i].parentElement;
          var text = (label ? label.innerText : '').toLowerCase();
          if (text.includes('consent') || text.includes('privacy') || text.includes('submitting') || text.includes('email address') || text.includes('mobile phone') || text.includes('fan list')) {
            if (!checkboxes[i].checked) {
              checkboxes[i].click();
              checkboxes[i].checked = true;
              checkboxes[i].dispatchEvent(new Event('change', { bubbles: true }));
              checkboxes[i].dispatchEvent(new Event('input', { bubbles: true }));
              checked++;
            } else {
              checked++;
            }
          }
        }
        return checked;
      })()`) as number;
      consentChecked = cbCount;
    }

    log("✅ " + consentChecked + " consent box(es) checked");
    console.log("[BM-Presale] Consent checked: " + consentChecked);
    await page.waitForTimeout(1000);

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
        await signUpBtn.click({ timeout: 5000 });
        submitResult = "clicked: Sign Up";
      } else {
        const altBtn = page.locator('button, input[type="submit"]').filter({ hasText: /sign up|signup|register|submit/i }).first();
        const altVisible = await altBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (altVisible) {
          await altBtn.click({ timeout: 5000 });
          submitResult = "clicked: alt button";
        }
      }
    } catch (btnErr: any) {
      log("  ⚠️ Button click error: " + btnErr.message.substring(0, 80));
      submitResult = "error: " + btnErr.message.substring(0, 80);
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
