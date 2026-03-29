import { generateSingleCheckoutLink } from './server/playwrightService';
import { db } from './server/db';
import { sql } from 'drizzle-orm';

const accounts = [
  { id: "30a43e2c-de28-4e4a-8383-f34eacae6929", email: "jacquelinereyes4183@outlook.com", password: "GQa5h9hn$70",  coupon: "AGENT48F358ACD9CBE" },
  { id: "34a87f6d-3171-479e-8d52-3029a98c27e1", email: "daniellepierce2081@outlook.com",  password: "NY7b1aij%45", coupon: "AGENT47FD30D886167" },
  { id: "452bc3d1-df6c-4050-bc6b-8f980ea8f0f2", email: "pescejbietzpyon@hotmail.com",      password: "VBssfoee#38", coupon: "AGENT43D24F4009338" },
  { id: "4bc87cd0-086b-4bc8-8958-91cea106d64a", email: "abdinzsealyjdym@hotmail.com",      password: "PIsgv43t%22", coupon: "AGENT4614954509C1A" },
  { id: "678208bb-1da1-43ba-a936-6eec4967c540", email: "jeffreyjohnson6210@outlook.com",   password: "DYmbehsk@47", coupon: "AGENT4C3CB9CD9808F" },
  { id: "696367ab-8b4d-4861-883d-43b14030dc6a", email: "aclanhkhieuztb@hotmail.com",       password: "BY83ogcd@69", coupon: "AGENT470DB28E72BF1" },
];

async function main() {
  console.log("=".repeat(60));
  console.log("Generating 6 Replit checkout links (sequential)...");
  console.log("=".repeat(60));

  const results: Array<{ email: string; coupon: string; url?: string; error?: string }> = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const prefix = `[#${i + 1}/${accounts.length} ${acc.email}]`;
    const log = (msg: string) => { process.stdout.write(`${prefix} ${msg}\n`); };

    log("Starting...");
    try {
      const result = await generateSingleCheckoutLink(acc.email, acc.password, acc.coupon, log);
      if (result.success && result.stripeUrl) {
        log(`✅ SUCCESS: ${result.stripeUrl}`);
        await db.execute(sql`UPDATE replit_accounts SET checkout_url = ${result.stripeUrl} WHERE id = ${acc.id}`);
        log("Saved to DB");
        results.push({ email: acc.email, coupon: acc.coupon, url: result.stripeUrl });
      } else {
        log(`FAILED: ${result.error}`);
        results.push({ email: acc.email, coupon: acc.coupon, error: result.error });
      }
    } catch (e: any) {
      log(`EXCEPTION: ${e.message}`);
      results.push({ email: acc.email, coupon: acc.coupon, error: e.message });
    }
    console.log("");
  }

  console.log("\n" + "=".repeat(60));
  console.log("FINAL RESULTS:");
  console.log("=".repeat(60));
  let successCount = 0;
  for (const r of results) {
    if (r.url) {
      successCount++;
      console.log(`OK  ${r.email}`);
      console.log(`    Coupon : ${r.coupon}`);
      console.log(`    URL    : ${r.url}\n`);
    } else {
      console.log(`ERR ${r.email} — ${r.error}\n`);
    }
  }
  console.log(`Done: ${successCount}/${results.length} succeeded`);
}

main().catch(console.error).finally(() => process.exit(0));
