import type { Page, Browser } from "playwright-core";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const PRESALE_URL = "https://signup.ticketmaster.ca/brunomars";

const TARGET_EVENTS = [
  { date: "30", month: "SEP", city: "INGLEWOOD" },
  { date: "03", month: "DEC", city: "CIUDAD" },
  { date: "08", month: "DEC", city: "CIUDAD" },
];

export async function brunoMarsPresaleStep(
  page: Page,
  browser: Browser | null,
  log: (msg: string) => void,
  onStatusUpdate: (status: string) => void,
  proxyUrl?: string,
  tmCredentials?: { email: string; password: string }
): Promise<{ success: boolean; error?: string }> {
  let ownBrowser: Browser | null = null;

  try {
    if (!page || !browser) {
      log("Opening new browser for presale (no active session)...");
      ownBrowser = await chromium.connectOverCDP(proxyUrl!, { timeout: 60000 });
      const ctx = ownBrowser.contexts()[0];
      page = ctx ? (ctx.pages()[0] || await ctx.newPage()) : await ownBrowser.newPage();
    } else {
      try {
        await page.evaluate("1+1");
        log("Reusing authenticated TM browser session");
      } catch {
        log("TM session expired, opening new browser...");
        browser = null;
        ownBrowser = await chromium.connectOverCDP(proxyUrl!, { timeout: 60000 });
        const ctx = ownBrowser.contexts()[0];
        page = ctx ? (ctx.pages()[0] || await ctx.newPage()) : await ownBrowser.newPage();
      }
    }

    onStatusUpdate("presale_loading");
    log("Navigating to Bruno Mars presale page...");

    await page.route("**/*contentsquare*", (route) => route.abort()).catch(() => {});
    await page.route("**/*cs-sdk*", (route) => route.abort()).catch(() => {});

    await page.goto(PRESALE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

    for (let w = 0; w < 30; w++) {
      await page.waitForTimeout(2000);
      const text = await page.evaluate(() => (document.body?.innerText || "").substring(0, 1000).toLowerCase());
      if (text.includes("select your events") || text.includes("sign up") || text.includes("inglewood") || text.includes("vancouver") || text.includes("ciudad") || text.includes("sélectionnez")) {
        log("Presale page loaded!");
        break;
      }
      if (text.includes("you're all set") || text.includes("your selections") || text.includes("edit selections")) {
        log("Already signed up! Success page detected.");
        onStatusUpdate("completed");
        return { success: true };
      }
      if (w % 5 === 4) log("Waiting for page to load... (" + (w * 2) + "s)");
      if (w >= 29) {
        const url = page.url();
        log("Page may not have fully loaded. URL: " + url.substring(0, 100));
      }
    }

    await page.evaluate(`(() => {
      var selectors = ['[id*="onetrust"]', '[class*="onetrust"]', '[id*="cookie"]', '[class*="cookie"]', '[class*="consent-banner"]'];
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) { els[j].remove(); }
      }
    })()`);

    await page.waitForTimeout(1000);

    onStatusUpdate("presale_events");
    log("Selecting target events (30 SEP, 03 DEC, 08 DEC)...");

    const eventInfo = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"][name="markets"]');
      var events = [];
      for (var i = 0; i < cbs.length; i++) {
        var row = cbs[i];
        for (var d = 0; d < 10; d++) {
          if (!row.parentElement) break;
          row = row.parentElement;
          if (row.textContent && row.textContent.length > 30) break;
        }
        events.push({
          index: i,
          text: (row.textContent || '').replace(/\\s+/g, ' ').substring(0, 200),
          checked: cbs[i].checked
        });
      }
      var consent = [];
      var allCbs = document.querySelectorAll('input[type="checkbox"]');
      for (var j = 0; j < allCbs.length; j++) {
        if (allCbs[j].name !== 'markets') {
          consent.push({ index: j, id: allCbs[j].id, checked: allCbs[j].checked });
        }
      }
      var btns = document.querySelectorAll('button');
      var btnTexts = [];
      for (var k = 0; k < btns.length; k++) {
        btnTexts.push((btns[k].textContent || '').trim().substring(0, 80));
      }
      return { events: events, consent: consent, buttons: btnTexts, totalCheckboxes: allCbs.length };
    })()`) as any;

    log("Found " + eventInfo.events.length + " event checkboxes, " + eventInfo.consent.length + " consent checkboxes");
    log("Buttons on page: " + JSON.stringify(eventInfo.buttons));
    for (const ev of eventInfo.events) {
      log("  Event[" + ev.index + "]: " + ev.text.substring(0, 80) + " checked=" + ev.checked);
    }

    let selectedCount = 0;
    const targetIndices: number[] = [];

    for (const target of TARGET_EVENTS) {
      for (const ev of eventInfo.events) {
        const t = ev.text.toUpperCase();
        if (t.includes(target.date) && (t.includes(target.city) || t.includes(target.month)) && !targetIndices.includes(ev.index)) {
          targetIndices.push(ev.index);
          break;
        }
      }
    }

    if (targetIndices.length < 3) {
      log("Could not find all 3 target events by text. Falling back to indices 0, 2, 5 (30 SEP, 03 DEC, 08 DEC)");
      if (eventInfo.events.length >= 6) {
        targetIndices.length = 0;
        targetIndices.push(0, 2, 5);
      } else if (eventInfo.events.length >= 3) {
        targetIndices.length = 0;
        targetIndices.push(0, 1, 2);
      }
    }

    log("Target event indices: " + JSON.stringify(targetIndices));

    for (const idx of targetIndices) {
      try {
        const cb = page.locator('input[type="checkbox"][name="markets"]').nth(idx);
        const exists = await cb.count().catch(() => 0);
        if (exists === 0) {
          log("  Event checkbox index " + idx + " not found, skipping");
          continue;
        }

        await cb.evaluate((el: any) => {
          el.scrollIntoView({ block: 'center' });
        }).catch(() => {});
        await page.waitForTimeout(300);

        const labelLocator = cb.locator('xpath=ancestor::label');
        const hasLabel = await labelLocator.count().catch(() => 0);
        if (hasLabel > 0) {
          await labelLocator.first().click({ timeout: 5000 });
          log("  Clicked label for event " + idx);
        } else {
          await cb.click({ force: true, timeout: 5000 });
          log("  Force-clicked event " + idx);
        }

        await page.waitForTimeout(500);
        const isChecked = await cb.isChecked().catch(() => false);
        if (!isChecked) {
          log("  Event " + idx + " not checked, trying evaluate...");
          await cb.evaluate((el: any) => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
        }
        selectedCount++;
      } catch (err: any) {
        log("  Error clicking event " + idx + ": " + err.message.substring(0, 80));
      }
    }

    log("Selected " + selectedCount + " events");
    await page.waitForTimeout(500);

    log("Checking consent boxes...");
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
                el.dispatchEvent(new Event('change', { bubbles: true }));
              });
            }
          }
          log("  Consent: " + consentId + " checked");
        }
      } catch (err: any) {
        log("  Consent error " + consentId + ": " + err.message.substring(0, 60));
      }
    }

    await page.waitForTimeout(500);

    const finalState = await page.evaluate(`(() => {
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      var r = [];
      for (var i = 0; i < cbs.length; i++) {
        r.push({ idx: i, id: cbs[i].id || '', name: cbs[i].name || '', checked: cbs[i].checked });
      }
      return r;
    })()`) as any[];
    log("Final checkbox states:");
    for (const s of finalState) {
      log("  [" + s.idx + "] " + (s.checked ? "YES" : "NO") + " id=" + s.id + " name=" + s.name);
    }

    onStatusUpdate("presale_submitting");
    log("Clicking Sign Up button...");

    let submitResult = "not-found";

    try {
      const clicked = await page.evaluate(`(() => {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          var text = (btns[i].textContent || '').trim().toLowerCase();
          if (text === 'sign up' || text === "s'inscrire" || text === 'inscription' || text === 'submit') {
            btns[i].scrollIntoView({ block: 'center' });
            btns[i].click();
            return 'clicked: ' + (btns[i].textContent || '').trim();
          }
        }
        for (var j = 0; j < btns.length; j++) {
          var text2 = (btns[j].textContent || '').trim().toLowerCase();
          if (text2.includes('sign up') || text2.includes("s'inscrire") || text2.includes('inscription')) {
            btns[j].scrollIntoView({ block: 'center' });
            btns[j].click();
            return 'clicked: ' + (btns[j].textContent || '').trim();
          }
        }
        var inputs = document.querySelectorAll('input[type="submit"]');
        if (inputs.length > 0) {
          inputs[0].scrollIntoView({ block: 'center' });
          inputs[0].click();
          return 'clicked-input: ' + (inputs[0].value || '');
        }
        return 'not-found (buttons: ' + btns.length + ')';
      })()`) as string;
      submitResult = clicked;
    } catch (err: any) {
      log("Evaluate click failed: " + err.message.substring(0, 80));
      try {
        const signUpBtn = page.locator('button:has-text("Sign Up")').first();
        await signUpBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await signUpBtn.click({ timeout: 10000, force: true });
        submitResult = "pw-clicked: Sign Up";
      } catch {
        submitResult = "failed: " + err.message.substring(0, 80);
      }
    }

    log("Submit result: " + submitResult);

    if (!submitResult.startsWith("clicked") && !submitResult.startsWith("pw-clicked")) {
      log("Could not find Sign Up button. " + submitResult);
      return { success: false, error: "Sign Up button not found: " + submitResult };
    }

    log("Waiting for response after Sign Up...");
    await page.waitForTimeout(3000);

    for (let checkRound = 0; checkRound < 10; checkRound++) {
      const currentUrl = page.url();
      const fullText = await page.evaluate(() => (document.body?.innerText || "")).catch(() => "");
      const fullLower = fullText.toLowerCase();

      log("Check " + (checkRound + 1) + "/10 — URL: " + currentUrl.substring(0, 80));

      if (fullLower.includes("you're all set") || fullLower.includes("your selections") || fullLower.includes("edit selections")) {
        onStatusUpdate("completed");
        log("SUCCESS! 'YOU'RE ALL SET' / 'YOUR SELECTIONS' page detected!");
        return { success: true };
      }

      if (fullLower.includes("vos sélections") || fullLower.includes("modifier les sélections") || fullLower.includes("vous êtes inscrit")) {
        onStatusUpdate("completed");
        log("SUCCESS! French confirmation page detected!");
        return { success: true };
      }

      if (fullLower.includes("thank") || fullLower.includes("success") || fullLower.includes("confirmed") || fullLower.includes("merci") || fullLower.includes("confirmé")) {
        onStatusUpdate("completed");
        log("SUCCESS! Confirmation detected!");
        return { success: true };
      }

      if (currentUrl.includes("auth.ticketmaster") || fullLower.includes("sign in or create account") || fullLower.includes("connexion")) {
        log("Login page detected after Sign Up click. Attempting to log in...");

        if (!tmCredentials) {
          log("No TM credentials provided, cannot log in.");
          return { success: false, error: "Login required but no credentials available." };
        }

        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(5000);
          const loginPageText = await page.evaluate(() => (document.body?.innerText || "").substring(0, 500));
          log("Login page content: " + loginPageText.substring(0, 200).replace(/\n/g, ' '));

          const loginInputs = await page.evaluate(`(() => {
            var inputs = document.querySelectorAll('input');
            var r = [];
            for (var i = 0; i < inputs.length; i++) {
              if (inputs[i].offsetParent !== null || inputs[i].offsetWidth > 0) {
                r.push({ type: inputs[i].type, id: inputs[i].id, name: inputs[i].name, placeholder: inputs[i].placeholder });
              }
            }
            return r;
          })()`) as any[];
          log("Login visible inputs: " + JSON.stringify(loginInputs));

          const escapedEmail = tmCredentials.email.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const emailFilled = await page.evaluate(`(() => {
            var el = document.querySelector('#email-input') || document.querySelector('input[type="email"]') || document.querySelector('input[name="email"]');
            if (!el) return false;
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, '${escapedEmail}');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          })()`);
          log("Email filled via evaluate: " + emailFilled);
          if (!emailFilled) {
            log("Could not find email input on login page");
            return { success: false, error: "Login failed: email input not found on auth page" };
          }

          const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Continuer"), button:has-text("Sign In")').first();
          await continueBtn.click({ timeout: 5000 });
          log("Clicked Continue/Sign In on login page");
          await page.waitForTimeout(5000);

          const afterContinue = await page.evaluate(() => (document.body?.innerText || "").substring(0, 500).toLowerCase());
          if (afterContinue.includes("password") || afterContinue.includes("mot de passe")) {
            log("Password field appeared, filling...");
            const pwInput = page.locator('#password-input, input[type="password"]').first();
            await pwInput.waitFor({ state: 'visible', timeout: 5000 });

            const escapedPw = tmCredentials.password.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            await page.evaluate(`(() => {
              var el = document.querySelector('#password-input') || document.querySelector('input[type="password"]');
              if (!el) return;
              var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(el, '${escapedPw}');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            })()`);
            log("Password filled via evaluate setter");

            const signInBtn = page.locator('button:has-text("Sign In"), button:has-text("Se connecter"), button[type="submit"]').first();
            await signInBtn.click({ timeout: 5000 });
            log("Clicked Sign In");
            await page.waitForTimeout(5000);

            const afterLogin = await page.evaluate(() => (document.body?.innerText || "").substring(0, 500).toLowerCase());
            log("After login: " + afterLogin.substring(0, 200));

            if (afterLogin.includes("you're all set") || afterLogin.includes("your selections") || afterLogin.includes("edit selections")) {
              onStatusUpdate("completed");
              log("SUCCESS! Logged in and presale confirmed!");
              return { success: true };
            }

            if (afterLogin.includes("select your events") || afterLogin.includes("sign up") || afterLogin.includes("inglewood")) {
              log("Redirected back to presale form after login. Re-running selection...");
              return await brunoMarsPresaleStep(page, browser, log, onStatusUpdate, proxyUrl, tmCredentials);
            }

            log("After login page: " + afterLogin.substring(0, 300));
          } else if (afterContinue.includes("sign up") || afterContinue.includes("first name")) {
            log("TM showing registration form - email not recognized as existing account");
            return { success: false, error: "Login failed - TM doesn't recognize this email as existing account" };
          }
        } catch (loginErr: any) {
          log("Login error: " + loginErr.message.substring(0, 100));
          return { success: false, error: "Login failed: " + loginErr.message.substring(0, 100) };
        }
      }

      if (fullLower.includes("error") && (fullLower.includes("try again") || fullLower.includes("something went wrong"))) {
        log("Error on page: " + fullText.substring(0, 200).replace(/\n/g, ' '));
        return { success: false, error: "Presale form returned an error" };
      }

      if (fullLower.includes("select your events") || fullLower.includes("sign up")) {
        log("Still on the selection page, waiting...");
      }

      await page.waitForTimeout(2000);
    }

    const finalText = await page.evaluate(() => (document.body?.innerText || "").substring(0, 500)).catch(() => "");
    log("No clear confirmation after 10 checks. Final page: " + finalText.substring(0, 300).replace(/\n/g, ' '));
    return { success: false, error: "No confirmation detected: " + finalText.substring(0, 150).replace(/\n/g, ' ') };
  } catch (err: any) {
    log("Presale error: " + err.message.substring(0, 200));
    return { success: false, error: err.message };
  } finally {
    try {
      if (ownBrowser) await ownBrowser.close();
      else if (browser) await browser.close();
    } catch {}
  }
}
