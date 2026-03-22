import { tmFullRegistrationFlow } from "../server/ticketmasterService";
import { getMailTmOnlyDomain, createTempEmail, pollForVerificationCode, generateRandomUsername } from "../server/mailService";

const FIRST_NAMES = ["James","John","Robert","Michael","William","David","Richard","Joseph","Thomas","Charles"];
const LAST_NAMES = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez"];
const randomFrom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

function generatePassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let pw = "";
  pw += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];
  pw += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
  pw += "0123456789"[Math.floor(Math.random() * 10)];
  pw += "!@#$%"[Math.floor(Math.random() * 5)];
  for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw.split("").sort(() => Math.random() - 0.5).join("");
}

// Presale: ZenRows WSS, TM Registration: SOAX residential proxy
const ZENROWS_WSS = "wss://browser.zenrows.com?apikey=16ad08cfa1bc9df048d189ed3fafd0e1957d178a";
const TM_PROXY    = "http://package-339278-country-us-sessionid-kfLq8QIZ0wGMrrtc-sessionlength-300-opt-wb:ejOmfeLuOA4CLYRh@proxy.soax.com:5000";

async function main() {
  console.log("=== Shakira Presale + TM Account Creation ===\n");

  // 1. Create temp email
  const domain = await getMailTmOnlyDomain();
  const username = generateRandomUsername();
  const email = `${username}@${domain}`;
  const emailPassword = "TempPass123!";

  console.log(`📧 Email: ${email}`);
  const { provider } = await createTempEmail(email, emailPassword);
  console.log(`✅ Temp email created via: ${provider}`);

  // 2. Account details
  const firstName = randomFrom(FIRST_NAMES);
  const lastName = randomFrom(LAST_NAMES);
  const password = generatePassword();
  console.log(`👤 Name: ${firstName} ${lastName}`);
  console.log(`🔑 Password: ${password}`);
  console.log(`🌐 TM Proxy: ${TM_PROXY.substring(0, 50)}...`);
  console.log(`🌐 Presale Proxy (ZenRows WSS): configured`);
  console.log(`\n🚀 Starting Shakira presale + TM registration flow...\n`);

  // 3. Run full flow
  const result = await tmFullRegistrationFlow(
    email,
    firstName,
    lastName,
    password,
    (status) => { console.log(`  [STATUS] ${status}`); },
    async () => {
      console.log("  [EMAIL] Polling for verification code...");
      const code = await pollForVerificationCode(email, emailPassword, provider, 70, 3000);
      console.log(`  [EMAIL] Code: ${code || "NOT FOUND"}`);
      return code;
    },
    (msg) => { console.log(`  ${msg}`); },
    TM_PROXY,
    false,        // keepBrowserOpen
    true,         // shakiraPresale = true
    ZENROWS_WSS   // presaleProxyUrl = ZenRows for Shakira presale (hybrid: ZenRows presale → Bright Data TM)
  );

  console.log("\n=== RESULT ===");
  if (result.success) {
    console.log("✅ SUCCESS!");
    console.log(`   Email:     ${email}`);
    console.log(`   Password:  ${password}`);
    console.log(`   SMS Cost:  $${(result.smsCost || 0).toFixed(2)}`);
  } else {
    console.log(`❌ FAILED: ${result.error}`);
    console.log(`   SMS spent: $${(result.smsCost || 0).toFixed(2)}`);
  }
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
