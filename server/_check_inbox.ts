import { getFullInbox } from "./smtpDevService";

async function main() {
  const msgs = await getFullInbox("69de01ded0f83aa1f50ac38e");
  console.log("Total msgs:", msgs.length);
  if (msgs.length > 0) {
    const latest = msgs[msgs.length - 1];
    console.log("Keys:", Object.keys(latest).join(", "));
    console.log("JSON:", JSON.stringify(latest, null, 2).slice(0, 800));
  }
}
main().catch(console.error);
