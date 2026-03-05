import { chromium } from "playwright";

const PROXY = {
  server: "http://brd.superproxy.io:33335",
  username: "brd-customer-hl_f64e1a6d-zone-web_unlocker2",
  password: "s767634f70t7",
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-http2", "--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({
    proxy: PROXY,
    ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => false })");
  const page = await context.newPage();

  // Step 1: Get the Queue-IT redirect URL
  let queueitUrl = "";
  await page.route("https://tickets.la28.org/mycustomerdata/**", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    // Extract the redirect URL
    const match = body.match(/document\.location\.href\s*=\s*decodeURIComponent\('([^']+)'\)/);
    if (match) {
      queueitUrl = decodeURIComponent(match[1]);
      console.log("[INTERCEPTED] Queue-IT URL:", queueitUrl.substring(0, 100));
    }
    await route.fulfill({ response, body });
  });

  await page.goto("https://tickets.la28.org/mycustomerdata/?affiliate=28A", { waitUntil: "commit", timeout: 30000 });
  await page.waitForTimeout(3000);

  if (queueitUrl) {
    // The URL is relative, prepend the domain
    const fullUrl = queueitUrl.startsWith('/') ? "https://tickets.la28.org" + queueitUrl : queueitUrl;
    console.log("[1] Full Queue-IT URL:", fullUrl.substring(0, 150));
    
    // Navigate to this URL - this is the Queue-IT waiting room
    page.removeAllListeners('framenavigated');
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        console.log("[NAV]", frame.url().substring(0, 180));
      }
    });
    
    console.log("[2] Following Queue-IT URL...");
    await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    
    console.log("[2] URL after Queue-IT:", page.url().substring(0, 180));
    
    // Check what the Queue-IT page looks like
    const text = await page.evaluate("document.body ? document.body.innerText.substring(0, 500) : ''") as string;
    console.log("[2] Text:", text.substring(0, 300));
    
    // Check for Queue-IT iframe
    const iframes = await page.evaluate("(() => { var r=[]; document.querySelectorAll('iframe').forEach(function(f){r.push({src:f.src.substring(0,100),w:f.offsetWidth,h:f.offsetHeight});}); return r; })()") as any[];
    console.log("[2] Iframes:", JSON.stringify(iframes));
    
    // The Queue-IT might be rendered in the page without a separate domain
    // Check for Queue-IT specific elements
    const queueElements = await page.evaluate("(() => { var r=[]; document.querySelectorAll('[id*=queue],[class*=queue],[id*=Queue],[class*=Queue]').forEach(function(el){r.push({id:el.id,cls:el.className.substring(0,50),text:el.textContent.substring(0,50)});}); return r; })()") as any[];
    console.log("[2] Queue elements:", JSON.stringify(queueElements));
    
    // Wait and see if we get passed through
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      const url = page.url();
      if (url.includes('queueittoken') || (url.includes('/mycustomerdata') && !url.includes('enqueuetoken'))) {
        console.log(`[${(i+1)*5}s] PASSED! URL: ${url.substring(0, 150)}`);
        break;
      }
      if (i % 4 === 0) {
        const txt = await page.evaluate("document.body ? document.body.innerText.substring(0, 80) : ''") as string;
        console.log(`[${(i+1)*5}s] ${url.substring(0, 60)} | ${txt.substring(0, 60)}`);
      }
    }
  }

  await context.close();
  await browser.close();
}
main().catch(e => console.error("Error:", e.message));
