import { chromium } from "playwright";

async function main() {
  var PROXY = "http://okdpvmze-1:iy0zkuc7dt2s@p.webshare.io:80/";
  var EMAIL = "wildhawk7117@dollicons.com";
  var PASSWORD = "9q5arNZN@wwjs#";

  var browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  
  var parsed = new URL(PROXY);
  var context = await browser.newContext({
    proxy: {
      server: parsed.protocol + "//" + parsed.hostname + ":" + (parsed.port || "80"),
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });

  var page = await context.newPage();
  page.setDefaultTimeout(60000);

  page.on("framenavigated", function(frame) {
    if (frame === page.mainFrame()) {
      console.log("   NAV -> " + frame.url().substring(0, 180));
    }
  });

  console.log("1. Loading login page...");
  await page.goto("https://la28id.la28.org/login/", { waitUntil: "domcontentloaded", timeout: 60000 });
  try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch (e) {}
  await page.waitForTimeout(5000);

  // Use JS to find the exact visible fields and fill them with keyboard events
  console.log("2. Finding and filling login fields...");

  // First, identify which login screen is visible
  var visibleFields = await page.evaluate("(function() { var fields = []; document.querySelectorAll('input').forEach(function(inp, idx) { if (inp.offsetWidth > 0 && inp.offsetHeight > 0) { fields.push({ idx: idx, name: inp.name, type: inp.type, placeholder: inp.placeholder, gigyaName: inp.getAttribute('data-screenset-element-id') || inp.getAttribute('data-gigya-name') || '' }); } }); return fields; })()") as any[];
  console.log("   Visible fields:", JSON.stringify(visibleFields));

  // Use page.locator with nth to target the specific visible email field
  var emailField = page.locator('input[name="username"]').filter({ has: page.locator(':visible') }).first();
  var passField = page.locator('input[type="password"]').filter({ has: page.locator(':visible') }).first();
  
  // Alternative: use evaluate to focus the right field, then use keyboard
  await page.evaluate("(function() { var inputs = document.querySelectorAll('input'); for (var i = 0; i < inputs.length; i++) { if (inputs[i].name === 'username' && inputs[i].type === 'text' && inputs[i].offsetWidth > 0 && inputs[i].offsetHeight > 0) { inputs[i].focus(); inputs[i].click(); return i; } } return -1; })()");
  await page.waitForTimeout(300);
  await page.keyboard.type(EMAIL, { delay: 20 });
  console.log("   Email typed");

  // Tab to password or click it
  await page.evaluate("(function() { var inputs = document.querySelectorAll('input'); for (var i = 0; i < inputs.length; i++) { if (inputs[i].type === 'password' && inputs[i].offsetWidth > 0 && inputs[i].offsetHeight > 0) { inputs[i].focus(); inputs[i].click(); return i; } } return -1; })()");
  await page.waitForTimeout(300);
  await page.keyboard.type(PASSWORD, { delay: 20 });
  console.log("   Password typed");

  await page.waitForTimeout(500);

  // Click submit
  await page.evaluate("(function() { var btns = document.querySelectorAll('.gigya-input-submit, input[type=submit]'); for (var i = 0; i < btns.length; i++) { if (btns[i].offsetWidth > 0 && btns[i].offsetHeight > 0) { btns[i].click(); return true; } } return false; })()");
  console.log("   Submit clicked!");

  // Wait for redirect
  console.log("3. Waiting for redirect...");
  try {
    await page.waitForURL(function(url) { return !url.href.includes("/login"); }, { timeout: 30000 });
    console.log("   Redirected to:", page.url());
  } catch (e) {
    console.log("   Still on:", page.url());
    var pageText = await page.evaluate("document.body ? document.body.innerText.substring(0, 500) : ''") as string;
    console.log("   Page:", (pageText as string).substring(0, 300));
    await browser.close();
    return;
  }

  await page.waitForTimeout(8000);
  console.log("   Settled:", page.url());

  // Consent page
  if (page.url().includes("consent.html")) {
    console.log("4. ON CONSENT PAGE!");
    await page.waitForTimeout(3000);
    
    var ct = await page.evaluate("document.body ? document.body.innerText.substring(0, 800) : ''") as string;
    console.log("   Text:", (ct as string).substring(0, 500));

    var els = await page.evaluate("(function() { var r=[]; document.querySelectorAll('button, input[type=submit], input[type=button], input[type=checkbox], .gigya-input-submit').forEach(function(el){ if(el.offsetWidth>0 && el.offsetHeight>0) r.push({tag:el.tagName,type:el.type||'',text:(el.innerText||el.value||'').trim().substring(0,50),name:el.name||''}); }); return r; })()") as any[];
    console.log("   Interactive:", JSON.stringify(els));

    // Check all checkboxes
    await page.evaluate("document.querySelectorAll('input[type=checkbox]').forEach(function(c){ if(!c.checked && c.offsetWidth>0) c.click(); })");
    
    // Accept via SDK
    var cr = await page.evaluate("new Promise(function(resolve){ gigya.accounts.setAccountInfo({ preferences:{ privacy:{LA2028privacyPolicy:{isConsentGranted:true}}, terms:{LA2028siteTerms:{isConsentGranted:true}}, confirmationAge:{isConsentGranted:true} }, callback:function(r){resolve({ec:r.errorCode})} }); setTimeout(function(){resolve({ec:-99})},10000); })") as any;
    console.log("   Consent:", JSON.stringify(cr));

    // Click submit
    await page.evaluate("(function(){ var btns=document.querySelectorAll('.gigya-input-submit,input[type=submit],button'); for(var i=0;i<btns.length;i++){ if(btns[i].offsetWidth>0 && btns[i].offsetHeight>0){btns[i].click();return;}} })()");

    console.log("5. Waiting for post-consent redirect...");
    try {
      await page.waitForURL(function(url) { return !url.href.includes("consent.html"); }, { timeout: 30000 });
      console.log("   REDIRECTED:", page.url());
    } catch (e) {
      console.log("   Stayed:", page.url());
    }

    await page.waitForTimeout(10000);
    console.log("   FINAL:", page.url());
    var ft = await page.evaluate("document.body ? document.body.innerText.substring(0,1500) : ''") as string;
    console.log("   Text:", (ft as string).substring(0, 800));

    if (page.url().includes("tickets.la28.org")) {
      console.log("\n=== REACHED TICKETS PORTAL ===");
      try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch(e){}
      await page.waitForTimeout(5000);
      var fi = await page.evaluate("(function(){ var s=[]; document.querySelectorAll('select').forEach(function(sel){ s.push({name:sel.name,optCount:sel.options.length}); }); var b=[]; document.querySelectorAll('button').forEach(function(bt){ if(bt.offsetWidth>0) b.push({text:(bt.innerText||'').trim().substring(0,30)}); }); return {selects:s,buttons:b}; })()") as any;
      console.log("   Selects:", JSON.stringify(fi.selects));
      console.log("   Buttons:", JSON.stringify(fi.buttons));
    }
  }

  await browser.close();
  console.log("\nDone!");
}

main().catch(function(e) { console.error(e); process.exit(1); });
