import { storage } from "../server/storage";
const key = await storage.getSetting("nopecha_api_key");
const key2 = await storage.getSetting("twocaptcha_api_key");
const key3 = await storage.getSetting("anticaptcha_api_key");
process.stdout.write(`nopecha: "${key}"\ntwocaptcha: "${key2}"\nanticaptcha: "${key3}"\n`);
process.exit(0);
