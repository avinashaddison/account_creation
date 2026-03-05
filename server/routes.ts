import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getAvailableDomain, createTempEmail, getAuthToken, pollForVerificationCode, generateRandomUsername, fetchMessages, fetchMessageContent } from "./mailService";
import { fullRegistrationFlow } from "./playwrightService";
import { tmFullRegistrationFlow } from "./ticketmasterService";
import { uefaFullRegistrationFlow } from "./uefaService";
import { randomUUID, createHash } from "crypto";

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
const WHATSAPP_NUMBER = "919142647797";

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

const COST_PER_ACCOUNT = 0.11;

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
  broadcast({ type: "account_update", account }, ownerId);
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
  ownerId: string
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
      }
    );

    if (result.success) {
      const updated = await storage.updateAccount(accountId, { status: "verified" });
      if (updated) broadcastAccountUpdate(updated, ownerId);
      broadcastLog(batchId, accountId, `✅ Account created successfully! Email: ${addisonEmail}`, ownerId);

      await storage.createBillingRecord({
        accountId,
        amount: COST_PER_ACCOUNT.toFixed(2),
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
      wsClients.set(ws, "");
      ws.on("close", () => wsClients.delete(ws));
      return;
    }

    wsPool.query(`SELECT sess FROM user_sessions WHERE sid = $1`, [sessionId])
      .then((result: any) => {
        if (result.rows.length > 0 && result.rows[0].sess?.userId) {
          wsClients.set(ws, result.rows[0].sess.userId);
        } else {
          wsClients.set(ws, "");
        }
      })
      .catch(() => {
        wsClients.set(ws, "");
      });
    ws.on("close", () => wsClients.delete(ws));
  });

  async function ensureDefaultSuperAdmin() {
    const existing = await storage.getUserByEmail("avinashaddison@gmail.com");
    if (!existing) {
      const oldAdmin = await storage.getUserByEmail("admin@la28panel.com");
      if (oldAdmin) {
        await storage.deleteUser(oldAdmin.id);
      }
      await storage.createUser({
        username: "avinash",
        email: "avinashaddison@gmail.com",
        password: hashPassword("@AJAYkn8085123"),
        role: "superadmin",
      });
      console.log("[Auth] Super admin created: avinashaddison@gmail.com");
    }
  }
  await ensureDefaultSuperAdmin();

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

      const { count = 1, country = "United States", language = "English" } = req.body;
      const numAccounts = Math.max(1, parseInt(count));

      const walletBalance = parseFloat(user.walletBalance || "0");
      const requiredBalance = numAccounts * COST_PER_ACCOUNT;
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

      (async () => {
        for (const acc of created) {
          broadcastLog(batchId, acc.id, `Starting registration for ${acc.firstName} ${acc.lastName}...`, userId);
          await processAccount(
            acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
            acc.country, acc.language, acc.email, acc.emailPassword, userId
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

      const walletBalance = parseFloat(user.walletBalance || "0");
      if (walletBalance < COST_PER_ACCOUNT) {
        return res.status(403).json({
          error: `Insufficient balance. Add funds to your wallet to continue. Balance: $${walletBalance.toFixed(2)}`,
        });
      }
      const debited = await storage.debitWallet(userId, COST_PER_ACCOUNT);
      if (!debited) {
        return res.status(403).json({ error: "Failed to debit wallet. Insufficient balance." });
      }

      const { firstName, lastName, password, country = "United States", language = "English" } = req.body;
      if (!firstName || !lastName || !password) {
        return res.status(400).json({ error: "firstName, lastName, and password are required" });
      }

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
          country, language, addisonEmail, addisonEmailPassword, userId
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

      const walletBalance = parseFloat(user.walletBalance || "0");
      if (walletBalance < COST_PER_ACCOUNT) {
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

      const debited = await storage.debitWallet(userId, COST_PER_ACCOUNT);
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
          cleanCountry, cleanLanguage, addisonEmail, addisonEmailPassword, userId
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
      accounts.every(a => a.status === "verified" || a.status === "failed");
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
        proxyUrl
      );

      if (result.success) {
        const updated = await storage.updateAccount(accountId, { status: "verified" });
        if (updated) broadcastAccountUpdate(updated, ownerId);
        broadcastLog(batchId, accountId, `TM account verified successfully!`, ownerId);

        await storage.createBillingRecord({
          accountId,
          amount: COST_PER_ACCOUNT.toFixed(2),
          description: `TM Account: ${firstName} ${lastName} (${addisonEmail})`,
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

  app.post("/api/tm-create-batch", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { count = 1 } = req.body;
      const numAccounts = Math.max(1, parseInt(count));
      const proxyUrl = process.env.TM_PROXY_URL || req.body.proxyUrl || "";

      const walletBalance = parseFloat(user.walletBalance || "0");
      const requiredBalance = numAccounts * COST_PER_ACCOUNT;
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

        await storage.createBillingRecord({
          accountId,
          amount: COST_PER_ACCOUNT.toFixed(2),
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

      const walletBalance = parseFloat(user.walletBalance || "0");
      const requiredBalance = numAccounts * COST_PER_ACCOUNT;
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

  return httpServer;
}
