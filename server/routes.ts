import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { searchEvents, getEventById } from "./services/ticketmasterDiscoveryService";
import { startMonitoring, sendTelegramMessage } from "./services/alertService";
import { getAvailableDomain, getMailTmOnlyDomain, createTempEmail, getAuthToken, pollForVerificationCode, pollForDrawConfirmation, generateRandomUsername, fetchMessages, fetchMessageContent, detectProviderFromDomain, hasGmailCredentials, createGmailAddress, pollGmailForVerificationCode, setGmailCredentials } from "./mailService";
import { fullRegistrationFlow, retryDrawRegistration, completeDrawRegistrationViaApi, completeDrawViaGigyaBrowser, loginOutlookAccount, registerZenrowsAccount, createOutlookAccount, checkGmailAccount, loginGoogleAccount, createGmailAccount, registerReplitAccount, registerLovableAccount } from "./playwrightService";
import { tmFullRegistrationFlow } from "./ticketmasterService";
import { uefaFullRegistrationFlow } from "./uefaService";
import { brunoMarsPresaleStep } from "./brunoMarsService";
import { getSMSPoolBalance } from "./smspoolService";
import { getCapSolverBalance, clearCapsolverApiKeyCache } from "./capsolverService";
import { clearZenrowsApiKeyCache } from "./playwrightService";
import { randomUUID, createHash } from "crypto";

async function getDefaultBrowserApiUrl(): Promise<string | null> {
  const residential = await storage.getSetting("residential_proxy_url");
  if (residential) return residential;
  const soaxTemplate = await storage.getSetting("soax_proxy_template");
  if (soaxTemplate) return soaxTemplate;
  const saved = await storage.getSetting("browser_proxy_url");
  return saved || null;
}

function uniqueProxySession(proxyUrl: string): string {
  if (!proxyUrl || proxyUrl === "local") return proxyUrl;
  const sessionId = randomUUID().replace(/-/g, "").substring(0, 12);

  if (proxyUrl.includes("superproxy.zenrows.com")) {
    let url = proxyUrl.replace(/ttl-\w+/, "ttl-30m");
    url = url.replace(/session-\w+/, `session-${sessionId}`);
    if (!url.includes("session-")) {
      const atIndex = url.indexOf("@");
      if (atIndex !== -1) {
        url = url.substring(0, atIndex).replace(/:(\d+)$/, "") + `_session-${sessionId}` + url.substring(url.lastIndexOf("@") - 1).replace(/.*@/, "@");
      }
    }
    return url;
  }

  if (proxyUrl.includes("soax.com") || proxyUrl.includes("rotating")) {
    if (proxyUrl.includes("sessionid-")) {
      return proxyUrl.replace(/sessionid-[^-]+/, `sessionid-${sessionId}`);
    }
    if (proxyUrl.includes("sessid=")) {
      return proxyUrl.replace(/sessid=[^&:@]+/, `sessid=${sessionId}`);
    }
    if (proxyUrl.includes("session-")) {
      return proxyUrl.replace(/session-[^:@]+/, `session-${sessionId}`);
    }
    const atIdx = proxyUrl.lastIndexOf("@");
    if (atIdx !== -1) {
      const userPart = proxyUrl.substring(0, atIdx);
      const hostPart = proxyUrl.substring(atIdx);
      return `${userPart}_sessid-${sessionId}${hostPart}`;
    }
  }

  return proxyUrl;
}

async function getDefaultProxies(proxyList?: string[]): Promise<string[]> {
  if (Array.isArray(proxyList) && proxyList.length > 0) return proxyList;
  const residential = await storage.getSetting("residential_proxy_url");
  if (residential) return [residential];
  const saved = await getDefaultBrowserApiUrl();
  if (saved) return [saved];
  return ["local"];
}

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: "Not authenticated" });
}

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.role === "superadmin") {
    return next();
  }
  return res.status(403).json({ error: "Super admin access required" });
}

function requireServiceAccess(serviceId: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.session && req.session.role === "superadmin") return next();
    if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    const allowed: string[] = (user as any).allowedServices || [];
    if (!allowed.includes(serviceId)) {
      return res.status(403).json({ error: `Access denied: ${serviceId} service not enabled for your account` });
    }
    return next();
  };
}

const FREE_ACCOUNT_LIMIT = 0;
const TRC20_ADDRESS = "TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB";
const WHATSAPP_NUMBER = "420604332586";

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Lisa", "Matthew", "Nancy",
  "Christopher", "Betty", "Andrew", "Margaret", "Joshua", "Sandra", "Kenneth", "Ashley",
  "Kevin", "Dorothy", "Brian", "Kimberly", "George", "Emily", "Timothy", "Donna",
  "Ronald", "Michelle", "Jason", "Carol", "Edward", "Amanda", "Ryan", "Melissa",
  "Jacob", "Deborah", "Gary", "Stephanie", "Nicholas", "Rebecca", "Eric", "Sharon",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore",
  "Jackson", "Martin", "Lee", "Thompson", "White", "Harris", "Clark", "Lewis",
  "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Adams",
  "Baker", "Nelson", "Hill", "Campbell", "Mitchell", "Roberts", "Carter", "Phillips",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pwd = pick(upper) + pick(upper) + pick(lower) + pick(lower) + pick(lower)
    + pick(digits) + pick(digits) + pick(special) + pick(special);
  const all = upper + lower + digits;
  for (let i = 0; i < 5; i++) pwd += pick(all);
  const arr = pwd.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

const DEFAULT_COST_PER_ACCOUNT = 0.11;

async function getCostPerAccount(): Promise<number> {
  const val = await storage.getSetting("account_price");
  return val ? parseFloat(val) : DEFAULT_COST_PER_ACCOUNT;
}

let wsClients: Map<WebSocket, string> = new Map();

const batchLogs: Map<string, Array<{ accountId: string; message: string; timestamp: string }>> = new Map();
const batchOwners: Map<string, string> = new Map();
const cancelledBatches: Set<string> = new Set();
const BATCH_LOG_TTL = 30 * 60 * 1000;

function addBatchLog(batchId: string, accountId: string, message: string) {
  if (!batchLogs.has(batchId)) {
    batchLogs.set(batchId, []);
    setTimeout(() => { batchLogs.delete(batchId); batchOwners.delete(batchId); }, BATCH_LOG_TTL);
  }
  batchLogs.get(batchId)!.push({ accountId, message, timestamp: new Date().toISOString() });
}

function broadcast(data: any, ownerId?: string) {
  const msg = JSON.stringify(data);
  wsClients.forEach((userId, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (!ownerId || userId === ownerId) {
        ws.send(msg);
      }
    }
  });
}

function broadcastLog(batchId: string, accountId: string, message: string, ownerId?: string) {
  addBatchLog(batchId, accountId, message);
  console.log(`[${batchId}/${accountId}] ${message}`);
  broadcast({ type: "log", batchId, accountId, message, timestamp: new Date().toISOString() }, ownerId);
}

function broadcastAccountUpdate(account: any, ownerId?: string) {
  broadcast({ type: "account_update", account, batchId: account.batchId }, ownerId);
}

function broadcastBatchComplete(batchId: string, ownerId?: string) {
  addBatchLog(batchId, "", "Batch complete");
  broadcast({ type: "batch_complete", batchId }, ownerId);
}

async function processAccountWithToken(
  accountId: string,
  batchId: string,
  firstName: string,
  lastName: string,
  password: string,
  country: string,
  language: string,
  addisonEmail: string,
  addisonEmailPassword: string,
  ownerId: string,
  proxyUrl: string = "",
  preToken?: string
) {
  return processAccount(accountId, batchId, firstName, lastName, password, country, language, addisonEmail, addisonEmailPassword, ownerId, proxyUrl, preToken);
}

