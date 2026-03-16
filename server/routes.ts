import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { getAvailableDomain, createTempEmail, getAuthToken, pollForVerificationCode, generateRandomUsername, fetchMessages, fetchMessageContent } from "./mailService";
import { fullRegistrationFlow, retryDrawRegistration, completeDrawRegistrationViaApi, completeDrawViaGigyaBrowser, loginOutlookAccount, registerZenrowsAccount } from "./playwrightService";
import { tmFullRegistrationFlow } from "./ticketmasterService";
import { uefaFullRegistrationFlow } from "./uefaService";
import { brunoMarsPresaleStep } from "./brunoMarsService";
import { getSMSPoolBalance } from "./smspoolService";
import { getCapSolverBalance, clearCapsolverApiKeyCache } from "./capsolverService";
import { clearZenrowsApiKeyCache } from "./playwrightService";
import { randomUUID, createHash } from "crypto";

async function getDefaultBrowserApiUrl(): Promise<string | null> {
  const saved = await storage.getSetting("browser_proxy_url");
  return saved || null;
}

async function getDefaultProxies(proxyList?: string[]): Promise<string[]> {
  if (Array.isArray(proxyList) && proxyList.length > 0) return proxyList;
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
  broadcast({ type: "log", batchId, accountId, message, timestamp: new Date().toISOString() }, ownerId);
}

function broadcastAccountUpdate(account: any, ownerId?: string) {
  broadcast({ type: "account_update", account, batchId: account.batchId }, ownerId);
}

