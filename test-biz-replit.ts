import "./server/db";

async function main() {
  console.log("=== Testing Business Mail Replit creation ===\n");

  console.log("[1] Picking biz account from smtp.dev pool...");
  const { pickAvailableBizAccounts } = await import("./server/smtpDevService");

  const bizAccounts = await pickAvailableBizAccounts(new Set(), 1);
  if (!bizAccounts || bizAccounts.length === 0) {
    console.error("No biz accounts available!");
    process.exit(1);
  }

  const biz = bizAccounts[0];
  const inbox = biz.mailboxes?.find((m: any) => m.path === "INBOX") ?? biz.mailboxes?.[0];

  console.log(`Got biz account: ${biz.address}`);
  console.log(`  Account ID: ${biz.id}`);
  console.log(`  Inbox ID:   ${inbox?.id ?? "(none)"}`);

  const bizAccount = { id: biz.id, address: biz.address, inboxId: inbox?.id ?? "" };

  console.log("\n[2] Starting Replit registration...\n");
  const { registerReplitAccount } = await import("./server/playwrightService");

  const result = await registerReplitAccount(
    biz.address,
    "",
    (msg: string) => console.log(`  ${msg}`),
    undefined,
    undefined,
    bizAccount
  );

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
