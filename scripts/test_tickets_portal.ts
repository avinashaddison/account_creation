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

  // Try going directly to tickets portal - let the SSO chain handle login
  console.log("1. Going directly to tickets.la28.org...");
  try {
    var resp = await page.goto("https://tickets.la28.org/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    console.log("   Status:", resp?.status());
    console.log("   URL:", page.url());
    await page.waitForTimeout(5000);
    console.log("   URL after wait:", page.url());
    var text = await page.evaluate("document.body ? document.body.innerText.substring(0, 500) : ''") as string;
    console.log("   Text:", text.substring(0, 300));
  } catch (e: any) {
    console.log("   Error:", e.message.substring(0, 300));
  }

  // Try the tickets login URL that triggers SSO 
  console.log("\n2. Trying tickets.la28.org login flow...");
  try {
    var resp2 = await page.goto("https://tickets.la28.org/en-us/customer/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    console.log("   Status:", resp2?.status());
    console.log("   URL:", page.url());
    try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch (e) {}
    await page.waitForTimeout(5000);
    console.log("   Final URL:", page.url());
    var text2 = await page.evaluate("document.body ? document.body.innerText.substring(0, 1000) : ''") as string;
    console.log("   Text:", text2.substring(0, 500));
  } catch (e: any) {
    console.log("   Error:", e.message.substring(0, 300));
  }

  // Try with the direct mycustomerdata path 
  console.log("\n3. Trying direct mycustomerdata...");
  try {
    var resp3 = await page.goto("https://tickets.la28.org/mycustomerdata/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    console.log("   Status:", resp3?.status());
    console.log("   URL:", page.url());
    try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch (e) {}
    await page.waitForTimeout(8000);
    console.log("   Final URL:", page.url());
    var text3 = await page.evaluate("document.body ? document.body.innerText.substring(0, 1500) : ''") as string;
    console.log("   Text:", text3.substring(0, 800));
    
    var formInfo = await page.evaluate(`(function() {
      var selects = [];
      document.querySelectorAll('select').forEach(function(s) {
        var opts = [];
        for (var i = 0; i < Math.min(s.options.length, 5); i++) opts.push(s.options[i].text);
        selects.push({ id: s.id, name: s.name, optCount: s.options.length, firstOpts: opts });
      });
      var inputs = [];
      document.querySelectorAll('input').forEach(function(i) {
        inputs.push({ id: i.id, name: i.name, type: i.type, placeholder: i.placeholder });
      });
      var buttons = [];
      document.querySelectorAll('button').forEach(function(b) {
        buttons.push({ text: (b.innerText || '').trim().substring(0, 50), type: b.type });
      });
      var labels = [];
      document.querySelectorAll('label').forEach(function(l) {
        if (l.innerText && l.innerText.trim()) labels.push(l.innerText.trim().substring(0, 80));
      });
      return { selects: selects, inputs: inputs, buttons: buttons, labels: labels };
    })()`);
    console.log("\n=== FORM ELEMENTS ===");
    console.log("SELECTS:", JSON.stringify((formInfo as any).selects, null, 2));
    console.log("INPUTS:", JSON.stringify((formInfo as any).inputs, null, 2));
    console.log("BUTTONS:", JSON.stringify((formInfo as any).buttons, null, 2));
    console.log("LABELS:", JSON.stringify((formInfo as any).labels, null, 2));
  } catch (e: any) {
    console.log("   Error:", e.message.substring(0, 300));
  }
  
  // Check all cookies 
  var cookies = await context.cookies();
  console.log("\n=== COOKIES ===");
  cookies.forEach(function(c) {
    console.log("  " + c.domain + " : " + c.name + " = " + (c.value || "").substring(0, 30) + "...");
  });

  await browser.close();
  console.log("\nDone!");
}

main().catch(function(e) { console.error(e); process.exit(1); });