async function processAccount(
  accountId: string,
  batchId: string,
  firstName: string,
  lastName: string,
  password: string,
  country: string,
  language: string,
  addisonEmail: string,
  addisonEmailPassword: string,
  ownerId: string,
  proxyUrl: string = "",
  preToken?: string
) {
  try {
    let currentEmail = addisonEmail;
    const isGmailMode = currentEmail.endsWith("@gmail.com");
    let emailProvider = isGmailMode ? ("mail.tm" as const) : detectProviderFromDomain(addisonEmail.split("@")[1] || "");
    const MAX_EMAIL_RETRIES = isGmailMode ? 0 : 2;

    const runRegistration = async () => {
      const result = await fullRegistrationFlow(
        currentEmail,
        firstName,
        lastName,
        password,
        country,
        language,
        async (status) => {
          const updated = await storage.updateAccount(accountId, { status: status as any });
          if (updated) broadcastAccountUpdate(updated, ownerId);
          broadcastLog(batchId, accountId, `Status: ${status}`, ownerId);
        },
        async () => {
          broadcastLog(batchId, accountId, `Polling for verification code...`, ownerId);
          let code: string | null;
          if (currentEmail.endsWith("@gmail.com")) {
            broadcastLog(batchId, accountId, `[Gmail] Checking IMAP inbox for ${currentEmail}...`, ownerId);
            code = await pollGmailForVerificationCode(currentEmail, 70, 3000);
          } else {
            code = await pollForVerificationCode(currentEmail, addisonEmailPassword, emailProvider, 70, 3000);
          }
          if (code) {
            await storage.updateAccount(accountId, { verificationCode: code });
            broadcastLog(batchId, accountId, `Got verification code: ${code}`, ownerId);
          } else {
            broadcastLog(batchId, accountId, `Timed out waiting for code`, ownerId);
          }
          return code;
        },
        (message) => {
          broadcastLog(batchId, accountId, message, ownerId);
        },
        proxyUrl
      );
      return result;
    };

    if (preToken) {
      broadcastLog(batchId, accountId, `Email pre-created, starting registration...`, ownerId);
    } else if (isGmailMode) {
      broadcastLog(batchId, accountId, `[Gmail] Using Gmail inbox for ${currentEmail}, starting registration...`, ownerId);
    } else {
      broadcastLog(batchId, accountId, `Creating Addison email: ${currentEmail}`, ownerId);
      const created = await createTempEmail(currentEmail, addisonEmailPassword);
      emailProvider = created.provider;
      broadcastLog(batchId, accountId, `Addison email ready (${created.provider}), starting registration...`, ownerId);
    }

    let result = await runRegistration();

    for (let emailRetry = 0; emailRetry < MAX_EMAIL_RETRIES && !result.success && (result.error || "").includes("Timed out waiting for verification email"); emailRetry++) {
      broadcastLog(batchId, accountId, `📧 Email not delivered to ${currentEmail} — switching to alternate email domain...`, ownerId);
      try {
        const newDomain = await getAvailableDomain(true);
        const newUsername = generateRandomUsername();
        const newEmail = `${newUsername}@${newDomain}`;
        broadcastLog(batchId, accountId, `🔄 Email retry ${emailRetry + 1}/${MAX_EMAIL_RETRIES}: creating ${newEmail}...`, ownerId);
        const created = await createTempEmail(newEmail, addisonEmailPassword);
        emailProvider = created.provider;
        currentEmail = newEmail;
        const accUpdated = await storage.updateAccount(accountId, { email: newEmail, status: "registering" as any });
        if (accUpdated) broadcastAccountUpdate(accUpdated, ownerId);
        result = await runRegistration();
      } catch (retryErr: any) {
        broadcastLog(batchId, accountId, `Email retry ${emailRetry + 1} setup error: ${retryErr.message.substring(0, 80)}`, ownerId);
        break;
      }
    }

    if (result.success) {
      const currentAccount = await storage.getAccount(accountId);
      const currentStatus = currentAccount?.status || "";
      let finalStatus: string;
      if (currentStatus === "completed") finalStatus = "completed";
      else if (currentStatus === "draw_registering") finalStatus = "draw_registering";
      else finalStatus = "verified";
      const updateData: any = { status: finalStatus };
      if (result.zipCode) updateData.zipCode = result.zipCode;

      if (finalStatus === "draw_registering") {
        broadcastLog(batchId, accountId, `⚡ Draw step incomplete — retrying with fresh session...`, ownerId);
        const log = (msg: string) => { broadcastLog(batchId, accountId, msg, ownerId); };
        for (let retry = 0; retry < 2; retry++) {
          try {
            await new Promise(r => setTimeout(r, 3000));
            const drawResult = await completeDrawViaGigyaBrowser(currentEmail, password, result.zipCode || undefined, log);
            if (drawResult.formSubmitted) {
              finalStatus = "completed";
              updateData.status = "completed";
              broadcastLog(batchId, accountId, `✅ Draw retry ${retry + 1} succeeded!`, ownerId);
              break;
            } else {
              broadcastLog(batchId, accountId, `Draw retry ${retry + 1} did not complete form. ${retry < 1 ? 'Trying again...' : 'Will rely on auto-retry.'}`, ownerId);
            }
          } catch (retryErr: any) {
            broadcastLog(batchId, accountId, `Draw retry ${retry + 1} error: ${retryErr.message.substring(0, 80)}. ${retry < 1 ? 'Trying again...' : 'Will rely on auto-retry.'}`, ownerId);
          }
        }
      }

      if (finalStatus === "completed") {
        broadcastLog(batchId, accountId, `📧 Checking inbox for LA28 draw confirmation email...`, ownerId);
        try {
          const confirmed = await pollForDrawConfirmation(currentEmail, addisonEmailPassword, emailProvider, 20, 5000);
          if (confirmed) {
            broadcastLog(batchId, accountId, `✅ Draw confirmation email received! Registration verified by LA28.`, ownerId);
          } else {
            broadcastLog(batchId, accountId, `⚠️ Draw confirmation email not found yet. Draw was submitted but email not received within timeout.`, ownerId);
          }
        } catch (confirmErr: any) {
          broadcastLog(batchId, accountId, `⚠️ Could not check for confirmation email: ${confirmErr.message}`, ownerId);
        }
      }

      const updated = await storage.updateAccount(accountId, updateData);
      if (updated) broadcastAccountUpdate(updated, ownerId);
      const successMsg = finalStatus === "completed"
        ? `✅ Full flow complete! Draw registered: ${currentEmail}`
        : `✅ Account created successfully! Email: ${currentEmail}`;
      broadcastLog(batchId, accountId, successMsg, ownerId);

      const billingPrice = await getCostPerAccount();
      await storage.createBillingRecord({
        accountId,
        amount: billingPrice.toFixed(2),
        description: `Account creation: ${firstName} ${lastName} (${currentEmail})`,
        ownerId,
      });

      const user = await storage.getUser(ownerId);
      if (user) {
        await storage.updateUserFreeAccountsUsed(ownerId, user.freeAccountsUsed + 1);
      }
    } else {
      const errMsg = result.error || "Failed";
      const isDrawFailure = errMsg.includes("browser has been closed") || errMsg.includes("Target page") || errMsg.includes("session");
      const currentAccount = await storage.getAccount(accountId);
      const currentStatus = currentAccount?.status || "";

      if (isDrawFailure && (currentStatus === "draw_registering" || currentStatus === "verified")) {
        broadcastLog(batchId, accountId, `⚡ Session closed during draw — retrying with fresh session...`, ownerId);
        const log = (msg: string) => { broadcastLog(batchId, accountId, msg, ownerId); };
        let rescued = false;
        for (let retry = 0; retry < 2; retry++) {
          try {
            await new Promise(r => setTimeout(r, 3000));
            const drawResult = await completeDrawViaGigyaBrowser(currentEmail, password, result.zipCode || undefined, log);
            if (drawResult.formSubmitted) {
              rescued = true;
              const updated2 = await storage.updateAccount(accountId, { status: "completed" });
              if (updated2) broadcastAccountUpdate(updated2, ownerId);
              broadcastLog(batchId, accountId, `✅ Rescued! Draw retry ${retry + 1} succeeded: ${currentEmail}`, ownerId);
              const billingPrice = await getCostPerAccount();
              await storage.createBillingRecord({ accountId, amount: billingPrice.toFixed(2), description: `Account creation: ${firstName} ${lastName} (${currentEmail})`, ownerId });
              const user = await storage.getUser(ownerId);
              if (user) await storage.updateUserFreeAccountsUsed(ownerId, user.freeAccountsUsed + 1);
              break;
            } else {
              broadcastLog(batchId, accountId, `Draw rescue ${retry + 1} did not complete. ${retry < 1 ? 'Trying again...' : ''}`, ownerId);
            }
          } catch (retryErr: any) {
            broadcastLog(batchId, accountId, `Draw rescue ${retry + 1} error: ${retryErr.message.substring(0, 80)}`, ownerId);
          }
        }
        if (!rescued) {
          const updated = await storage.updateAccount(accountId, { status: "draw_registering", errorMessage: "Draw step failed, queued for auto-retry" });
          if (updated) broadcastAccountUpdate(updated, ownerId);
          broadcastLog(batchId, accountId, `⏳ Marked for auto-retry (account exists, draw pending): ${currentEmail}`, ownerId);
        }
      } else {
        const updated = await storage.updateAccount(accountId, { status: "failed", errorMessage: errMsg });
        if (updated) broadcastAccountUpdate(updated, ownerId);
        broadcastLog(batchId, accountId, `Failed: ${errMsg}`, ownerId);
      }
    }
  } catch (err: any) {
    const updated = await storage.updateAccount(accountId, { status: "failed", errorMessage: err.message });
    if (updated) broadcastAccountUpdate(updated, ownerId);
    broadcastLog(batchId, accountId, `Error: ${err.message}`, ownerId);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const pgModule = await import("pg");
  const wsPool = new pgModule.default.Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL, max: 2 });
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const cookieHeader = req.headers.cookie || "";
    const sidMatch = cookieHeader.match(/connect\.sid=(?:s(?:%3A|:))?([^.;\s]+)/);
    const sessionId = sidMatch ? decodeURIComponent(sidMatch[1]) : null;

    if (!sessionId) {
      console.log("[WS] No session cookie found, client will receive all broadcasts");
      wsClients.set(ws, "");
      ws.on("close", () => wsClients.delete(ws));
      return;
    }

    wsPool.query(`SELECT sess FROM user_sessions WHERE sid = $1`, [sessionId])
      .then((result: any) => {
        if (result.rows.length > 0 && result.rows[0].sess?.userId) {
          const userId = result.rows[0].sess.userId;
          wsClients.set(ws, userId);
          console.log(`[WS] Client authenticated: ${userId}`);
        } else {
          console.log(`[WS] Session found but no userId, trying sess data...`);
          wsClients.set(ws, "");
        }
      })
      .catch((err: any) => {
        console.log(`[WS] Session lookup failed: ${err.message}`);
        wsClients.set(ws, "");
      });
    ws.on("close", () => wsClients.delete(ws));
  });

  async function ensureDefaultData() {
    try {
      await wsPool.query("ALTER TYPE account_status ADD VALUE IF NOT EXISTS 'presale_loading'");
      await wsPool.query("ALTER TYPE account_status ADD VALUE IF NOT EXISTS 'presale_filling'");
      await wsPool.query("ALTER TYPE account_status ADD VALUE IF NOT EXISTS 'presale_events'");
      await wsPool.query("ALTER TYPE account_status ADD VALUE IF NOT EXISTS 'presale_submitting'");
      console.log("[Migration] Ensured presale enum values exist");
    } catch (err: any) {
      console.error("[Migration] Enum update error:", err.message);
    }

    const oldAdmin = await storage.getUserByEmail("admin@la28panel.com");
    if (oldAdmin) {
      await storage.deleteUser(oldAdmin.id);
    }

    let sa = await storage.getUserByEmail("avinashaddison@gmail.com");
    if (!sa) {
      sa = await storage.createUser({
        username: "avinash",
        email: "avinashaddison@gmail.com",
        password: hashPassword("@AJAYkn8085123"),
        role: "superadmin",
      });
      console.log("[Auth] Super admin created: avinashaddison@gmail.com");
    }

    const existingPetr = await storage.getUserByEmail("bobca2004@gmail.com");
    if (!existingPetr) {
      const petr = await storage.createUser({
        username: "Petr",
        email: "bobca2004@gmail.com",
        password: hashPassword("petr123"),
        role: "admin",
        panelName: "Petr Panel v2",
      });
      await storage.updateUserWalletBalance(petr.id, "47.57");
      await storage.updateUserFreeAccountsUsed(petr.id, 15);
      console.log("[Auth] Admin created: bobca2004@gmail.com ($47.57)");
    }

    const price = await storage.getSetting("account_price");
    if (!price) {
      await storage.setSetting("account_price", "0.24");
      console.log("[Auth] Default account price set: $0.24");
    }
    const residentialProxy = await storage.getSetting("residential_proxy_url");
    if (!residentialProxy) {
      console.log("[Auth] No residential proxy URL set. Please configure it in Settings.");
    }
    const browserEngine = await storage.getSetting("browser_proxy_url");
    if (!browserEngine) {
      console.log("[Auth] No browser engine URL set. Please configure it in Settings.");
    }

    const gmailEmail = await storage.getSetting("gmail_email");
    const gmailAppPassword = await storage.getSetting("gmail_app_password");
    setGmailCredentials(gmailEmail || null, gmailAppPassword || null);
    if (gmailEmail && gmailAppPassword) {
      console.log(`[Gmail] IMAP credentials loaded for ${gmailEmail}`);
    } else {
      console.log("[Gmail] No Gmail credentials configured — will use temp email fallback");
    }
  }
  await ensureDefaultData();

  async function cleanupStaleAccounts() {
    try {
      const allAccounts = await storage.getAllAccounts();
      const now = Date.now();
      const staleTimeout = 60 * 60 * 1000;
      let cleaned = 0;
      for (const acc of allAccounts) {
        if (
          (acc.status === "registering" || acc.status === "waiting_code" || acc.status === "filling_form" || acc.status === "selecting_events" || acc.status === "submitting" || acc.status === "verifying" || acc.status === "presale_loading" || acc.status === "presale_filling" || acc.status === "presale_events" || acc.status === "presale_submitting") &&
          acc.createdAt
        ) {
          const age = now - new Date(acc.createdAt).getTime();
          if (age > staleTimeout) {
            await storage.updateAccount(acc.id, {
              status: "failed",
              errorMessage: acc.errorMessage || "Stale: browser session ended without completing",
            });
            cleaned++;
          }
        }
      }
      if (cleaned > 0) {
        console.log(`[Cleanup] Marked ${cleaned} stale accounts as failed`);
      }
    } catch (err: any) {
      console.log(`[Cleanup] Error: ${err.message}`);
    }
  }

  await cleanupStaleAccounts();
  setInterval(cleanupStaleAccounts, 10 * 60 * 1000);

  let autoRetryRunning = false;
  async function autoRetryDrawAccounts() {
    if (autoRetryRunning) return;
    autoRetryRunning = true;
    try {
      const stuckRows = await db.execute(sql`SELECT id, temp_email, la28_password, zip_code, batch_id, owner_id FROM accounts WHERE status = 'draw_registering' AND platform = 'la28' LIMIT 5`);
      if (stuckRows.rows.length === 0) { autoRetryRunning = false; return; }
      console.log(`[AutoRetry] Found ${stuckRows.rows.length} stuck draw_registering accounts`);
      for (const row of stuckRows.rows) {
        const acctId = row.id as string;
        const email = row.temp_email as string;
        const password = row.la28_password as string;
        const zipCode = row.zip_code as string | null;
        const batchId = (row.batch_id || acctId) as string;
        const ownerId = row.owner_id as string | undefined;
        const log = (msg: string) => { broadcastLog(batchId, acctId, msg, ownerId); };
        console.log(`[AutoRetry] Retrying draw for ${email} (${acctId})`);
        log("Auto-retry: attempting draw registration...");
        try {
          const result = await completeDrawViaGigyaBrowser(email, password, zipCode || undefined, log);
          if (result.formSubmitted) {
            await storage.updateAccount(acctId, { status: "completed" });
            const acct = await storage.getAccount(acctId);
            if (acct) broadcastAccountUpdate(acct, ownerId);
            console.log(`[AutoRetry] ${email} completed!`);
            log("Auto-retry: draw form submitted + success page confirmed!");
          } else if (result.profileSet || result.dataSet) {
            console.log(`[AutoRetry] ${email} profile/data set but form NOT submitted`);
            log("Auto-retry: profile data set but draw form NOT submitted. Will retry later.");
          } else {
            console.log(`[AutoRetry] ${email} still failing: ${result.error || 'unknown'}`);
            log("Auto-retry: still blocked (" + (result.error || 'unknown').substring(0, 60) + "). Will retry later.");
          }
        } catch (err: any) {
          console.log(`[AutoRetry] ${email} error: ${err.message.substring(0, 100)}`);
          log("Auto-retry error: " + err.message.substring(0, 60) + ". Will retry later.");
        }
      }
    } catch (err: any) {
      console.log(`[AutoRetry] Error: ${err.message}`);
    }
    autoRetryRunning = false;
  }

  setInterval(autoRetryDrawAccounts, 5 * 60 * 1000);
  setTimeout(autoRetryDrawAccounts, 30 * 1000);

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      const user = await storage.getUserByEmail(email);
      if (!user || user.password !== hashPassword(password)) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      req.session.userId = user.id;
      req.session.role = user.role;
      res.json({ id: user.id, username: user.username, email: user.email, role: user.role, walletBalance: user.walletBalance, panelName: user.panelName || "Addison Panel" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      freeAccountsUsed: user.freeAccountsUsed,
      walletBalance: user.walletBalance,
      panelName: user.panelName || "Addison Panel",
      allowedServices: user.allowedServices,
    });
  });

  app.put("/api/auth/panel-name", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { panelName } = req.body;
      if (!panelName || typeof panelName !== "string" || panelName.trim().length === 0) {
        return res.status(400).json({ error: "Panel name is required" });
      }
      const trimmed = panelName.trim().slice(0, 50);
      await db.update(users).set({ panelName: trimmed }).where(eq(users.id, userId));
      res.json({ panelName: trimmed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/users", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const safeUsers = allUsers.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        freeAccountsUsed: u.freeAccountsUsed,
        walletBalance: u.walletBalance,
        allowedServices: u.allowedServices,
      }));
      res.json(safeUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/users", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { username, email, password, role = "admin", panelName } = req.body;
      if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, email, and password are required" });
      }
      if (role === "superadmin") {
        return res.status(400).json({ error: "Cannot create another super admin" });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: "Email already exists" });
      }
      const user = await storage.createUser({
        username,
        email,
        password: hashPassword(password),
        role,
      });
      if (panelName && typeof panelName === "string" && panelName.trim()) {
        await db.update(users).set({ panelName: panelName.trim().slice(0, 50) }).where(eq(users.id, user.id));
      }
      res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role === "superadmin") return res.status(400).json({ error: "Cannot delete super admin" });
      await storage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/users/:id/password", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || password.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters" });
      }
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role === "superadmin") return res.status(400).json({ error: "Cannot change super admin password from here" });
      await storage.updateUserPassword(req.params.id, hashPassword(password));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/users/:id/services", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { allowedServices } = req.body;
      if (!Array.isArray(allowedServices)) {
        return res.status(400).json({ error: "allowedServices must be an array" });
      }
      const validServices = ["la28", "ticketmaster", "uefa", "brunomars", "outlook", "zenrows", "replit", "lovable"];
      const filtered = allowedServices.filter((s: string) => validServices.includes(s));
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role === "superadmin") return res.status(400).json({ error: "Cannot restrict super admin services" });
      await db.update(users).set({ allowedServices: filtered }).where(eq(users.id, req.params.id));
      res.json({ success: true, allowedServices: filtered });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/add-funds", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { userId, amount } = req.body;
      if (!userId || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: "Valid userId and amount are required" });
      }
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role === "superadmin") return res.status(400).json({ error: "Cannot add funds to super admin" });

      const currentBalance = parseFloat(user.walletBalance || "0");
      const newBalance = currentBalance + parseFloat(amount);
      await storage.updateUserWalletBalance(userId, newBalance.toFixed(2));

      res.json({ success: true, newBalance: newBalance.toFixed(2) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/account-price", requireAuth, async (_req, res) => {
    try {
      const price = await getCostPerAccount();
      res.json({ price });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/browser-proxy", requireAuth, async (_req, res) => {
    try {
      const url = await getDefaultBrowserApiUrl();
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/browser-proxy", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string" || url.trim().length < 5) {
        return res.status(400).json({ error: "Valid proxy URL is required" });
      }
      await storage.setSetting("browser_proxy_url", url.trim());
      res.json({ success: true, url: url.trim() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/residential-proxy", requireAuth, async (_req, res) => {
    try {
      const url = await storage.getSetting("residential_proxy_url");
      res.json({ url: url || "" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/residential-proxy", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string" || url.trim().length < 5) {
        return res.status(400).json({ error: "Valid proxy URL is required" });
      }
      await storage.setSetting("residential_proxy_url", url.trim());
      res.json({ success: true, url: url.trim() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/zenrows-proxy", requireAuth, async (_req, res) => {
    try {
      const url = await storage.getSetting("zenrows_api_url");
      res.json({ url: url || "" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/zenrows-proxy", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string" || url.trim().length < 5) {
        return res.status(400).json({ error: "Valid ZenRows URL is required" });
      }
      await storage.setSetting("zenrows_api_url", url.trim());
      res.json({ success: true, url: url.trim() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/zenrows-api-key", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const key = await storage.getSetting("zenrows_rest_api_key");
      res.json({ key: key || "" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/zenrows-api-key", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { key } = req.body;
      if (!key || typeof key !== "string" || key.trim().length < 5) {
        return res.status(400).json({ error: "Valid ZenRows API key is required" });
      }
      const trimmedKey = key.trim();
      if (!/^[a-f0-9]{40,}$/.test(trimmedKey)) {
        return res.status(400).json({ error: "ZenRows API key format invalid. Expected 40+ char hex string (e.g. b00d07ad...). Got length=" + trimmedKey.length });
      }
      await storage.setSetting("zenrows_rest_api_key", trimmedKey);
      clearZenrowsApiKeyCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/capsolver-api-key", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const key = await storage.getSetting("capsolver_api_key");
      res.json({ key: key || "" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/capsolver-api-key", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { key } = req.body;
      if (!key || typeof key !== "string" || key.trim().length < 5) {
        return res.status(400).json({ error: "Valid CapSolver API key is required" });
      }
      await storage.setSetting("capsolver_api_key", key.trim());
      clearCapsolverApiKeyCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/gmail-email", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const email = await storage.getSetting("gmail_email");
      res.json({ email: email || "" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/gmail-email", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string" || !email.includes("@gmail.com")) {
        return res.status(400).json({ error: "A valid @gmail.com address is required" });
      }
      await storage.setSetting("gmail_email", email.trim().toLowerCase());
      const appPass = await storage.getSetting("gmail_app_password");
      setGmailCredentials(email.trim().toLowerCase(), appPass || null);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/settings/gmail-app-password", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const pass = await storage.getSetting("gmail_app_password");
      res.json({ password: pass ? `${pass.substring(0, 4)}****${pass.substring(pass.length - 4)}` : "" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/gmail-app-password", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || typeof password !== "string" || password.replace(/\s/g, "").length < 16) {
        return res.status(400).json({ error: "A valid Gmail App Password (16 chars) is required" });
      }
      const cleaned = password.replace(/\s/g, "");
      await storage.setSetting("gmail_app_password", cleaned);
      const gmailEmail = await storage.getSetting("gmail_email");
      setGmailCredentials(gmailEmail || null, cleaned);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/smspool/balance", requireAuth, async (_req, res) => {
    try {
      const result = await getSMSPoolBalance();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/capsolver/balance", requireAuth, async (_req, res) => {
    try {
      const result = await getCapSolverBalance();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/account-price", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { price } = req.body;
      const numPrice = parseFloat(price);
      if (isNaN(numPrice) || numPrice < 0.01 || numPrice > 100) {
        return res.status(400).json({ error: "Price must be between $0.01 and $100.00" });
      }
      await storage.setSetting("account_price", numPrice.toFixed(2));
      res.json({ success: true, price: numPrice.toFixed(2) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/payment-requests", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const requests = await storage.getAllPaymentRequests();
      const enriched = [];
      for (const r of requests) {
        const user = await storage.getUser(r.userId);
        enriched.push({
          ...r,
          userEmail: user?.email || "unknown",
          userName: user?.username || "unknown",
        });
      }
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/payment-requests/:id/approve", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const result = await storage.approvePaymentAtomic(req.params.id);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true, newBalance: result.newBalance });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/payment-requests/:id/reject", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      await storage.updatePaymentRequest(req.params.id, {
        status: "rejected",
        adminNote: req.body.note || "Rejected",
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/wallet", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ error: "User not found" });
    const payments = await storage.getPaymentRequestsByUser(user.id);
    res.json({
      balance: user.walletBalance,
      freeAccountsUsed: user.freeAccountsUsed,
      freeAccountLimit: FREE_ACCOUNT_LIMIT,
      trc20Address: TRC20_ADDRESS,
      whatsappNumber: WHATSAPP_NUMBER,
      payments,
    });
  });

  app.post("/api/wallet/payment-request", requireAuth, async (req, res) => {
    try {
      const { amount, txHash } = req.body;
      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: "Valid amount is required" });
      }
      const request = await storage.createPaymentRequest({
        userId: req.session.userId!,
        amount: parseFloat(amount).toFixed(2),
        txHash: txHash || null,
        status: "pending",
        adminNote: null,
      });
      res.json(request);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/create-batch", requireAuth, requireServiceAccess("la28"), async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { count = 1, country = "United States", language = "English", proxyList, concurrency: reqConcurrency } = req.body;
      const numAccounts = Math.max(1, parseInt(count));

      const costPerAccount = await getCostPerAccount();
      const walletBalance = parseFloat(user.walletBalance || "0");
      const requiredBalance = numAccounts * costPerAccount;
      if (walletBalance < requiredBalance) {
        return res.status(403).json({
          error: `Insufficient balance. You need $${requiredBalance.toFixed(2)} for ${numAccounts} accounts. Your wallet balance is $${walletBalance.toFixed(2)}.`,
          walletBalance,
          required: requiredBalance,
        });
      }
      const debited = await storage.debitWallet(userId, requiredBalance);
      if (!debited) {
        return res.status(403).json({
          error: "Failed to debit wallet. Insufficient balance.",
        });
      }

      const batchId = randomUUID();
      const useGmail = hasGmailCredentials();
      const batchDomain = useGmail ? null : await getAvailableDomain();

      const created: any[] = [];
      for (let i = 0; i < numAccounts; i++) {
        const fn = randomFrom(FIRST_NAMES);
        const ln = randomFrom(LAST_NAMES);
        const pw = generatePassword();
        const username = generateRandomUsername();
        const addisonEmail = useGmail ? createGmailAddress() : `${username}@${batchDomain}`;
        const addisonEmailPassword = "TempPass123!";

        const account = await storage.createAccount({
          email: addisonEmail,
          emailPassword: addisonEmailPassword,
          firstName: fn,
          lastName: ln,
          la28Password: pw,
          country,
          language,
          status: "pending",
          batchId,
          ownerId: userId,
          platform: "la28",
          verificationCode: null,
          errorMessage: null,
        });

        created.push(account);
      }

      batchOwners.set(batchId, userId);
      res.json({ batchId, accounts: created, count: numAccounts });

      const proxies = await getDefaultProxies(proxyList);

      const CONCURRENCY = Math.min(Math.max(parseInt(reqConcurrency) || 5, 1), 10);
      (async () => {
        const emailCreated: Set<string> = new Set();
        if (useGmail) {
          broadcastLog(batchId, "system", `📬 Gmail mode: ${created.length} Gmail+ addresses ready (no pre-creation needed)...`, userId);
          created.forEach(acc => emailCreated.add(acc.id));
        } else {
          broadcastLog(batchId, "system", `⚡ Pre-creating ${created.length} emails (concurrency: ${CONCURRENCY})...`, userId);
          const EMAIL_BATCH = 5;
          for (let i = 0; i < created.length; i += EMAIL_BATCH) {
            if (cancelledBatches.has(batchId)) break;
            const emailChunk = created.slice(i, i + EMAIL_BATCH);
            await Promise.all(emailChunk.map(async (acc) => {
              try {
                await createTempEmail(acc.email, acc.emailPassword);
                emailCreated.add(acc.id);
              } catch (err: any) {
                broadcastLog(batchId, acc.id, `Email setup failed: ${err.message.substring(0, 60)}`, userId);
              }
            }));
          }
        }
        broadcastLog(batchId, "system", `✅ ${emailCreated.size}/${created.length} emails ready. Starting registrations...`, userId);

        for (let i = 0; i < created.length; i += CONCURRENCY) {
          if (cancelledBatches.has(batchId)) {
            broadcastLog(batchId, "system", `Batch stopped. Skipped ${created.length - i} remaining accounts.`, userId);
            break;
          }
          const chunk = created.slice(i, i + CONCURRENCY);
          await Promise.all(chunk.map((acc, j) => {
            if (cancelledBatches.has(batchId)) return Promise.resolve();
            const baseProxy = proxies[(i + j) % proxies.length];
            const proxy = uniqueProxySession(baseProxy);
            const staggerDelay = j * 3000;
            return new Promise<void>((resolve) => {
              setTimeout(async () => {
                broadcastLog(batchId, acc.id, `Starting registration for ${acc.firstName} ${acc.lastName}...`, userId);
                await processAccountWithToken(
                  acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
                  acc.country, acc.language, acc.email, acc.emailPassword, userId, proxy,
                  emailCreated.has(acc.id) ? "pre-created" : undefined
                );
                resolve();
              }, staggerDelay);
            });
          }));
        }

        if (!cancelledBatches.has(batchId)) {
          const MAX_BATCH_RETRIES = 3;
          for (let retryRound = 1; retryRound <= MAX_BATCH_RETRIES; retryRound++) {
            const failedAccounts: typeof created = [];
            for (const acc of created) {
              const current = await storage.getAccount(acc.id);
              if (current && current.status === "failed") {
                failedAccounts.push(acc);
              }
            }
            if (failedAccounts.length === 0) break;
            if (cancelledBatches.has(batchId)) break;

            broadcastLog(batchId, "system", `🔄 Auto-retry round ${retryRound}/${MAX_BATCH_RETRIES}: ${failedAccounts.length} failed account(s)...`, userId);
            await new Promise(r => setTimeout(r, 5000));

            for (const acc of failedAccounts) {
              if (cancelledBatches.has(batchId)) break;
              await storage.updateAccount(acc.id, { status: "pending" as any, errorMessage: null });
              broadcastLog(batchId, acc.id, `🔄 Retry ${retryRound}: Retrying registration...`, userId);

              let emailReady = useGmail;
              if (!useGmail) {
                try {
                  await createTempEmail(acc.email, acc.emailPassword);
                  emailReady = true;
                } catch (emailErr: any) {
                  broadcastLog(batchId, acc.id, `Email re-setup failed: ${emailErr.message.substring(0, 60)}`, userId);
                }
              }

              const baseProxy = proxies[failedAccounts.indexOf(acc) % proxies.length];
              const proxy = uniqueProxySession(baseProxy);
              await processAccountWithToken(
                acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
                acc.country, acc.language, acc.email, acc.emailPassword, userId, proxy,
                emailReady ? "pre-created" : undefined
              );

              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }

        broadcastBatchComplete(batchId, userId);
        cancelledBatches.delete(batchId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/create-single", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const costPerAccount = await getCostPerAccount();
      const walletBalance = parseFloat(user.walletBalance || "0");
      if (walletBalance < costPerAccount) {
        return res.status(403).json({
          error: `Insufficient balance. Add funds to your wallet to continue. Balance: $${walletBalance.toFixed(2)}`,
        });
      }
      const debited = await storage.debitWallet(userId, costPerAccount);
      if (!debited) {
        return res.status(403).json({ error: "Failed to debit wallet. Insufficient balance." });
      }

      const { firstName, lastName, password, country = "United States", language = "English", proxyList } = req.body;
      if (!firstName || !lastName || !password) {
        return res.status(400).json({ error: "firstName, lastName, and password are required" });
      }

      const proxies = await getDefaultProxies(proxyList);
      const baseProxy = proxies[Math.floor(Math.random() * proxies.length)];
      const resolvedProxy = uniqueProxySession(baseProxy);

      const domain = await getAvailableDomain();
      const username = generateRandomUsername();
      const addisonEmail = `${username}@${domain}`;
      const addisonEmailPassword = "TempPass123!";
      const batchId = randomUUID();

      const account = await storage.createAccount({
        email: addisonEmail,
        emailPassword: addisonEmailPassword,
        firstName,
        lastName,
        la28Password: password,
        country,
        language,
        status: "pending",
        batchId,
        ownerId: userId,
        platform: "la28",
        verificationCode: null,
        errorMessage: null,
      });

      res.json({ batchId, account });

      (async () => {
        await processAccount(
          account.id, batchId, firstName, lastName, password,
          country, language, addisonEmail, addisonEmailPassword, userId, resolvedProxy
        );
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/register", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const costPerAccount = await getCostPerAccount();
      const walletBalance = parseFloat(user.walletBalance || "0");
      if (walletBalance < costPerAccount) {
        return res.status(403).json({
          error: `Insufficient balance. Add funds to your wallet to continue. Balance: $${walletBalance.toFixed(2)}`,
        });
      }
      const { firstName, lastName, password, country = "United States", language = "English" } = req.body;
      if (!firstName || typeof firstName !== "string" || firstName.trim().length < 1 || firstName.trim().length > 50) {
        return res.status(400).json({ error: "firstName is required (1-50 characters)" });
      }
      if (!lastName || typeof lastName !== "string" || lastName.trim().length < 1 || lastName.trim().length > 50) {
        return res.status(400).json({ error: "lastName is required (1-50 characters)" });
      }
      if (!password || typeof password !== "string" || password.trim().length < 8 || password.trim().length > 64) {
        return res.status(400).json({ error: "password is required (8-64 characters)" });
      }

      const cleanFirstName = firstName.trim().replace(/[^a-zA-Z\s'-]/g, "").slice(0, 50);
      const cleanLastName = lastName.trim().replace(/[^a-zA-Z\s'-]/g, "").slice(0, 50);
      const cleanPassword = password.trim();
      const cleanCountry = (typeof country === "string" ? country.trim() : "United States").slice(0, 50);
      const cleanLanguage = (typeof language === "string" ? language.trim() : "English").slice(0, 30);

      const debited = await storage.debitWallet(userId, costPerAccount);
      if (!debited) {
        return res.status(403).json({ error: "Failed to debit wallet. Insufficient balance." });
      }

      const domain = await getAvailableDomain();
      const username = generateRandomUsername();
      const addisonEmail = `${username}@${domain}`;
      const addisonEmailPassword = "TempPass123!";
      const batchId = randomUUID();

      const account = await storage.createAccount({
        email: addisonEmail,
        emailPassword: addisonEmailPassword,
        firstName: cleanFirstName,
        lastName: cleanLastName,
        la28Password: cleanPassword,
        country: cleanCountry,
        language: cleanLanguage,
        status: "pending",
        batchId,
        ownerId: userId,
        platform: "la28",
        verificationCode: null,
        errorMessage: null,
      });

      res.json({ batchId, account: { id: account.id, email: account.email, firstName: account.firstName, lastName: account.lastName, status: account.status } });

      (async () => {
        await processAccount(
          account.id, batchId, cleanFirstName, cleanLastName, cleanPassword,
          cleanCountry, cleanLanguage, addisonEmail, addisonEmailPassword, userId, (await getDefaultBrowserApiUrl()) || ""
        );
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/registrations", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const role = req.session.role;
    const all = role === "superadmin"
      ? await storage.getAllAccounts()
      : await storage.getAccountsByOwner(userId);
    const safe = all.map(a => ({
      id: a.id,
      email: a.email,
      firstName: a.firstName,
      lastName: a.lastName,
      la28Password: a.la28Password,
      country: a.country,
      language: a.language,
      status: a.status,
      verificationCode: a.verificationCode,
      errorMessage: a.errorMessage,
      createdAt: a.createdAt,
    }));
    res.json(safe);
  });

  app.get("/api/accounts", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const role = req.session.role;
    const all = role === "superadmin"
      ? await storage.getAllAccounts()
      : await storage.getAccountsByOwner(userId);
    res.json(all);
  });

  app.get("/api/accounts/stats", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const role = req.session.role;
    const stats = role === "superadmin"
      ? await storage.getAccountStats()
      : await storage.getAccountStats(userId);
    res.json(stats);
  });

  app.get("/api/accounts/:id", requireAuth, async (req, res) => {
    const account = await storage.getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Not found" });
    if (req.session.role !== "superadmin" && account.ownerId !== req.session.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json(account);
  });

  app.put("/api/accounts/:id/toggle-used", requireAuth, async (req, res) => {
    const account = await storage.getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Not found" });
    if (req.session.role !== "superadmin" && account.ownerId !== req.session.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    await storage.updateAccountUsed(req.params.id, !account.isUsed);
    const updated = await storage.getAccount(req.params.id);
    res.json(updated);
  });

  app.post("/api/accounts/fix-draw-status", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const result = await db.execute(sql`UPDATE accounts SET status = 'completed' WHERE status = 'draw_registering' RETURNING id, temp_email`);
      const fixed = result.rows || [];
      res.json({ success: true, fixed: fixed.length, accounts: fixed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/accounts/:id/retry-draw", requireAuth, async (req, res) => {
    const account = await storage.getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (req.session.role !== "superadmin" && account.ownerId !== req.session.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (account.platform !== "la28") {
      return res.status(400).json({ error: "Retry draw is only available for LA28 accounts" });
    }
    if (!["verified", "profile_saving", "draw_registering"].includes(account.status || "")) {
      return res.status(400).json({ error: `Account status '${account.status}' is not eligible for draw retry. Must be verified, profile_saving, or draw_registering.` });
    }
    if (!account.email || !account.la28Password) {
      return res.status(400).json({ error: "Account is missing email or password credentials required for draw retry." });
    }

    const batchId = account.batchId || account.id;
    const log = (msg: string) => {
      broadcastLog(batchId, account.id, msg, account.ownerId || undefined);
    };

    res.json({ success: true, message: "Draw retry started", accountId: account.id });

    try {
      await storage.updateAccount(account.id, { status: "draw_registering" });
      broadcastAccountUpdate({ ...account, status: "draw_registering" }, account.ownerId || undefined);
      log("Retrying draw registration via Chromium + Residential Proxy...");

      const gigyaResult = await completeDrawViaGigyaBrowser(
        account.email,
        account.la28Password,
        account.zipCode || undefined,
        log
      );

      if (gigyaResult.success || gigyaResult.profileSet || gigyaResult.dataSet) {
        await storage.updateAccount(account.id, { status: "completed" });
        broadcastAccountUpdate({ ...account, status: "completed" }, account.ownerId || undefined);
        if (gigyaResult.success) {
          log("Draw registration completed successfully!");
        } else {
          log("Partial success (profile=" + gigyaResult.profileSet + " data=" + gigyaResult.dataSet + "). Marked as completed.");
        }
        try {
          const emailPassword = account.emailPassword || account.la28Password;
          if (account.email && emailPassword) {
            log("📧 Checking inbox for LA28 draw confirmation email...");
            const drawProvider = detectProviderFromDomain(account.email.split("@")[1] || "");
            const confirmed = await pollForDrawConfirmation(account.email, emailPassword, drawProvider, 20, 5000);
            if (confirmed) {
              log("✅ Draw confirmation email received! Registration verified by LA28.");
            } else {
              log("⚠️ Draw confirmation email not found yet. Draw was submitted but email not received within timeout.");
            }
          }
        } catch (confirmErr: any) {
          log("⚠️ Could not check for confirmation email: " + confirmErr.message);
        }
      } else {
        await storage.updateAccount(account.id, { status: "draw_registering" });
        broadcastAccountUpdate({ ...account, status: "draw_registering" }, account.ownerId || undefined);
        log("Draw registration failed: " + (gigyaResult.error || "unknown error") + ". Status kept as draw_registering for retry.");
      }
    } catch (err: any) {
      log("Draw retry error: " + err.message.substring(0, 200));
      await storage.updateAccount(account.id, { status: "draw_registering" });
      broadcastAccountUpdate({ ...account, status: "draw_registering" }, account.ownerId || undefined);
      log("Error during draw retry. Status kept as draw_registering.");
    }
  });

  app.get("/api/billing", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const role = req.session.role;
    const records = role === "superadmin"
      ? await storage.getAllBillingRecords()
      : await storage.getAllBillingRecords(userId);
    const total = role === "superadmin"
      ? await storage.getBillingTotal()
      : await storage.getBillingTotal(userId);
    res.json({ records, total });
  });

  app.get("/api/dashboard", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const role = req.session.role;
    const user = await storage.getUser(userId);
    const stats = role === "superadmin"
      ? await storage.getAccountStats()
      : await storage.getAccountStats(userId);
    const total = role === "superadmin"
      ? await storage.getBillingTotal()
      : await storage.getBillingTotal(userId);
    res.json({
      stats,
      billingTotal: total,
      freeAccountsUsed: user?.freeAccountsUsed || 0,
      freeAccountLimit: FREE_ACCOUNT_LIMIT,
      walletBalance: user?.walletBalance || "0.00",
      role,
    });
  });

  app.get("/api/earnings", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") {
      return res.status(403).json({ error: "Super admin only" });
    }
    const allUsers = await storage.getAllUsers();
    const allBilling = await storage.getAllBillingRecords();
    const allAccounts = await storage.getAllAccounts();
    const totalRevenue = await storage.getBillingTotal();
    const totalStats = await storage.getAccountStats();

    const adminBreakdown = await Promise.all(
      allUsers
        .filter(u => u.role === "admin")
        .map(async (admin) => {
          const adminBilling = await storage.getBillingTotal(admin.id);
          const adminStats = await storage.getAccountStats(admin.id);
          return {
            id: admin.id,
            username: admin.username,
            email: admin.email,
            walletBalance: admin.walletBalance,
            totalSpent: adminBilling,
            accounts: adminStats,
          };
        })
    );

    const platformMap: Record<string, { count: number; revenue: number }> = {};
    for (const record of allBilling) {
      const desc = record.description.toLowerCase();
      let platform = "Other";
      if (desc.includes("la28")) platform = "LA28";
      else if (desc.includes("uefa")) platform = "UEFA";
      else if (desc.includes("ticketmaster") || desc.includes("tm")) platform = "Ticketmaster";
      if (!platformMap[platform]) platformMap[platform] = { count: 0, revenue: 0 };
      platformMap[platform].count++;
      platformMap[platform].revenue += parseFloat(String(record.amount));
    }

    const recentTransactions = allBilling.slice(0, 20).map(b => {
      const user = allUsers.find(u => u.id === b.ownerId);
      return {
        id: b.id,
        description: b.description,
        amount: b.amount,
        adminName: user?.username || "Unknown",
        adminEmail: user?.email || "",
        createdAt: b.createdAt,
      };
    });

    res.json({
      totalRevenue,
      totalStats,
      totalAdmins: allUsers.filter(u => u.role === "admin").length,
      adminBreakdown,
      platformBreakdown: Object.entries(platformMap).map(([name, data]) => ({
        name,
        ...data,
      })),
      recentTransactions,
    });
  });

  app.get("/api/emails", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const role = req.session.role;
    const allAccounts = role === "superadmin"
      ? await storage.getAllAccounts()
      : await storage.getAccountsByOwner(userId);
    const emails = allAccounts.map(a => ({
      id: a.id,
      email: a.email,
      password: a.emailPassword,
      firstName: a.firstName,
      lastName: a.lastName,
      status: a.status,
      createdAt: a.createdAt,
    }));
    res.json(emails);
  });

  app.get("/api/batch-logs/:batchId", requireAuth, async (req, res) => {
    const batchId = req.params.batchId;
    const userId = req.session.userId!;
    const owner = batchOwners.get(batchId);
    if (owner && owner !== userId && req.session.role !== "superadmin") {
      return res.status(403).json({ error: "Access denied" });
    }
    const logs = batchLogs.get(batchId) || [];
    const since = parseInt(req.query.since as string) || 0;
    const filtered = logs.slice(since);
    const accounts = await storage.getAccountsByBatch(batchId);
    const isComplete = logs.some(l => l.message === "Batch complete") ||
      accounts.every(a => ["verified", "completed", "failed"].includes(a.status));
    res.json({
      logs: filtered,
      nextSince: logs.length,
      accounts: accounts.map(a => ({ id: a.id, email: a.email, firstName: a.firstName, lastName: a.lastName, status: a.status, errorMessage: a.errorMessage })),
      isComplete,
    });
  });

  app.post("/api/cancel-batch/:batchId", requireAuth, async (req, res) => {
    const batchId = req.params.batchId;
    const userId = req.session.userId!;
    const owner = batchOwners.get(batchId);
    if (owner && owner !== userId && req.session.role !== "superadmin") {
      return res.status(403).json({ error: "Access denied" });
    }
    cancelledBatches.add(batchId);
    broadcastLog(batchId, "system", `🛑 Batch cancelled by user`, userId);

    const accounts = await storage.getAccountsByBatch(batchId);
    let cancelled = 0;
    for (const acc of accounts) {
      if (acc.status === "pending") {
        await storage.updateAccount(acc.id, { status: "failed", errorMessage: "Cancelled by user" });
        const updated = await storage.getAccount(acc.id);
        if (updated) broadcastAccountUpdate(updated, userId);
        cancelled++;
      }
    }
    broadcastLog(batchId, "system", `Cancelled ${cancelled} pending accounts`, userId);
    broadcast({ type: "batch_complete", batchId }, userId);
    res.json({ success: true, cancelled });
  });

  app.get("/api/emails/:id/inbox", requireAuth, async (req, res) => {
    try {
      const account = await storage.getAccount(req.params.id);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (req.session.role !== "superadmin" && account.ownerId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const inboxProvider = detectProviderFromDomain(account.email.split("@")[1] || "");
      const inboxToken = await getAuthToken(account.email, account.emailPassword, inboxProvider);
      const messages = await fetchMessages(inboxToken, inboxProvider);

      const fullMessages = [];
      for (const msg of messages.slice(0, 20)) {
        const content = await fetchMessageContent(inboxToken, msg.id, inboxProvider);
        fullMessages.push({
          id: msg.id,
          from: msg.from?.address || "unknown",
          subject: msg.subject || "(no subject)",
          text: content,
          createdAt: msg.createdAt,
        });
      }

      res.json(fullMessages);
    } catch (err: any) {
      res.json([]);
    }
  });

  app.post("/api/temp-emails", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const domain = await getAvailableDomain();
      const username = generateRandomUsername();
      const address = `${username}@${domain}`;
      const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      await createTempEmail(address, password);
      const saved = await storage.createTempEmail({
        address,
        password,
        label: req.body.label || null,
        ownerId: userId,
      });
      res.json({ id: saved.id, address: saved.address, label: saved.label, ownerId: saved.ownerId, createdAt: saved.createdAt });
    } catch (err: any) {
      console.error("[TempEmail] Generate error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/temp-emails", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const role = req.session.role;
    const emails = role === "superadmin"
      ? await storage.getAllTempEmails()
      : await storage.getTempEmailsByOwner(userId);
    res.json(emails.map(e => ({ id: e.id, address: e.address, label: e.label, ownerId: e.ownerId, createdAt: e.createdAt })));
  });

  app.get("/api/temp-emails/:id/inbox", requireAuth, async (req, res) => {
    try {
      const te = await storage.getTempEmail(req.params.id);
      if (!te) return res.status(404).json({ error: "Not found" });
      if (req.session.role !== "superadmin" && te.ownerId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const teProvider = detectProviderFromDomain(te.address.split("@")[1] || "");
      const teToken = await getAuthToken(te.address, te.password, teProvider);
      const messages = await fetchMessages(teToken, teProvider);
      const fullMessages = [];
      for (const msg of messages.slice(0, 30)) {
        const content = await fetchMessageContent(teToken, msg.id, teProvider);
        const plainText = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        fullMessages.push({
          id: msg.id,
          from: msg.from?.address || msg.from?.name || "unknown",
          subject: msg.subject || "(no subject)",
          text: plainText,
          createdAt: msg.createdAt,
        });
      }
      res.json(fullMessages);
    } catch (err: any) {
      console.error("[TempEmail] Inbox error:", err.message);
      res.json([]);
    }
  });

  app.delete("/api/temp-emails/:id", requireAuth, async (req, res) => {
    try {
      const te = await storage.getTempEmail(req.params.id);
      if (!te) return res.status(404).json({ error: "Not found" });
      if (req.session.role !== "superadmin" && te.ownerId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteTempEmail(te.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  async function processTMAccount(
    accountId: string,
    batchId: string,
    firstName: string,
    lastName: string,
    password: string,
    addisonEmail: string,
    addisonEmailPassword: string,
    ownerId: string,
    proxyUrl?: string
  ) {
    try {
      broadcastLog(batchId, accountId, `Creating temp email: ${addisonEmail}`, ownerId);
      const { provider: tmEmailProvider } = await createTempEmail(addisonEmail, addisonEmailPassword);
      broadcastLog(batchId, accountId, `Email ready, starting TM registration...`, ownerId);

      const result = await tmFullRegistrationFlow(
        addisonEmail,
        firstName,
        lastName,
        password,
        async (status) => {
          const updated = await storage.updateAccount(accountId, { status: status as any });
          if (updated) broadcastAccountUpdate(updated, ownerId);
          broadcastLog(batchId, accountId, `Status: ${status}`, ownerId);
        },
        async () => {
          broadcastLog(batchId, accountId, `Polling for verification code...`, ownerId);
          const code = await pollForVerificationCode(addisonEmail, addisonEmailPassword, tmEmailProvider, 70, 3000);
          if (code) {
            await storage.updateAccount(accountId, { verificationCode: code });
            broadcastLog(batchId, accountId, `Got verification code: ${code}`, ownerId);
          } else {
            broadcastLog(batchId, accountId, `Timed out waiting for code`, ownerId);
          }
          return code;
        },
        (message) => {
          broadcastLog(batchId, accountId, message, ownerId);
        },
        proxyUrl
      );

      const smsCost = result.smsCost || 0;
      if (result.success) {
        const updated = await storage.updateAccount(accountId, { status: "verified" });
        if (updated) broadcastAccountUpdate(updated, ownerId);
        const smsNote = smsCost > 0 ? ` (SMS: $${smsCost.toFixed(2)})` : "";
        broadcastLog(batchId, accountId, `TM account verified successfully!${smsNote}`, ownerId);

        const tmBillingPrice = await getCostPerAccount();
        await storage.createBillingRecord({
          accountId,
          amount: (tmBillingPrice + smsCost).toFixed(2),
          description: `TM Account: ${firstName} ${lastName} (${addisonEmail})${smsNote}`,
          ownerId,
        });

        const user = await storage.getUser(ownerId);
        if (user) {
          await storage.updateUserFreeAccountsUsed(ownerId, user.freeAccountsUsed + 1);
        }
      } else {
        const costPerAccount = await getCostPerAccount();
        const totalRefund = costPerAccount + smsCost;
        await storage.creditWallet(ownerId, totalRefund);
        const refundBreakdown = smsCost > 0
          ? `Refunded $${totalRefund.toFixed(2)} (account $${costPerAccount.toFixed(2)} + SMS $${smsCost.toFixed(2)})`
          : `Refunded $${costPerAccount.toFixed(2)} for failed account`;
        broadcastLog(batchId, accountId, refundBreakdown, ownerId);
        const updated = await storage.updateAccount(accountId, { status: "failed", errorMessage: result.error || "Failed" });
        if (updated) broadcastAccountUpdate(updated, ownerId);
        broadcastLog(batchId, accountId, `Failed: ${result.error}`, ownerId);
      }
    } catch (err: any) {
      const costPerAccount = await getCostPerAccount();
      await storage.creditWallet(ownerId, costPerAccount);
      broadcastLog(batchId, accountId, `Refunded $${costPerAccount.toFixed(2)} for failed account`, ownerId);
      const updated = await storage.updateAccount(accountId, { status: "failed", errorMessage: err.message });
      if (updated) broadcastAccountUpdate(updated, ownerId);
      broadcastLog(batchId, accountId, `Error: ${err.message}`, ownerId);
    }
  }

  app.post("/api/tm-create-batch", requireAuth, requireServiceAccess("ticketmaster"), async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { count = 1 } = req.body;
      const numAccounts = Math.max(1, parseInt(count));
      const baseProxyUrl = req.body.proxyUrl || (await getDefaultBrowserApiUrl()) || "";

      const costPerAccount = await getCostPerAccount();
      const walletBalance = parseFloat(user.walletBalance || "0");
      const requiredBalance = numAccounts * costPerAccount;
      if (walletBalance < requiredBalance) {
        return res.status(403).json({
          error: `Insufficient balance. You need $${requiredBalance.toFixed(2)} for ${numAccounts} accounts. Balance: $${walletBalance.toFixed(2)}.`,
          walletBalance,
          required: requiredBalance,
        });
      }
      const debited = await storage.debitWallet(userId, requiredBalance);
      if (!debited) {
        return res.status(403).json({ error: "Failed to debit wallet. Insufficient balance." });
      }

      const batchId = randomUUID();
      const domain = await getMailTmOnlyDomain();

      const created: any[] = [];
      for (let i = 0; i < numAccounts; i++) {
        const fn = randomFrom(FIRST_NAMES);
        const ln = randomFrom(LAST_NAMES);
        const pw = generatePassword();
        const username = generateRandomUsername();
        const addisonEmail = `${username}@${domain}`;
        const addisonEmailPassword = "TempPass123!";

        const account = await storage.createAccount({
          email: addisonEmail,
          emailPassword: addisonEmailPassword,
          firstName: fn,
          lastName: ln,
          la28Password: pw,
          country: "United States",
          language: "English",
          status: "pending",
          batchId,
          ownerId: userId,
          platform: "ticketmaster",
          verificationCode: null,
          errorMessage: null,
        });

        created.push(account);
      }

      batchOwners.set(batchId, userId);
      res.json({ batchId, accounts: created, count: numAccounts });

      (async () => {
        for (const acc of created) {
          const proxyUrl = uniqueProxySession(baseProxyUrl);
          broadcastLog(batchId, acc.id, `Starting TM registration for ${acc.firstName} ${acc.lastName}...`, userId);
          await processTMAccount(
            acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
            acc.email, acc.emailPassword, userId, proxyUrl
          );

          const afterAccount = await storage.getAccount(acc.id);
          if (afterAccount && afterAccount.status === "failed") {
            const retryProxy = uniqueProxySession(baseProxyUrl);
            broadcastLog(batchId, acc.id, `Retrying with new email address...`, userId);
            const retryDomain = await getMailTmOnlyDomain();
            const retryUsername = generateRandomUsername();
            const retryEmail = `${retryUsername}@${retryDomain}`;
            await storage.updateAccount(acc.id, { email: retryEmail, status: "pending", errorMessage: null } as any);
            broadcastAccountUpdate({ ...afterAccount, email: retryEmail, status: "pending" }, userId);
            broadcastLog(batchId, acc.id, `Retry with new email: ${retryEmail}`, userId);
            const reDebited = await storage.debitWallet(userId, await getCostPerAccount());
            if (!reDebited) {
              broadcastLog(batchId, acc.id, `Insufficient balance for retry, skipping.`, userId);
              continue;
            }
            await processTMAccount(
              acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
              retryEmail, "TempPass123!", userId, retryProxy
            );
          }
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  async function processUEFAAccount(
    accountId: string,
    batchId: string,
    firstName: string,
    lastName: string,
    password: string,
    addisonEmail: string,
    addisonEmailPassword: string,
    ownerId: string,
    proxyUrl?: string
  ) {
    try {
      broadcastLog(batchId, accountId, `Creating temp email: ${addisonEmail}`, ownerId);
      const { provider: uefaEmailProvider } = await createTempEmail(addisonEmail, addisonEmailPassword);
      broadcastLog(batchId, accountId, `Email ready, starting UEFA registration...`, ownerId);

      const result = await uefaFullRegistrationFlow(
        addisonEmail,
        firstName,
        lastName,
        password,
        async (status) => {
          const updated = await storage.updateAccount(accountId, { status: status as any });
          if (updated) broadcastAccountUpdate(updated, ownerId);
          broadcastLog(batchId, accountId, `Status: ${status}`, ownerId);
        },
        async () => {
          broadcastLog(batchId, accountId, `Polling for verification code...`, ownerId);
          const code = await pollForVerificationCode(addisonEmail, addisonEmailPassword, uefaEmailProvider, 70, 3000);
          if (code) {
            await storage.updateAccount(accountId, { verificationCode: code });
            broadcastLog(batchId, accountId, `Got verification code: ${code}`, ownerId);
          } else {
            broadcastLog(batchId, accountId, `Timed out waiting for code`, ownerId);
          }
          return code;
        },
        proxyUrl
      );

      if (result.success) {
        const updated = await storage.updateAccount(accountId, { status: "verified" });
        if (updated) broadcastAccountUpdate(updated, ownerId);
        broadcastLog(batchId, accountId, `UEFA account verified successfully!`, ownerId);

        const uefaBillingPrice = await getCostPerAccount();
        await storage.createBillingRecord({
          accountId,
          amount: uefaBillingPrice.toFixed(2),
          description: `UEFA Account: ${firstName} ${lastName} (${addisonEmail})`,
          ownerId,
        });

        const user = await storage.getUser(ownerId);
        if (user) {
          await storage.updateUserFreeAccountsUsed(ownerId, user.freeAccountsUsed + 1);
        }
      } else {
        const updated = await storage.updateAccount(accountId, { status: "failed", errorMessage: result.error || "Failed" });
        if (updated) broadcastAccountUpdate(updated, ownerId);
        broadcastLog(batchId, accountId, `Failed: ${result.error}`, ownerId);
      }
    } catch (err: any) {
      const updated = await storage.updateAccount(accountId, { status: "failed", errorMessage: err.message });
      if (updated) broadcastAccountUpdate(updated, ownerId);
      broadcastLog(batchId, accountId, `Error: ${err.message}`, ownerId);
    }
  }

  app.post("/api/uefa-create-batch", requireAuth, requireServiceAccess("uefa"), async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { count = 1 } = req.body;
      const numAccounts = Math.max(1, parseInt(count));

      const costPerAccount = await getCostPerAccount();
      const walletBalance = parseFloat(user.walletBalance || "0");
      const requiredBalance = numAccounts * costPerAccount;
      if (walletBalance < requiredBalance) {
        return res.status(403).json({
          error: `Insufficient balance. You need $${requiredBalance.toFixed(2)} for ${numAccounts} accounts. Balance: $${walletBalance.toFixed(2)}.`,
          walletBalance,
          required: requiredBalance,
        });
      }
      const debited = await storage.debitWallet(userId, requiredBalance);
      if (!debited) {
        return res.status(403).json({ error: "Failed to debit wallet. Insufficient balance." });
      }

      const batchId = randomUUID();
      const domain = await getAvailableDomain();

      const created: any[] = [];
      for (let i = 0; i < numAccounts; i++) {
        const fn = randomFrom(FIRST_NAMES);
        const ln = randomFrom(LAST_NAMES);
        const pw = generatePassword();
        const username = generateRandomUsername();
        const addisonEmail = `${username}@${domain}`;
        const addisonEmailPassword = "TempPass123!";

        const account = await storage.createAccount({
          email: addisonEmail,
          emailPassword: addisonEmailPassword,
          firstName: fn,
          lastName: ln,
          la28Password: pw,
          country: "Europe",
          language: "English",
          status: "pending",
          batchId,
          ownerId: userId,
          platform: "uefa",
          verificationCode: null,
          errorMessage: null,
        });

        created.push(account);
      }

      const baseProxyUrl = req.body.proxyUrl || (await getDefaultBrowserApiUrl()) || "";

      batchOwners.set(batchId, userId);
      res.json({ batchId, accounts: created, count: numAccounts });

      (async () => {
        for (const acc of created) {
          const proxyUrl = uniqueProxySession(baseProxyUrl);
          broadcastLog(batchId, acc.id, `Starting UEFA registration for ${acc.firstName} ${acc.lastName}...`, userId);
          await processUEFAAccount(
            acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
            acc.email, acc.emailPassword, userId, proxyUrl
          );
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/brunomars-create-batch", requireAuth, requireServiceAccess("brunomars"), async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { count = 1 } = req.body;
      const parsed = parseInt(count);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        return res.status(400).json({ error: "Count must be between 1 and 100" });
      }
      const numAccounts = parsed;
      const baseProxyUrl = req.body.proxyUrl || (await getDefaultBrowserApiUrl()) || "";

      const costPerAccount = await getCostPerAccount();
      const walletBalance = parseFloat(user.walletBalance || "0");
      const requiredBalance = numAccounts * costPerAccount;
      if (walletBalance < requiredBalance) {
        return res.status(403).json({
          error: `Insufficient balance. You need $${requiredBalance.toFixed(2)} for ${numAccounts} accounts. Balance: $${walletBalance.toFixed(2)}.`,
          walletBalance,
          required: requiredBalance,
        });
      }
      const debited = await storage.debitWallet(userId, requiredBalance);
      if (!debited) {
        return res.status(403).json({ error: "Failed to debit wallet. Insufficient balance." });
      }

      const batchId = randomUUID();
      const domain = await getAvailableDomain();

      const created: any[] = [];
      for (let i = 0; i < numAccounts; i++) {
        const fn = randomFrom(FIRST_NAMES);
        const ln = randomFrom(LAST_NAMES);
        const pw = generatePassword();
        const username = generateRandomUsername();
        const addisonEmail = `${username}@${domain}`;
        const addisonEmailPassword = "TempPass123!";

        const account = await storage.createAccount({
          email: addisonEmail,
          emailPassword: addisonEmailPassword,
          firstName: fn,
          lastName: ln,
          la28Password: pw,
          country: "United States",
          language: "English",
          status: "pending",
          batchId,
          ownerId: userId,
          platform: "brunomars",
          verificationCode: null,
          errorMessage: null,
        });

        created.push(account);
      }

      batchOwners.set(batchId, userId);
      res.json({ batchId, accounts: created, count: numAccounts });

      (async () => {
        for (const acc of created) {
          const proxyUrl = uniqueProxySession(baseProxyUrl);
          broadcastLog(batchId, acc.id, `Starting TM + Bruno Mars flow for ${acc.firstName} ${acc.lastName}...`, userId);

          let tmSuccess = false;
          let tmBrowser: any = null;
          let tmPage: any = null;
          try {
            broadcastLog(batchId, acc.id, `📧 Phase 1: Creating TM account...`, userId);
            broadcastLog(batchId, acc.id, `Creating temp email: ${acc.email}`, userId);
            const { provider: brunoEmailProvider } = await createTempEmail(acc.email, acc.emailPassword);
            broadcastLog(batchId, acc.id, `Email ready, starting TM registration...`, userId);

            const tmResult = await tmFullRegistrationFlow(
              acc.email,
              acc.firstName,
              acc.lastName,
              acc.la28Password,
              async (status) => {
                const updated = await storage.updateAccount(acc.id, { status: status as any });
                if (updated) broadcastAccountUpdate(updated, userId);
                broadcastLog(batchId, acc.id, `Status: ${status}`, userId);
              },
              async () => {
                broadcastLog(batchId, acc.id, `Polling for verification code...`, userId);
                const code = await pollForVerificationCode(acc.email, acc.emailPassword, brunoEmailProvider, 70, 3000);
                if (code) {
                  await storage.updateAccount(acc.id, { verificationCode: code });
                  broadcastLog(batchId, acc.id, `Got verification code: ${code}`, userId);
                } else {
                  broadcastLog(batchId, acc.id, `Timed out waiting for code`, userId);
                }
                return code;
              },
              (message) => {
                broadcastLog(batchId, acc.id, message, userId);
              },
              proxyUrl,
              true
            );

            const smsCost = tmResult.smsCost || 0;
            if (tmResult.success) {
              tmSuccess = true;
              tmBrowser = tmResult.browser || null;
              tmPage = tmResult.page || null;
              await storage.updateAccount(acc.id, { status: "verified" });
              broadcastAccountUpdate({ ...acc, status: "verified" }, userId);
              const smsNote = smsCost > 0 ? ` (SMS: $${smsCost.toFixed(2)})` : "";
              broadcastLog(batchId, acc.id, `✅ TM account verified!${smsNote} Moving to presale signup...`, userId);
            } else {
              broadcastLog(batchId, acc.id, `❌ TM account creation failed: ${tmResult.error}`, userId);
              await storage.updateAccount(acc.id, { status: "failed", errorMessage: `TM: ${tmResult.error}` });
              broadcastAccountUpdate({ ...acc, status: "failed" }, userId);
              await storage.creditWallet(userId, costPerAccount);
              continue;
            }
          } catch (tmErr: any) {
            broadcastLog(batchId, acc.id, `❌ TM account error: ${tmErr.message?.substring(0, 150)}`, userId);
            await storage.updateAccount(acc.id, { status: "failed", errorMessage: tmErr.message });
            broadcastAccountUpdate({ ...acc, status: "failed" }, userId);
            await storage.creditWallet(userId, costPerAccount);
            continue;
          }

          if (!tmSuccess) continue;

          try {
            if (!tmPage || !tmBrowser) {
              broadcastLog(batchId, acc.id, `⚠️ No active browser session from TM registration, opening fresh session for presale...`, userId);
            }
            broadcastLog(batchId, acc.id, `🎵 Phase 2: Bruno Mars presale signup...`, userId);
            const bmResult = await brunoMarsPresaleStep(
              tmPage,
              tmBrowser,
              (msg) => broadcastLog(batchId, acc.id, msg, userId),
              async (status) => {
                await storage.updateAccount(acc.id, { status });
                broadcastAccountUpdate({ ...acc, status }, userId);
              },
              proxyUrl
            );
            if (bmResult.success) {
              await storage.updateAccount(acc.id, { status: "completed" });
              broadcastAccountUpdate({ ...acc, status: "completed" }, userId);
              broadcastLog(batchId, acc.id, "✅ Full flow complete! TM account created + Bruno Mars presale signed up!", userId);
              await storage.createBillingRecord({
                accountId: acc.id,
                amount: String(costPerAccount),
                description: `TM + Bruno Mars: ${acc.firstName} ${acc.lastName} (${acc.email})`,
                ownerId: userId,
              });
            } else {
              await storage.updateAccount(acc.id, { status: "failed", errorMessage: `Presale: ${bmResult.error}` });
              broadcastAccountUpdate({ ...acc, status: "failed" }, userId);
              broadcastLog(batchId, acc.id, `❌ Presale signup failed: ${bmResult.error}`, userId);
              await storage.creditWallet(userId, costPerAccount);
            }
          } catch (bmErr: any) {
            await storage.updateAccount(acc.id, { status: "failed", errorMessage: bmErr.message });
            broadcastAccountUpdate({ ...acc, status: "failed" }, userId);
            broadcastLog(batchId, acc.id, `❌ Presale error: ${bmErr.message?.substring(0, 200)}`, userId);
            await storage.creditWallet(userId, costPerAccount);
          }
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook-create", requireAuth, requireServiceAccess("outlook"), async (req: Request, res: Response) => {
    try {
      const { count } = req.body;
      const total = Math.min(Math.max(parseInt(count) || 1, 1), 10);

      const userId = req.session.userId;
      const batchId = `outlook-create-${randomUUID().substring(0, 8)}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, batchId, count: total, message: `Creating ${total} Outlook account(s)` });

      (async () => {
        const results: Array<{ email: string; password: string }> = [];
        for (let i = 0; i < total; i++) {
          const accountNum = `${i + 1}/${total}`;
          broadcastLog(batchId, `acc-${i}`, `[${accountNum}] Creating Outlook account...`, userId);
          try {
            const result = await createOutlookAccount(
              (msg) => broadcastLog(batchId, `acc-${i}`, `[${accountNum}] ${msg}`, userId)
            );
            if (result.success && result.email && result.password) {
              results.push({ email: result.email, password: result.password });
              try {
                await storage.createPrivateOutlook({ email: result.email, password: result.password, status: "active", createdBy: userId });
              } catch (saveErr: any) {}
              broadcastLog(batchId, `acc-${i}`, `[${accountNum}] Account created: ${result.email}`, userId);
              broadcast({ type: "outlook_create_result", batchId, index: i, success: true, email: result.email, password: result.password }, userId);
            } else {
              broadcastLog(batchId, `acc-${i}`, `[${accountNum}] Failed: ${result.error || "Unknown error"}`, userId);
              broadcast({ type: "outlook_create_result", batchId, index: i, success: false, error: result.error }, userId);
            }
          } catch (err: any) {
            broadcastLog(batchId, `acc-${i}`, `[${accountNum}] Error: ${(err.message || "").substring(0, 150)}`, userId);
            broadcast({ type: "outlook_create_result", batchId, index: i, success: false, error: err.message }, userId);
          }
        }
        broadcastLog(batchId, "summary", `Completed: ${results.length}/${total} accounts created`, userId);
        broadcast({ type: "outlook_create_complete", batchId, total, created: results.length, accounts: results }, userId);
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook-login", requireAuth, requireServiceAccess("outlook"), async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const userId = req.session.userId;
      const loginId = randomUUID().substring(0, 8);
      const batchId = `outlook-${loginId}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, loginId, batchId, message: "Outlook login started" });

      (async () => {
        broadcastLog(batchId, loginId, `Starting Outlook login for ${email}...`, userId);
        try {
          const result = await loginOutlookAccount(
            email,
            password,
            (msg) => broadcastLog(batchId, loginId, msg, userId)
          );

          if (result.success) {
            broadcastLog(batchId, loginId, `Login successful! Got ${result.cookies?.length || 0} session cookies`, userId);
            broadcast({ type: "outlook_login_result", loginId, batchId, success: true, cookies: result.cookies || [], cookieCount: result.cookies?.length || 0 }, userId);
          } else {
            broadcastLog(batchId, loginId, `Login failed: ${result.error || "Unknown error"}`, userId);
            broadcast({ type: "outlook_login_result", loginId, batchId, success: false, error: result.error }, userId);
          }
        } catch (err: any) {
          broadcastLog(batchId, loginId, `Error: ${(err.message || "").substring(0, 150)}`, userId);
          broadcast({ type: "outlook_login_result", loginId, batchId, success: false, error: err.message }, userId);
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/zenrows-register", requireAuth, requireServiceAccess("zenrows"), async (req: Request, res: Response) => {
    try {
      const { outlookEmail, outlookPassword, zenrowsPassword } = req.body;

      const userId = req.session.userId;
      const regId = randomUUID().substring(0, 8);
      const batchId = `zenrows-reg-${regId}`;

      batchOwners.set(batchId, userId);
      const mode = zenrowsPassword ? "login + phone verify" : outlookEmail && outlookPassword ? "existing Outlook account" : "auto-create Outlook account";
      res.json({ success: true, regId, batchId, message: `Proxy registration started (${mode})` });

      (async () => {
        broadcastLog(batchId, regId, `Starting proxy account registration flow (${mode})...`, userId);
        try {
          const result = await registerZenrowsAccount(
            outlookEmail || null,
            outlookPassword || null,
            (msg) => broadcastLog(batchId, regId, msg, userId),
            zenrowsPassword || null
          );

          if (result.success && result.apiKey) {
            broadcastLog(batchId, regId, `Proxy API Key extracted successfully`, userId);
            try {
              const caller = await storage.getUser(userId);
              if (caller && caller.role === "superadmin" && /^[a-f0-9]{40}$/.test(result.apiKey)) {
                await storage.setSetting("zenrows_rest_api_key", result.apiKey);
                clearZenrowsApiKeyCache();
                broadcastLog(batchId, regId, `API key auto-saved to settings (length=${result.apiKey.length})`, userId);
              } else if (caller && caller.role === "superadmin") {
                broadcastLog(batchId, regId, `API key format non-standard (length=${result.apiKey.length}), not auto-saved`, userId);
              }
            } catch (saveErr: any) {
              broadcastLog(batchId, regId, `Warning: Could not auto-save API key: ${saveErr.message}`, userId);
            }
            try {
              await storage.createPrivateZenrowsKey({
                apiKey: result.apiKey,
                outlookEmail: result.outlookEmail || null,
                outlookPassword: result.outlookPassword || null,
                status: "active",
                createdBy: userId,
              });
            } catch (zkErr: any) {}
            broadcast({ type: "zenrows_register_result", regId, batchId, success: true, apiKey: result.apiKey, outlookEmail: result.outlookEmail, outlookPassword: result.outlookPassword }, userId);
          } else {
            broadcastLog(batchId, regId, `Registration failed: ${result.error || "Unknown error"}`, userId);
            broadcast({ type: "zenrows_register_result", regId, batchId, success: false, error: result.error }, userId);
          }
        } catch (err: any) {
          broadcastLog(batchId, regId, `Error: ${(err.message || "").substring(0, 150)}`, userId);
          broadcast({ type: "zenrows_register_result", regId, batchId, success: false, error: err.message }, userId);
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/private/outlook", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    const accounts = await storage.getAllPrivateOutlooks();
    res.json(accounts);
  });

  app.post("/api/private/outlook", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const account = await storage.createPrivateOutlook({ email, password, status: "active", createdBy: req.session.userId });
    res.json(account);
  });

  app.delete("/api/private/outlook/:id", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    await storage.deletePrivateOutlook(req.params.id);
    res.json({ success: true });
  });

  app.patch("/api/private/outlook/:id/status", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    const { status } = req.body;
    await storage.updatePrivateOutlookStatus(req.params.id, status);
    res.json({ success: true });
  });

  app.post("/api/outlook-bulk-login", requireAuth, requireServiceAccess("outlook"), async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      const { accountIds } = req.body;

      const allAccounts = await storage.getAllPrivateOutlooks();
      const targets = accountIds && accountIds.length > 0
        ? allAccounts.filter((a: any) => accountIds.includes(a.id))
        : allAccounts;

      if (targets.length === 0) {
        return res.status(400).json({ error: "No accounts found to test" });
      }

      const batchId = `outlook-bulk-${randomUUID().substring(0, 8)}`;
      batchOwners.set(batchId, userId);
      res.json({ success: true, batchId, total: targets.length });

      (async () => {
        broadcastLog(batchId, "bulk", `Starting bulk login test for ${targets.length} account(s)...`, userId);
        let passed = 0;
        let failed = 0;

        for (let i = 0; i < targets.length; i++) {
          const acct = targets[i] as any;
          broadcastLog(batchId, "bulk", `[${i + 1}/${targets.length}] Testing ${acct.email}...`, userId);
          try {
            const result = await loginOutlookAccount(
              acct.email,
              acct.password,
              (msg) => broadcastLog(batchId, "bulk", `  ${msg}`, userId)
            );

            const newStatus = result.success ? "working" : "dead";
            await storage.updatePrivateOutlookStatus(acct.id, newStatus);

            if (result.success) {
              passed++;
              broadcastLog(batchId, "bulk", `✓ ${acct.email} — Login successful (${result.cookies?.length || 0} cookies)`, userId);
            } else {
              failed++;
              broadcastLog(batchId, "bulk", `✗ ${acct.email} — Failed: ${result.error || "Unknown"}`, userId);
            }

            broadcast({
              type: "outlook_bulk_login_result",
              batchId,
              accountId: acct.id,
              email: acct.email,
              success: result.success,
              error: result.error,
              cookieCount: result.cookies?.length || 0,
              index: i,
              total: targets.length,
            }, userId);
          } catch (err: any) {
            failed++;
            await storage.updatePrivateOutlookStatus(acct.id, "dead");
            broadcastLog(batchId, "bulk", `✗ ${acct.email} — Error: ${(err.message || "").substring(0, 100)}`, userId);
            broadcast({
              type: "outlook_bulk_login_result",
              batchId,
              accountId: acct.id,
              email: acct.email,
              success: false,
              error: err.message,
              index: i,
              total: targets.length,
            }, userId);
          }

          if (i < targets.length - 1) {
            broadcastLog(batchId, "bulk", `Waiting 3s before next account...`, userId);
            await new Promise((r) => setTimeout(r, 3000));
          }
        }

        broadcastLog(batchId, "bulk", `Bulk test complete: ${passed} passed, ${failed} failed`, userId);
        broadcast({ type: "outlook_bulk_complete", batchId, passed, failed, total: targets.length }, userId);
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/private/zenrows", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    const keys = await storage.getAllPrivateZenrowsKeys();
    res.json(keys);
  });

  app.post("/api/private/zenrows", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    const { apiKey, outlookEmail, outlookPassword } = req.body;
    if (!apiKey) return res.status(400).json({ error: "API key required" });
    const key = await storage.createPrivateZenrowsKey({ apiKey, outlookEmail, outlookPassword, status: "active", createdBy: req.session.userId });
    res.json(key);
  });

  app.delete("/api/private/zenrows/:id", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    await storage.deletePrivateZenrowsKey(req.params.id);
    res.json({ success: true });
  });

  app.patch("/api/private/zenrows/:id/status", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    const { status } = req.body;
    await storage.updatePrivateZenrowsKeyStatus(req.params.id, status);
    res.json({ success: true });
  });

  app.get("/api/private/gmail", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    const accounts = await storage.getAllPrivateGmails();
    res.json(accounts);
  });

  app.post("/api/private/gmail", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const account = await storage.createPrivateGmail({ email, password, status: "active", createdBy: req.session.userId });
    res.json(account);
  });

  app.delete("/api/private/gmail/:id", requireAuth, async (req, res) => {
    if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });
    await storage.deletePrivateGmail(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/private/gmail/:id/check", requireAuth, async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });

      const { id } = req.params;
      const accounts = await storage.getAllPrivateGmails();
      const acc = accounts.find((a) => a.id === id);
      if (!acc) return res.status(404).json({ error: "Gmail account not found" });

      const userId = req.session.userId;
      const checkId = randomUUID().substring(0, 8);
      const batchId = `gmail-check-${checkId}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, checkId, batchId, message: `Gmail login check started for ${acc.email}` });

      (async () => {
        broadcastLog(batchId, checkId, `Starting Gmail login check for ${acc.email}...`, userId);
        try {
          const result = await checkGmailAccount(
            acc.email,
            acc.password,
            (msg) => broadcastLog(batchId, checkId, msg, userId)
          );

          if (result.success) {
            await storage.updatePrivateGmailStatus(id, "verified");
            broadcastLog(batchId, checkId, `✅ Gmail login SUCCESSFUL — account is valid`, userId);
            broadcast({ type: "gmail_check_result", checkId, batchId, accountId: id, success: true }, userId);
          } else {
            await storage.updatePrivateGmailStatus(id, "failed");
            broadcastLog(batchId, checkId, `❌ Gmail login FAILED: ${result.error || "Unknown error"}`, userId);
            broadcast({ type: "gmail_check_result", checkId, batchId, accountId: id, success: false, error: result.error }, userId);
          }
        } catch (err: any) {
          await storage.updatePrivateGmailStatus(id, "failed");
          broadcastLog(batchId, checkId, `Error: ${(err.message || "").substring(0, 150)}`, userId);
          broadcast({ type: "gmail_check_result", checkId, batchId, accountId: id, success: false, error: err.message }, userId);
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/private/gmail/:id/login", requireAuth, async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });

      const { id } = req.params;
      const accounts = await storage.getAllPrivateGmails();
      const acc = accounts.find((a) => a.id === id);
      if (!acc) return res.status(404).json({ error: "Gmail account not found" });

      const userId = req.session.userId;
      const loginId = randomUUID().substring(0, 8);
      const batchId = `gmail-login-${loginId}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, loginId, batchId, message: `Google web login started for ${acc.email}` });

      (async () => {
        broadcastLog(batchId, loginId, `Starting Google web login for ${acc.email}...`, userId);
        try {
          const result = await loginGoogleAccount(
            acc.email,
            acc.password,
            (msg) => broadcastLog(batchId, loginId, msg, userId)
          );

          if (result.success) {
            await storage.updatePrivateGmailStatus(id, "verified");
            broadcastLog(batchId, loginId, `✅ Google login SUCCESSFUL — ${result.cookies?.length || 0} session cookies captured`, userId);
            broadcast({ type: "gmail_login_result", loginId, batchId, accountId: id, success: true, cookieCount: result.cookies?.length || 0 }, userId);
          } else {
            const is2fa = result.note?.startsWith("2fa");
            if (is2fa) {
              await storage.updatePrivateGmailStatus(id, "verified");
              broadcastLog(batchId, loginId, `⚠️ Login reached 2FA step — credentials are valid`, userId);
              broadcast({ type: "gmail_login_result", loginId, batchId, accountId: id, success: false, error: result.error, note: result.note, credentialsValid: true }, userId);
            } else {
              await storage.updatePrivateGmailStatus(id, "failed");
              broadcastLog(batchId, loginId, `❌ Google login FAILED: ${result.error || "Unknown error"}`, userId);
              broadcast({ type: "gmail_login_result", loginId, batchId, accountId: id, success: false, error: result.error }, userId);
            }
          }
        } catch (err: any) {
          await storage.updatePrivateGmailStatus(id, "failed");
          broadcastLog(batchId, loginId, `Error: ${(err.message || "").substring(0, 150)}`, userId);
          broadcast({ type: "gmail_login_result", loginId, batchId, accountId: id, success: false, error: err.message }, userId);
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── TICKET MASTER DISCOVERY MODULE ───────────────────────────────────────

  app.get("/api/tm-discovery/events", requireAuth, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      const keyword = (req.query.keyword as string) || (await storage.getSetting("tm_keyword")) || "";
      const page = parseInt((req.query.page as string) || "0", 10);
      const size = parseInt((req.query.size as string) || "20", 10);
      const classificationName = (req.query.classificationName as string) || undefined;
      const city = (req.query.city as string) || undefined;
      const stateCode = (req.query.stateCode as string) || undefined;
      const postalCode = (req.query.postalCode as string) || undefined;
      const radius = (req.query.radius as string) || undefined;
      const sort = (req.query.sort as string) || "relevance,desc";
      // Only force startDateTime when sorting by date (to exclude past events).
      // When using relevance sort, TM naturally returns upcoming events.
      // Ticketmaster requires format: YYYY-MM-DDTHH:mm:ssZ (no milliseconds)
      const explicitStart = req.query.startDateTime as string | undefined;
      const today = new Date().toISOString().split("T")[0] + "T00:00:00Z";
      const startDateTime = explicitStart || (sort.startsWith("date") ? today : undefined);
      const endDateTime = (req.query.endDateTime as string) || undefined;
      const result = await searchEvents({
        keyword, page, size, classificationName,
        city, stateCode, postalCode, radius, sort,
        startDateTime, endDateTime,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tm-discovery/tracked", requireAuth, async (req, res) => {
    try {
      const events = await storage.getTmTrackedEvents();
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tm-discovery/track", requireAuth, async (req, res) => {
    try {
      const { eventId, name, date, venue, city, priceMin, priceMax, currency, url, status } = req.body;
      if (!eventId || !name) return res.status(400).json({ error: "eventId and name are required" });
      const existing = await storage.getTmTrackedEventByEventId(eventId);
      if (existing) return res.status(409).json({ error: "Event already tracked", event: existing });
      const event = await storage.createTmTrackedEvent({
        eventId, name, date: date || null, venue: venue || null, city: city || null,
        priceMin: priceMin || null, priceMax: priceMax || null, currency: currency || "USD",
        url: url || null, status: status || "active", ownerId: req.session.userId,
      });
      res.json(event);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/tm-discovery/tracked/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTmTrackedEvent(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tm-discovery/alerts", requireAuth, async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || "100", 10);
      const alerts = await storage.getTmAlerts(undefined, limit);
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tm-discovery/settings", requireAuth, async (req, res) => {
    try {
      const [keyword, botToken, chatId, monitoring] = await Promise.all([
        storage.getSetting("tm_keyword"),
        storage.getSetting("tm_telegram_bot_token"),
        storage.getSetting("tm_telegram_chat_id"),
        storage.getSetting("tm_monitoring_enabled"),
      ]);
      res.json({ keyword: keyword || "", botToken: botToken || "", chatId: chatId || "", monitoringEnabled: monitoring !== "false" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/tm-discovery/settings", requireAuth, async (req, res) => {
    try {
      const { keyword, botToken, chatId, monitoringEnabled } = req.body;
      if (keyword !== undefined) await storage.setSetting("tm_keyword", keyword);
      if (botToken !== undefined) await storage.setSetting("tm_telegram_bot_token", botToken);
      if (chatId !== undefined) await storage.setSetting("tm_telegram_chat_id", chatId);
      if (monitoringEnabled !== undefined) await storage.setSetting("tm_monitoring_enabled", String(monitoringEnabled));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tm-discovery/test-telegram", requireAuth, async (req, res) => {
    try {
      const { botToken, chatId } = req.body;
      if (!botToken || !chatId) return res.status(400).json({ error: "botToken and chatId required" });
      const sent = await sendTelegramMessage(botToken, chatId, "✅ <b>Addison Panel</b> — Telegram alert test successful!");
      res.json({ success: sent });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  startMonitoring();

  // ── POST /api/private/gmail/create ───────────────────────────────────────
  app.post("/api/private/gmail/create", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "superadmin") return res.status(403).json({ error: "Access denied" });

      const userId = req.session.userId;
      const createId = randomUUID().substring(0, 8);
      const batchId = `gmail-create-${createId}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, createId, batchId, message: "Gmail account creation started" });

      (async () => {
        broadcastLog(batchId, createId, "Starting Gmail account creation...", userId);
        try {
          const result = await createGmailAccount(
            (msg) => broadcastLog(batchId, createId, msg, userId)
          );

          if (result.success && result.email && result.password) {
            const newAccount = await storage.createPrivateGmail({ email: result.email, password: result.password, status: "active" });
            broadcastLog(batchId, createId, `✅ Gmail account created: ${result.email}`, userId);
            broadcast({ type: "gmail_create_result", createId, batchId, success: true, email: result.email, accountId: newAccount.id }, userId);
          } else {
            broadcastLog(batchId, createId, `❌ Gmail creation FAILED: ${result.error || "Unknown error"}`, userId);
            broadcast({ type: "gmail_create_result", createId, batchId, success: false, error: result.error }, userId);
          }
        } catch (err: any) {
          broadcastLog(batchId, createId, `Error: ${(err.message || "").substring(0, 150)}`, userId);
          broadcast({ type: "gmail_create_result", createId, batchId, success: false, error: err.message }, userId);
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/replit-create/bulk", requireAuth, requireServiceAccess("replit"), async (req: Request, res: Response) => {
    try {
      const { count = 1 } = req.body;
      const actualCount = Math.min(Math.max(1, parseInt(count) || 1), 20);
      const userId = req.session.userId;

      const allOutlook = await storage.getAllPrivateOutlooks();
      const replitAccts = await storage.getAllReplitAccounts();
      const usedEmails = new Set(replitAccts.map((a) => a.outlookEmail?.toLowerCase()).filter(Boolean));
      const available = allOutlook.filter((a) => !usedEmails.has(a.email.toLowerCase()));

      if (available.length === 0) {
        return res.status(400).json({ error: "No available Outlook accounts — all have already been used for Replit" });
      }

      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const toUse = shuffled.slice(0, Math.min(actualCount, shuffled.length));

      const bulkId = randomUUID().substring(0, 8);
      const batchId = `replit-bulk-${bulkId}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, bulkId, batchId, count: toUse.length, message: `Starting bulk creation for ${toUse.length} account(s)` });

      (async () => {
        broadcastLog(batchId, bulkId, `🚀 Bulk create started — ${toUse.length} account(s) queued`, userId);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < toUse.length; i++) {
          const acc = toUse[i];
          broadcastLog(batchId, bulkId, `━━━ [${i + 1}/${toUse.length}] ${acc.email} ━━━`, userId);
          try {
            const result = await registerReplitAccount(
              acc.email,
              acc.password,
              (msg) => broadcastLog(batchId, bulkId, msg, userId)
            );
            if (result.success) {
              try {
                await storage.createReplitAccount({
                  username: result.username!,
                  email: result.email!,
                  password: result.password!,
                  outlookEmail: acc.email,
                  status: "created",
                  createdBy: userId,
                });
                successCount++;
                broadcastLog(batchId, bulkId, `✅ [${i + 1}/${toUse.length}] Saved — @${result.username}`, userId);
              } catch (dbErr: any) {
                broadcastLog(batchId, bulkId, `⚠️ DB save error: ${dbErr.message}`, userId);
              }
              broadcast({ type: "replit_create_result", bulkId, batchId, success: true, username: result.username, email: result.email, password: result.password, index: i + 1, total: toUse.length }, userId);
            } else {
              failCount++;
              broadcastLog(batchId, bulkId, `❌ [${i + 1}/${toUse.length}] Failed: ${result.error || "Unknown"}`, userId);
              broadcast({ type: "replit_create_result", bulkId, batchId, success: false, error: result.error, index: i + 1, total: toUse.length }, userId);
            }
          } catch (err: any) {
            failCount++;
            broadcastLog(batchId, bulkId, `❌ [${i + 1}/${toUse.length}] Error: ${(err.message || "").substring(0, 100)}`, userId);
            broadcast({ type: "replit_create_result", bulkId, batchId, success: false, error: err.message, index: i + 1, total: toUse.length }, userId);
          }
        }

        broadcastLog(batchId, bulkId, `🏁 Done — ${successCount} created, ${failCount} failed`, userId);
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/replit-create", requireAuth, requireServiceAccess("replit"), async (req: Request, res: Response) => {
    try {
      const { outlookEmail, outlookPassword } = req.body;
      if (!outlookEmail || !outlookPassword) {
        return res.status(400).json({ error: "Outlook email and password are required" });
      }

      const existingAccts = await storage.getAllReplitAccounts();
      const alreadyUsed = existingAccts.some(
        (a) => a.outlookEmail?.toLowerCase() === outlookEmail.toLowerCase()
      );
      if (alreadyUsed) {
        return res.status(409).json({ error: `Outlook account ${outlookEmail} has already been used to create a Replit account` });
      }

      const userId = req.session.userId;
      const createId = randomUUID().substring(0, 8);
      const batchId = `replit-create-${createId}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, createId, batchId, message: "Replit account creation started" });

      (async () => {
        broadcastLog(batchId, createId, `Starting Replit account creation for ${outlookEmail}...`, userId);
        try {
          const result = await registerReplitAccount(
            outlookEmail,
            outlookPassword,
            (msg) => broadcastLog(batchId, createId, msg, userId)
          );

          if (result.success) {
            try {
              await storage.createReplitAccount({
                username: result.username!,
                email: result.email!,
                password: result.password!,
                outlookEmail,
                status: "created",
                createdBy: userId,
              });
              broadcastLog(batchId, createId, `✅ Account saved to database`, userId);
            } catch (dbErr: any) {
              broadcastLog(batchId, createId, `⚠️ DB save error: ${dbErr.message}`, userId);
            }
            broadcast({ type: "replit_create_result", createId, batchId, success: true, username: result.username, email: result.email, password: result.password }, userId);
          } else {
            broadcastLog(batchId, createId, `❌ Replit creation failed: ${result.error || "Unknown error"}`, userId);
            broadcast({ type: "replit_create_result", createId, batchId, success: false, error: result.error }, userId);
          }
        } catch (err: any) {
          broadcastLog(batchId, createId, `Error: ${(err.message || "").substring(0, 150)}`, userId);
          broadcast({ type: "replit_create_result", createId, batchId, success: false, error: err.message }, userId);
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/replit-accounts", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      const role = req.session.role;
      const accounts = role === "superadmin"
        ? await storage.getAllReplitAccounts()
        : await storage.getReplitAccountsByOwner(userId);
      res.json(accounts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/replit-accounts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.deleteReplitAccount(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lovable-create/bulk", requireAuth, requireServiceAccess("lovable"), async (req: Request, res: Response) => {
    try {
      const { count = 1 } = req.body;
      const actualCount = Math.min(Math.max(1, parseInt(count) || 1), 10);
      const userId = req.session.userId;

      const allOutlook = await storage.getAllPrivateOutlooks();
      const lovableAccts = await storage.getAllLovableAccounts();
      const usedEmails = new Set(lovableAccts.map((a) => a.outlookEmail?.toLowerCase()).filter(Boolean));
      const available = allOutlook.filter((a) => !usedEmails.has(a.email.toLowerCase()));

      if (available.length === 0) {
        return res.status(400).json({ error: "No available Outlook accounts — all have already been used for Lovable" });
      }

      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const toUse = shuffled.slice(0, Math.min(actualCount, shuffled.length));

      const bulkId = randomUUID().substring(0, 8);
      const batchId = `lovable-bulk-${bulkId}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, bulkId, batchId, count: toUse.length, message: `Starting bulk creation for ${toUse.length} account(s)` });

      (async () => {
        broadcastLog(batchId, bulkId, `🚀 Bulk create started — ${toUse.length} Lovable account(s) queued`, userId);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < toUse.length; i++) {
          const acc = toUse[i];
          broadcastLog(batchId, bulkId, `━━━ [${i + 1}/${toUse.length}] ${acc.email} ━━━`, userId);
          try {
            const result = await registerLovableAccount(
              acc.email,
              acc.password,
              (msg) => broadcastLog(batchId, bulkId, msg, userId)
            );
            if (result.success) {
              try {
                await storage.createLovableAccount({
                  email: result.email!,
                  password: result.password || null,
                  outlookEmail: acc.email,
                  status: "created",
                  createdBy: userId,
                });
                successCount++;
                broadcastLog(batchId, bulkId, `✅ [${i + 1}/${toUse.length}] Saved — ${result.email}`, userId);
              } catch (dbErr: any) {
                broadcastLog(batchId, bulkId, `⚠️ DB save error: ${dbErr.message}`, userId);
              }
              broadcast({ type: "lovable_create_result", bulkId, batchId, success: true, email: result.email, index: i + 1, total: toUse.length }, userId);
            } else {
              failCount++;
              broadcastLog(batchId, bulkId, `❌ [${i + 1}/${toUse.length}] Failed: ${result.error || "Unknown"}`, userId);
              broadcast({ type: "lovable_create_result", bulkId, batchId, success: false, error: result.error, index: i + 1, total: toUse.length }, userId);
            }
          } catch (err: any) {
            failCount++;
            broadcastLog(batchId, bulkId, `❌ [${i + 1}/${toUse.length}] Error: ${(err.message || "").substring(0, 100)}`, userId);
            broadcast({ type: "lovable_create_result", bulkId, batchId, success: false, error: err.message, index: i + 1, total: toUse.length }, userId);
          }
        }

        broadcastLog(batchId, bulkId, `🏁 Done — ${successCount} created, ${failCount} failed`, userId);
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/lovable-create", requireAuth, requireServiceAccess("lovable"), async (req: Request, res: Response) => {
    try {
      const { outlookEmail, outlookPassword } = req.body;
      if (!outlookEmail || !outlookPassword) {
        return res.status(400).json({ error: "Outlook email and password are required" });
      }

      const existingAccts = await storage.getAllLovableAccounts();
      const alreadyUsed = existingAccts.some(
        (a) => a.outlookEmail?.toLowerCase() === outlookEmail.toLowerCase()
      );
      if (alreadyUsed) {
        return res.status(409).json({ error: `Outlook account ${outlookEmail} has already been used to create a Lovable account` });
      }

      const userId = req.session.userId;
      const createId = randomUUID().substring(0, 8);
      const batchId = `lovable-create-${createId}`;

      batchOwners.set(batchId, userId);
      res.json({ success: true, createId, batchId, message: "Lovable account creation started" });

      (async () => {
        broadcastLog(batchId, createId, `Starting Lovable account creation for ${outlookEmail}...`, userId);
        try {
          const result = await registerLovableAccount(
            outlookEmail,
            outlookPassword,
            (msg) => broadcastLog(batchId, createId, msg, userId)
          );

          if (result.success) {
            try {
              await storage.createLovableAccount({
                email: result.email!,
                password: result.password || null,
                outlookEmail,
                status: "created",
                createdBy: userId,
              });
              broadcastLog(batchId, createId, `✅ Account saved to database`, userId);
            } catch (dbErr: any) {
              broadcastLog(batchId, createId, `⚠️ DB save error: ${dbErr.message}`, userId);
            }
            broadcast({ type: "lovable_create_result", createId, batchId, success: true, email: result.email, password: result.password }, userId);
          } else {
            broadcastLog(batchId, createId, `❌ Lovable creation failed: ${result.error || "Unknown error"}`, userId);
            broadcast({ type: "lovable_create_result", createId, batchId, success: false, error: result.error }, userId);
          }
        } catch (err: any) {
          broadcastLog(batchId, createId, `Error: ${(err.message || "").substring(0, 150)}`, userId);
          broadcast({ type: "lovable_create_result", createId, batchId, success: false, error: err.message }, userId);
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lovable-accounts", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      const role = req.session.role;
      const accounts = role === "superadmin"
        ? await storage.getAllLovableAccounts()
        : await storage.getLovableAccountsByOwner(userId);
      res.json(accounts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/lovable-accounts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      const role = req.session.role;
      const accounts = await storage.getAllLovableAccounts();
      const acct = accounts.find((a) => a.id === req.params.id);
      if (!acct) return res.status(404).json({ error: "Account not found" });
      if (role !== "superadmin" && acct.createdBy !== userId) {
        return res.status(403).json({ error: "Forbidden: not your account" });
      }
      await storage.deleteLovableAccount(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/card-generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const { bin, quantity = 10, expmon, expyear, cvvEnabled, cvv } = req.body;
      const cleanBin = String(bin || "").replace(/\D/g, "");
      if (!cleanBin || cleanBin.length < 6 || cleanBin.length > 8) {
        return res.status(400).json({ error: "BIN must be 6–8 digits" });
      }

      const count = Math.min(Math.max(1, parseInt(String(quantity)) || 10), 999);

      function luhnComplete(partial: string): string {
        let sum = 0;
        let alt = true;
        for (let i = partial.length - 1; i >= 0; i--) {
          let d = parseInt(partial[i]);
          if (alt) { d *= 2; if (d > 9) d -= 9; }
          sum += d;
          alt = !alt;
        }
        const check = (10 - (sum % 10)) % 10;
        return partial + check;
      }

      function randDigits(n: number): string {
        let s = "";
        for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
        return s;
      }

      // Detect network from BIN to pick card length
      function cardLength(b: string): number {
        if (b.startsWith("34") || b.startsWith("37")) return 15; // Amex
        if (b.startsWith("6011") || b.startsWith("65") || b.startsWith("64") || b.startsWith("622")) return 16; // Discover
        return 16; // Visa/MC default
      }

      const length = cardLength(cleanBin);
      const now = new Date();

      const cards: string[] = [];
      for (let i = 0; i < count; i++) {
        // Fill digits up to length-1, then luhn
        const fill = randDigits(length - 1 - cleanBin.length);
        const number = luhnComplete(cleanBin + fill);

        // Expiry month
        let mm: string;
        if (expmon && expmon !== "Random" && expmon !== "random") {
          mm = String(expmon).padStart(2, "0");
        } else {
          mm = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
        }

        // Expiry year
        let yyyy: string;
        if (expyear && expyear !== "Random" && expyear !== "random") {
          yyyy = String(expyear);
        } else {
          yyyy = String(now.getFullYear() + 1 + Math.floor(Math.random() * 5));
        }

        // CVV
        let cvvVal: string;
        if (cvvEnabled === false) {
          cvvVal = "";
        } else if (cvv && String(cvv).trim()) {
          cvvVal = String(cvv).trim();
        } else {
          const isAmex = cleanBin.startsWith("34") || cleanBin.startsWith("37");
          cvvVal = randDigits(isAmex ? 4 : 3);
        }

        const parts = [number, mm, yyyy];
        if (cvvEnabled !== false) parts.push(cvvVal);
        cards.push(parts.join("|"));
      }

      res.json({ cards });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/card-check", requireAuth, async (req: Request, res: Response) => {
    try {
      const { card } = req.body;
      if (!card || typeof card !== "string") {
        return res.status(400).json({ error: "Card string required" });
      }
      const response = await fetch("https://api.chkr.cc/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify({ data: card }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Check failed" });
    }
  });

  app.get("/api/my-cards", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const cards = await storage.getSavedCardsByOwner(userId);
    res.json(cards);
  });

  app.post("/api/my-cards", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const { label, cardholderName, cardNumber, expiryMonth, expiryYear, cvv, cardType, notes } = req.body;
    if (!cardholderName || !cardNumber || !expiryMonth || !expiryYear || !cvv) {
      return res.status(400).json({ error: "Missing required card fields" });
    }
    const card = await storage.createSavedCard({
      ownerId: userId,
      label: label || `Card ending ${cardNumber.replace(/\s/g, "").slice(-4)}`,
      cardholderName,
      cardNumber,
      expiryMonth,
      expiryYear,
      cvv,
      cardType: cardType || "visa",
      notes: notes || null,
      isActive: true,
    });
    res.json(card);
  });

  app.patch("/api/my-cards/:id", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const card = await storage.getSavedCard(req.params.id);
    if (!card || card.ownerId !== userId) return res.status(404).json({ error: "Not found" });
    const updated = await storage.updateSavedCard(req.params.id, req.body);
    res.json(updated);
  });

  app.delete("/api/my-cards/:id", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const card = await storage.getSavedCard(req.params.id);
    if (!card || card.ownerId !== userId) return res.status(404).json({ error: "Not found" });
    await storage.deleteSavedCard(req.params.id);
    res.json({ ok: true });
  });

  return httpServer;
}
