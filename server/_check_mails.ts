import { db } from "./db";
import { chatgptAccounts, bizMailAccounts } from "../shared/schema";

async function main() {
  const gptAccounts = await db.select().from(chatgptAccounts).limit(30);
  const bizMails = await db.select().from(bizMailAccounts).limit(30);

  console.log("=== Biz Mails — which have GPT accounts? ===");
  for (const m of bizMails) {
    const gpt = gptAccounts.find(g => g.email === m.email);
    console.log(`  ${m.email} → GPT: ${gpt ? gpt.status : "NONE"} | smtpAccountId: ${m.smtpAccountId}`);
  }
  process.exit(0);
}
main();
