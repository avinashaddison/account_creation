import "./server/db";

async function main() {
  console.log("=== FINAL TEST: CapSolver correct sitekey with FRESH email ===\n");
  
  // Fetch a fresh account from a random page to avoid "already in use"
  const { listAccountsPage } = await import("./server/smtpDevService");
  
  // Try random pages until we find one
  let foundAccount: any = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const page = Math.floor(Math.random() * 287) + 1;
    const accounts = await listAccountsPage(page).catch(() => []);
    if (accounts.length > 0) {
      // Pick one that looks realistic (not "account1234" style)
      const realistic = accounts.find((a: any) => !a.address.startsWith("account") && a.isActive && !a.isDeleted);
      if (realistic) {
        foundAccount = realistic;
        console.log(`Found account on page ${page}: ${realistic.address}`);
        break;
      }
    }
  }
  
  if (!foundAccount) {
    console.log("Could not find account, using fallback...");
    foundAccount = { 
      id: "69d41d8a065367aa280fb214",
      address: "account3252@addison.asia",
      mailboxes: [{ id: "69d41d8a065367aa280fb215", path: "INBOX" }]
    };
  }
  
  const inbox = foundAccount.mailboxes?.find((m: any) => m.path === "INBOX") ?? foundAccount.mailboxes?.[0];
  const bizAccount = {
    id: foundAccount.id,
    address: foundAccount.address,
    inboxId: inbox?.id ?? "",
  };
  
  console.log(`Using: ${bizAccount.address} (ID: ${bizAccount.id})\n`);
  
  const { registerReplitAccount } = await import("./server/playwrightService");
  
  const result = await registerReplitAccount(
    bizAccount.address,
    "",
    (msg) => console.log("  " + msg),
    undefined,
    undefined,
    bizAccount,
    false
  );

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
