import playwright from "playwright";
const { chromium } = playwright;

async function testProxy() {
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: "http://p.webshare.io:3128", username: "okdpvmze-101", password: "iy0zkuc7dt2s" },
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-gpu", "--no-zygote", "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("[1/3] Checking IP...");
    await page.goto("https://ipv4.webshare.io/", { timeout: 20000 });
    console.log("  → IP:", (await page.textContent("body"))?.trim());

    console.log("\n[2/3] Loading TM sign-up...");
    await page.goto("https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf2fc29c040a10a21be&response_type=code&scope=openid+profile+phone+email&redirect_uri=https://identity.ticketmaster.com/exchange&visualPresets=tm&lang=en-us&placeholderType=tm&hideLeftPanel=false&integratorId=prd1741.iccp&intSiteToken=tm-us&TMUO=%23signupDesktop", { 
      timeout: 30000, waitUntil: "domcontentloaded" 
    });
    console.log("  → Title:", await page.title());

    console.log("\n[3/3] Checking page content...");
    await page.waitForTimeout(5000);
    const bodyText = await page.textContent("body") || "";
    const lower = bodyText.toLowerCase();
    
    if (lower.includes("browsing activity") || lower.includes("unusual behavior") || lower.includes("access denied")) {
      console.log("  ⚠ BLOCKED");
      console.log("  Preview:", bodyText.substring(0, 300));
    } else if (lower.includes("sign up") || lower.includes("email") || lower.includes("first name") || lower.includes("create")) {
      console.log("  ✓ SUCCESS! Form accessible!");
      const email = await page.$('input[type="email"], input[name="email"], #email');
      const fn = await page.$('input[name="firstName"], #firstName');
      console.log("  → Email input:", !!email);
      console.log("  → FirstName input:", !!fn);
    } else {
      console.log("  ? Unknown state");
      console.log("  Preview:", bodyText.substring(0, 500));
    }
  } catch (err: any) {
    console.log("  ✗ ERROR:", err.message.substring(0, 300));
  } finally {
    await browser.close();
    console.log("\nDone.");
  }
}
testProxy();