function broadcastBatchComplete(batchId: string, ownerId?: string) {
  addBatchLog(batchId, "", "Batch complete");
  broadcast({ type: "batch_complete", batchId }, ownerId);
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
  proxyUrl: string = ""
) {
  try {
    broadcastLog(batchId, accountId, `Creating Addison email: ${addisonEmail}`, ownerId);
    await createTempEmail(addisonEmail, addisonEmailPassword);
    const token = await getAuthToken(addisonEmail, addisonEmailPassword);
    broadcastLog(batchId, accountId, `Addison email ready, starting registration...`, ownerId);

    const result = await fullRegistrationFlow(
      addisonEmail,
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
        const code = await pollForVerificationCode(token, 40, 3000);
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

    if (result.success) {
      const currentAccount = await storage.getAccount(accountId);
      const currentStatus = currentAccount?.status || "";
      let finalStatus: string;
      if (currentStatus === "completed") finalStatus = "completed";
      else if (currentStatus === "draw_registering") finalStatus = "draw_registering";
      else finalStatus = "verified";
      const updateData: any = { status: finalStatus };
      if (result.zipCode) updateData.zipCode = result.zipCode;
      const updated = await storage.updateAccount(accountId, updateData);
      if (updated) broadcastAccountUpdate(updated, ownerId);
      const successMsg = finalStatus === "completed"
        ? `✅ Full flow complete! Draw registered: ${addisonEmail}`
        : `✅ Account created successfully! Email: ${addisonEmail}`;
      broadcastLog(batchId, accountId, successMsg, ownerId);

      const billingPrice = await getCostPerAccount();
      await storage.createBillingRecord({
        accountId,
        amount: billingPrice.toFixed(2),
        description: `Account creation: ${firstName} ${lastName} (${addisonEmail})`,
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const pgModule = await import("pg");
  const wsPool = new pgModule.default.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
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
    const proxy = await storage.getSetting("browser_proxy_url");
    if (!proxy) {
      console.log("[Auth] No browser proxy URL set. Please configure it in Settings.");
    }

    const migrated = await storage.getSetting("neon_migration_v2_done");
    if (!migrated) {
      try {
        const neonUrl = "postgresql://neondb_owner:npg_6K4XpdfYwhqM@ep-bold-flower-aivou9uw.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
        const neonPool = new pgModule.default.Pool({ connectionString: neonUrl, ssl: { rejectUnauthorized: false } });
        
        const neonUsers = await neonPool.query("SELECT id, email FROM users");
        const ownerMap: Record<string, string> = {};
        for (const nu of neonUsers.rows) {
          const localUser = await storage.getUserByEmail(nu.email);
          if (localUser) ownerMap[nu.id] = localUser.id;
        }
        console.log("[Migration v2] Owner mapping:", ownerMap);

        const existingAccounts = await storage.getAllAccounts();
        const existingEmails = new Set(existingAccounts.map(a => a.email));

        const neonAccounts = await neonPool.query("SELECT * FROM accounts ORDER BY created_at");
        let importedAccounts = 0;
        for (const a of neonAccounts.rows) {
          if (existingEmails.has(a.temp_email)) continue;
          const mappedOwner = ownerMap[a.owner_id] || a.owner_id;
          await storage.createAccount({
            email: a.temp_email,
            emailPassword: a.temp_email_password,
            firstName: a.first_name,
            lastName: a.last_name,
            la28Password: a.la28_password,
            country: a.country,
            language: a.language,
            status: a.status,
            verificationCode: a.verification_code,
            errorMessage: a.error_message,
            batchId: a.batch_id,
            ownerId: mappedOwner,
            platform: a.platform,
            isUsed: a.is_used,
            zipCode: a.zip_code,
          });
          importedAccounts++;
        }
        console.log(`[Migration v2] Imported ${importedAccounts} new accounts (${neonAccounts.rows.length} total in Neon)`);

        const neonBilling = await neonPool.query("SELECT * FROM billing_records ORDER BY created_at");
        const existingBillingCount = (await storage.getAllBillingRecords()).length;
        if (existingBillingCount === 0) {
          for (const b of neonBilling.rows) {
            const mappedOwner = ownerMap[b.owner_id] || b.owner_id;
            await storage.createBillingRecord({
              accountId: b.account_id,
              amount: b.amount.toString(),
              description: b.description,
              ownerId: mappedOwner,
            });
          }
          console.log(`[Migration v2] Imported ${neonBilling.rows.length} billing records`);
        }

        await neonPool.end();
        await storage.setSetting("neon_migration_v2_done", "true");
        console.log("[Migration v2] Complete");
      } catch (err: any) {
        console.error("[Migration v2] Failed:", err.message);
      }
    }
  }
  await ensureDefaultData();

  async function cleanupStaleAccounts() {
    try {
      const allAccounts = await storage.getAllAccounts();
      const now = Date.now();
      const staleTimeout = 30 * 60 * 1000;
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
      const stuckRows = await db.execute(sql`SELECT id, temp_email, la28_password, zip_code, batch_id, owner_id FROM accounts WHERE status = 'draw_registering' AND platform = 'la28' LIMIT 3`);
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

  setInterval(autoRetryDrawAccounts, 15 * 60 * 1000);
  setTimeout(autoRetryDrawAccounts, 60 * 1000);

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
      if (!/^[0-9][a-f0-9]{39,}$/.test(trimmedKey)) {
        return res.status(400).json({ error: "ZenRows API key format invalid. Expected 41-char hex string starting with a digit (e.g. 0abc...def). Got length=" + trimmedKey.length });
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

  app.post("/api/create-batch", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { count = 1, country = "United States", language = "English", proxyList } = req.body;
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

      (async () => {
        for (let i = 0; i < created.length; i++) {
          const acc = created[i];
          const proxy = proxies[i % proxies.length];
          broadcastLog(batchId, acc.id, `Starting registration for ${acc.firstName} ${acc.lastName}...`, userId);
          await processAccount(
            acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
            acc.country, acc.language, acc.email, acc.emailPassword, userId, proxy
          );
        }
        broadcastBatchComplete(batchId, userId);
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
      const resolvedProxy = proxies[Math.floor(Math.random() * proxies.length)];

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

      if (gigyaResult.success) {
        await storage.updateAccount(account.id, { status: "completed" });
        broadcastAccountUpdate({ ...account, status: "completed" }, account.ownerId || undefined);
        log("Draw registration completed successfully!");
      } else if (gigyaResult.profileSet || gigyaResult.dataSet) {
        await storage.updateAccount(account.id, { status: "completed" });
        broadcastAccountUpdate({ ...account, status: "completed" }, account.ownerId || undefined);
        log("Partial success (profile=" + gigyaResult.profileSet + " data=" + gigyaResult.dataSet + "). Marked as completed.");
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

  app.get("/api/emails/:id/inbox", requireAuth, async (req, res) => {
    try {
      const account = await storage.getAccount(req.params.id);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (req.session.role !== "superadmin" && account.ownerId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const token = await getAuthToken(account.email, account.emailPassword);
      const messages = await fetchMessages(token);

      const fullMessages = [];
      for (const msg of messages.slice(0, 20)) {
        const content = await fetchMessageContent(token, msg.id);
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
      const token = await getAuthToken(te.address, te.password);
      const messages = await fetchMessages(token);
      const fullMessages = [];
      for (const msg of messages.slice(0, 30)) {
        const content = await fetchMessageContent(token, msg.id);
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
      await createTempEmail(addisonEmail, addisonEmailPassword);
      const token = await getAuthToken(addisonEmail, addisonEmailPassword);
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
          const code = await pollForVerificationCode(token, 40, 3000);
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

  app.post("/api/tm-create-batch", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { count = 1 } = req.body;
      const numAccounts = Math.max(1, parseInt(count));
      const proxyUrl = req.body.proxyUrl || (await getDefaultBrowserApiUrl()) || "";

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
          broadcastLog(batchId, acc.id, `Starting TM registration for ${acc.firstName} ${acc.lastName}...`, userId);
          await processTMAccount(
            acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
            acc.email, acc.emailPassword, userId, proxyUrl
          );

          const afterAccount = await storage.getAccount(acc.id);
          if (afterAccount && afterAccount.status === "failed") {
            broadcastLog(batchId, acc.id, `Retrying with new email address...`, userId);
            const retryDomain = await getAvailableDomain();
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
              retryEmail, "TempPass123!", userId, proxyUrl
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
    ownerId: string
  ) {
    try {
      broadcastLog(batchId, accountId, `Creating temp email: ${addisonEmail}`, ownerId);
      await createTempEmail(addisonEmail, addisonEmailPassword);
      const token = await getAuthToken(addisonEmail, addisonEmailPassword);
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
          const code = await pollForVerificationCode(token, 40, 3000);
          if (code) {
            await storage.updateAccount(accountId, { verificationCode: code });
            broadcastLog(batchId, accountId, `Got verification code: ${code}`, ownerId);
          } else {
            broadcastLog(batchId, accountId, `Timed out waiting for code`, ownerId);
          }
          return code;
        }
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

  app.post("/api/uefa-create-batch", requireAuth, async (req, res) => {
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

      batchOwners.set(batchId, userId);
      res.json({ batchId, accounts: created, count: numAccounts });

      (async () => {
        for (const acc of created) {
          broadcastLog(batchId, acc.id, `Starting UEFA registration for ${acc.firstName} ${acc.lastName}...`, userId);
          await processUEFAAccount(
            acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
            acc.email, acc.emailPassword, userId
          );
        }
        broadcastBatchComplete(batchId, userId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/brunomars-create-batch", requireAuth, async (req, res) => {
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
      const proxyUrl = req.body.proxyUrl || (await getDefaultBrowserApiUrl()) || "";

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
          broadcastLog(batchId, acc.id, `Starting TM + Bruno Mars flow for ${acc.firstName} ${acc.lastName}...`, userId);

          let tmSuccess = false;
          let tmBrowser: any = null;
          let tmPage: any = null;
          try {
            broadcastLog(batchId, acc.id, `📧 Phase 1: Creating TM account...`, userId);
            broadcastLog(batchId, acc.id, `Creating temp email: ${acc.email}`, userId);
            await createTempEmail(acc.email, acc.emailPassword);
            const token = await getAuthToken(acc.email, acc.emailPassword);
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
                const code = await pollForVerificationCode(token, 40, 3000);
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

  app.post("/api/outlook-login", requireAuth, async (req: Request, res: Response) => {
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

  app.post("/api/zenrows-register", requireAuth, async (req: Request, res: Response) => {
    try {
      const { outlookEmail, outlookPassword } = req.body;

      const userId = req.session.userId;
      const regId = randomUUID().substring(0, 8);
      const batchId = `zenrows-reg-${regId}`;

      batchOwners.set(batchId, userId);
      const mode = outlookEmail && outlookPassword ? "existing Outlook account" : "auto-create Outlook account";
      res.json({ success: true, regId, batchId, message: `ZenRows registration started (${mode})` });

      (async () => {
        broadcastLog(batchId, regId, `Starting ZenRows account registration flow (${mode})...`, userId);
        try {
          const result = await registerZenrowsAccount(
            outlookEmail || null,
            outlookPassword || null,
            (msg) => broadcastLog(batchId, regId, msg, userId)
          );

          if (result.success && result.apiKey) {
            broadcastLog(batchId, regId, `ZenRows API Key extracted successfully`, userId);
            try {
              const caller = await storage.getUser(userId);
              if (caller && caller.role === "superadmin" && /^[0-9][a-f0-9]{39,}$/.test(result.apiKey)) {
                await storage.setSetting("zenrows_rest_api_key", result.apiKey);
                clearZenrowsApiKeyCache();
                broadcastLog(batchId, regId, `API key auto-saved to settings (length=${result.apiKey.length})`, userId);
              } else if (caller && caller.role === "superadmin") {
                broadcastLog(batchId, regId, `API key format non-standard (length=${result.apiKey.length}), not auto-saved`, userId);
              }
            } catch (saveErr: any) {
              broadcastLog(batchId, regId, `Warning: Could not auto-save API key: ${saveErr.message}`, userId);
            }
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

  return httpServer;
}
