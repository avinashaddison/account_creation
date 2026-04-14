import { createChatGPTAccount } from "./chatgptService";

const EMAIL       = "user5761573892m50723@addison.asia";
const SMTP_DEV_ID = "69de01ded0f83aa1f50ac38e";
const MAIL_PASS   = "smtp.dev";

async function main() {
  console.log("=== Full Flow Test — log auth page content ===");
  console.log(`Email: ${EMAIL}\n`);

  const result = await createChatGPTAccount({
    email:       EMAIL,
    smtpDevId:   SMTP_DEV_ID,
    mailPassword: MAIL_PASS,
    log: (msg) => console.log(msg),
  });

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch(e => { console.error("Unhandled:", e); process.exit(1); });
