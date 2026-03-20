import type { Page } from "playwright-extra";

const SHAKIRA_PRESALE_URL = "https://signup.ticketmaster.es/shakira";

export async function doShakiraPresaleStep(
  page: Page,
  log: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    log(`🎤 Navigating to Shakira presale signup...`);
    console.log("[Shakira] Navigating to presale page...");

    try {
      await page.goto(SHAKIRA_PRESALE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (navErr: any) {
      console.log("[Shakira] Navigation error:", navErr.message?.substring(0, 150));
      throw new Error(`Could not load Shakira presale page: ${navErr.message?.substring(0, 100)}`);
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: 20000 });
    } catch {
      console.log("[Shakira] Network idle timeout, continuing...");
    }

    await page.waitForTimeout(2000);

    const pageTitle = await page.title().catch(() => "");
    console.log("[Shakira] Page title:", pageTitle);

    // --- Select concert date(s) ---
    log(`📅 Selecting concert date(s)...`);
    const datesChecked = await page.evaluate(`(() => {
      // Look for concert date checkboxes — they're typically input[type="checkbox"] near date elements
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var dateBoxes = [];
      var consentBoxes = [];

      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        // Try to identify if this is a date checkbox or consent checkbox by surrounding text
        var parent = cb.closest('label, li, div, tr') || cb.parentElement;
        var text = parent ? (parent.innerText || parent.textContent || '').toLowerCase() : '';
        var isConsent = text.includes('consent') || text.includes('marketing') || text.includes('fan list')
          || text.includes('live nation') || text.includes('privacy') || text.includes('mailing');
        if (isConsent) {
          consentBoxes.push(cb);
        } else {
          dateBoxes.push(cb);
        }
      }

      // Check all date boxes (select all concert dates)
      var dateResult = [];
      for (var j = 0; j < dateBoxes.length; j++) {
        if (!dateBoxes[j].checked) {
          dateBoxes[j].click();
          dateBoxes[j].dispatchEvent(new Event('change', { bubbles: true }));
        }
        var parent2 = dateBoxes[j].closest('label, li, div, tr') || dateBoxes[j].parentElement;
        var text2 = parent2 ? (parent2.innerText || '').trim().substring(0, 60) : 'date';
        dateResult.push(text2);
      }
      return { dateCount: dateBoxes.length, consentCount: consentBoxes.length, dates: dateResult };
    })()`);
    console.log("[Shakira] Date selection result:", JSON.stringify(datesChecked));

    if ((datesChecked as any).dateCount === 0) {
      log(`⚠️ No date checkboxes found — page may have loaded differently, continuing...`);
    } else {
      log(`✅ Selected ${(datesChecked as any).dateCount} concert date(s)`);
    }

    await page.waitForTimeout(1000);

    // --- Check all consent checkboxes ---
    log(`✅ Checking consent boxes...`);
    const consentsChecked = await page.evaluate(`(() => {
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var count = 0;
      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        var parent = cb.closest('label, li, div, tr') || cb.parentElement;
        var text = parent ? (parent.innerText || parent.textContent || '').toLowerCase() : '';
        var isConsent = text.includes('consent') || text.includes('marketing') || text.includes('fan list')
          || text.includes('live nation') || text.includes('privacy') || text.includes('mailing')
          || text.includes('sign up') || text.includes('terms');
        if (isConsent && !cb.checked) {
          cb.click();
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          count++;
        } else if (isConsent) {
          count++;
        }
      }
      return count;
    })()`);
    console.log("[Shakira] Consent boxes checked:", consentsChecked);
    log(`✅ Consent boxes: ${consentsChecked}`);

    await page.waitForTimeout(1000);

    // Dump all checkboxes for debugging
    const allCheckboxState = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      return Array.from(cbs).map(cb => {
        var p = cb.closest('label, li, div, p') || cb.parentElement;
        return { checked: cb.checked, id: cb.id, name: cb.name, text: p ? (p.innerText||'').substring(0,60) : '' };
      });
    })()`);
    console.log("[Shakira] All checkbox states:", JSON.stringify(allCheckboxState).substring(0, 1000));

    // --- Click Sign Up button ---
    log(`🖱️ Clicking Sign Up...`);
    const signUpResult = await page.evaluate(`(() => {
      // Look for Sign Up button
      var buttons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          var text = (btn.innerText || btn.textContent || btn.value || '').trim().toLowerCase();
          if (text.includes('sign up') || text.includes('signup') || text === 'submit' || text.includes('register')) {
            btn.click();
            return 'clicked:' + text.substring(0, 40);
          }
        }
      }
      // Fallback: find by value
      var inputs = document.querySelectorAll('input[type="submit"], input[type="button"]');
      for (var j = 0; j < inputs.length; j++) {
        var rect2 = inputs[j].getBoundingClientRect();
        if (rect2.width > 0 && rect2.height > 0) {
          inputs[j].click();
          return 'input-submit:' + (inputs[j].value || '').substring(0, 40);
        }
      }
      return 'not-found';
    })()`);
    console.log("[Shakira] Sign Up click result:", signUpResult);

    if (signUpResult === 'not-found') {
      log(`⚠️ Sign Up button not found — dumping page state...`);
      const bodyText = await page.evaluate(`document.body?.innerText?.substring(0, 500) || ''`);
      console.log("[Shakira] Page body (first 500):", bodyText);
    } else {
      log(`✅ Clicked: ${signUpResult}`);
    }

    // Wait for redirect to TM account page
    log(`⏳ Waiting for redirect to Ticketmaster...`);
    let redirected = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2000);
      const url = page.url();
      console.log(`[Shakira] URL after wait ${i + 1}: ${url}`);
      if (url.includes("ticketmaster") || url.includes("auth.") || url.includes("account") || url.includes("signup") && !url.includes("shakira")) {
        log(`🔗 Redirected to: ${url.substring(0, 80)}`);
        redirected = true;
        break;
      }
      if (url.includes("thankyou") || url.includes("thank-you") || url.includes("confirmation") || url.includes("success")) {
        log(`✅ Presale signup confirmed!`);
        redirected = true;
        break;
      }
    }

    if (!redirected) {
      const finalUrl = page.url();
      log(`📍 Still at: ${finalUrl.substring(0, 80)} — continuing with TM registration...`);
    }

    return { success: true };
  } catch (err: any) {
    console.log("[Shakira] Presale step error:", err.message);
    return { success: false, error: err.message };
  }
}
