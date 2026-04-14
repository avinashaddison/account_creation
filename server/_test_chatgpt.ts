import { createChatGPTAccount } from "./chatgptService";

// Last remaining fresh biz mail account
const EMAIL       = "user1127734159m67040@addison.asia";
const SMTP_DEV_ID = "69de0aeb0dd62fa536095408";
const MAIL_PASS   = "smtp.dev";
// Admin Telegram ID to receive the QR code via Bot 2
const ADMIN_TG_ID = 1127734159;

async function main() {
  console.log("=== Full Flow Test — Account Creation + Plus Subscription ===");
  console.log(`Email: ${EMAIL}\n`);

  const result = await createChatGPTAccount({
    email:            EMAIL,
    smtpDevId:        SMTP_DEV_ID,
    mailPassword:     MAIL_PASS,
    subscribeAfter:   true,
    adminTelegramId:  ADMIN_TG_ID,
    log: (msg) => console.log(msg),
  });

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch(e => { console.error("Unhandled:", e); process.exit(1); });
