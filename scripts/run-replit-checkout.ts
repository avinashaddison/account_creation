import { registerReplitAccount, type CardDetails } from "../server/playwrightService";

const OUTLOOK_EMAIL = "jonathanwise9787@outlook.com";
const OUTLOOK_PASSWORD = "ewjlo92252";
const COUPON_CODE = "AGENT457AA6000306A";

const CARD: CardDetails = {
  id: "d51ec70c-c4d4-4d8d-b666-3b9cc75b6860",
  cardNumber: "4065843006197211",
  expiryMonth: "03",
  expiryYear: "31",
  cvv: "007",
  cardholderName: "AJAY KUMAR",
  otpEmail: "ajayvaishwakarma@gmail.com",
  otpEmailPassword: "vcvg cejo aqqj kcxs",
};

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${time}] ${msg}`);
}

async function main() {
  log(`Starting full Replit checkout flow`);
  log(`Outlook  : ${OUTLOOK_EMAIL}`);
  log(`Card     : ${CARD.cardNumber} (${CARD.cardholderName})`);
  log(`Coupon   : ${COUPON_CODE}`);
  log(`OTP email: ${CARD.otpEmail}`);
  log("─".repeat(60));

  const result = await registerReplitAccount(
    OUTLOOK_EMAIL,
    OUTLOOK_PASSWORD,
    log,
    COUPON_CODE,
    CARD
  );

  log("─".repeat(60));
  if (result.success) {
    log(`✅ SUCCESS`);
    log(`   Username        : ${result.username}`);
    log(`   Email           : ${result.email}`);
    log(`   Password        : ${result.password}`);
    log(`   Checkout URL    : ${result.checkoutUrl?.substring(0, 80) ?? "N/A"}`);
    log(`   Checkout done   : ${result.checkoutComplete ? "YES ✅" : "NO ❌"}`);
  } else {
    log(`❌ FAILED: ${result.error || "Unknown error"}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
