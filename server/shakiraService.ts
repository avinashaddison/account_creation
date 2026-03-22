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

    await page.waitForTimeout(6000);

    const pageTitle = await page.title().catch(() => "");
    console.log("[Shakira] Page title:", pageTitle);

    // Dump all checkboxes for debugging
    const allCheckboxDump = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      return Array.from(cbs).map(cb => {
        var p = cb.closest('label, li, div, tr, section') || cb.parentElement;
        return {
          id: cb.id,
          name: cb.name,
          value: cb.value,
          checked: cb.checked,
          text: p ? (p.innerText || p.textContent || '').trim().substring(0, 120) : ''
        };
      });
    })()`);
    console.log("[Shakira] All checkboxes on page:", JSON.stringify(allCheckboxDump));

    // --- Select ONLY the Sept 26 concert date ---
    log(`📅 Selecting Sept 26 concert date...`);
    const dateResult = await page.evaluate(`(() => {
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var result = { checked26: false, unchecked25: false, unchecked27: false, found: [] };

      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        var parent = cb.closest('label, li, div, tr, section') || cb.parentElement;
        var text = parent ? (parent.innerText || parent.textContent || '').trim() : '';
        var textLower = text.toLowerCase();

        // Skip consent/marketing checkboxes
        var isConsent = textLower.includes('consent') || textLower.includes('marketing')
          || textLower.includes('fan list') || textLower.includes('live nation')
          || textLower.includes('privacy') || textLower.includes('mailing')
          || textLower.includes('sign up') || textLower.includes('terms');
        if (isConsent) continue;

        // Detect which date this checkbox belongs to
        var has26 = /\\b26\\b/.test(text) || text.includes('26\\nSEPT') || text.includes('26 SEPT') || text.includes('26\\nSept');
        var has25 = /\\b25\\b/.test(text) || text.includes('25\\nSEPT') || text.includes('25 SEPT') || text.includes('25\\nSept');
        var has27 = /\\b27\\b/.test(text) || text.includes('27\\nSEPT') || text.includes('27 SEPT') || text.includes('27\\nSept');

        result.found.push({ text: text.substring(0, 80), has25, has26, has27 });

        if (has26) {
          // Check this one
          if (!cb.checked) {
            cb.click();
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
          result.checked26 = true;
        } else if (has25 || has27) {
          // Uncheck these
          if (cb.checked) {
            cb.click();
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (has25) result.unchecked25 = true;
          if (has27) result.unchecked27 = true;
        }
      }
      return result;
    })()`);
    console.log("[Shakira] Date selection result:", JSON.stringify(dateResult));

    if (!(dateResult as any).checked26) {
      log(`⚠️ Could not find Sept 26 checkbox by date text — trying fallback (check second date checkbox)...`);
      console.log("[Shakira] Fallback: checking the second date checkbox");
      const fallbackResult = await page.evaluate(`(() => {
        var checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(cb => {
          var p = cb.closest('label, li, div, tr, section') || cb.parentElement;
          var text = (p ? p.innerText || p.textContent || '' : '').toLowerCase();
          return !text.includes('consent') && !text.includes('marketing') && !text.includes('fan list')
            && !text.includes('live nation') && !text.includes('privacy') && !text.includes('mailing');
        });
        if (checkboxes.length >= 2) {
          // Uncheck all
          checkboxes.forEach(cb => { if (cb.checked) { cb.click(); cb.dispatchEvent(new Event('change', { bubbles: true })); } });
          // Check second (index 1 = Sept 26)
          checkboxes[1].click();
          checkboxes[1].dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, total: checkboxes.length };
        }
        return { success: false, total: checkboxes.length };
      })()`);
      console.log("[Shakira] Fallback date check result:", JSON.stringify(fallbackResult));
      if ((fallbackResult as any).success) {
        log(`✅ Sept 26 selected via fallback (2nd checkbox)`);
      } else {
        log(`⚠️ Could not select date — continuing anyway`);
      }
    } else {
      log(`✅ Sept 26 selected`);
    }

    await page.waitForTimeout(1000);

    // --- Check all 3 consent checkboxes ---
    log(`✅ Checking all consent boxes...`);
    const consentsChecked = await page.evaluate(`(() => {
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var count = 0;
      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        var parent = cb.closest('label, li, div, tr, section') || cb.parentElement;
        var text = (parent ? parent.innerText || parent.textContent || '' : '').toLowerCase();
        var isConsent = text.includes('consent') || text.includes('marketing')
          || text.includes('fan list') || text.includes('live nation')
          || text.includes('privacy') || text.includes('mailing')
          || text.includes('terms');
        if (isConsent) {
          if (!cb.checked) {
            cb.click();
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
          count++;
        }
      }
      return count;
    })()`);
    console.log("[Shakira] Consent boxes checked:", consentsChecked);
    log(`✅ ${consentsChecked} consent box(es) checked`);

    await page.waitForTimeout(1000);

    // Dump final checkbox state for debug
    const finalCheckboxState = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      return Array.from(cbs).map(cb => {
        var p = cb.closest('label, li, div, tr, section') || cb.parentElement;
        return { checked: cb.checked, text: (p ? (p.innerText || '').trim() : '').substring(0, 60) };
      });
    })()`);
    console.log("[Shakira] Final checkbox states:", JSON.stringify(finalCheckboxState));

    // --- Click Sign Up button ---
    log(`🖱️ Clicking Sign Up...`);
    const signUpResult = await page.evaluate(`(() => {
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
      // Fallback: any visible submit input
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

    // Wait for redirect to TM registration/auth page
    log(`⏳ Waiting for redirect to Ticketmaster registration...`);
    let redirected = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000);
      const url = page.url();
      console.log(`[Shakira] URL after wait ${i + 1}: ${url}`);

      // Confirmed on TM auth / registration page
      if (
        url.includes("auth.ticketmaster") ||
        url.includes("identity.ticketmaster") ||
        url.includes("ticketmaster.com/member/") ||
        url.includes("ticketmaster.es/member/") ||
        url.includes("ticketmaster.com/login") ||
        url.includes("ticketmaster.es/login")
      ) {
        log(`🔗 Redirected to TM registration: ${url.substring(0, 80)}`);
        console.log(`[Shakira] FULL redirect URL: ${url}`);
        redirected = true;
        return { success: true, redirectUrl: url };
      }

      // Confirmation page
      if (url.includes("thankyou") || url.includes("thank-you") || url.includes("confirmation") || url.includes("success")) {
        log(`✅ Presale signup confirmed!`);
        redirected = true;
        break;
      }

      // Still on Shakira page — check if the URL changed at all
      if (!url.includes("shakira") && url.includes("ticketmaster")) {
        log(`🔗 Left Shakira page → now at: ${url.substring(0, 80)}`);
        console.log(`[Shakira] FULL redirect URL: ${url}`);
        redirected = true;
        return { success: true, redirectUrl: url };
      }
    }

    if (!redirected) {
      const finalUrl = page.url();
      log(`📍 Still at: ${finalUrl.substring(0, 80)} — TM registration will navigate directly`);
    }

    return { success: true, redirectUrl: undefined };
  } catch (err: any) {
    console.log("[Shakira] Presale step error:", err.message);
    return { success: false, error: err.message };
  }
}
