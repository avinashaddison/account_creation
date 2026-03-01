import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { getAvailableDomain, createTempEmail, getAuthToken, pollForVerificationCode, generateRandomUsername } from "./mailService";
import { fullRegistrationFlow } from "./playwrightService";
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

let wsClients: Set<WebSocket> = new Set();

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function broadcastLog(batchId: string, accountId: string, message: string) {
  broadcast({ type: "log", batchId, accountId, message, timestamp: new Date().toISOString() });
}

function broadcastAccountUpdate(account: any) {
  broadcast({ type: "account_update", account });
}

function broadcastBatchComplete(batchId: string) {
  broadcast({ type: "batch_complete", batchId });
}

async function processAccount(
  accountId: string,
  batchId: string,
  firstName: string,
  lastName: string,
  password: string,
  country: string,
  language: string,
  tempEmail: string,
  tempEmailPassword: string
) {
  try {
    broadcastLog(batchId, accountId, `Creating temp email: ${tempEmail}`);
    await createTempEmail(tempEmail, tempEmailPassword);
    const token = await getAuthToken(tempEmail, tempEmailPassword);
    broadcastLog(batchId, accountId, `Temp email ready, starting registration...`);

    const result = await fullRegistrationFlow(
      tempEmail,
      firstName,
      lastName,
      password,
      country,
      language,
      async (status) => {
        const updated = await storage.updateAccount(accountId, { status: status as any });
        if (updated) broadcastAccountUpdate(updated);
        broadcastLog(batchId, accountId, `Status: ${status}`);
      },
      async () => {
        broadcastLog(batchId, accountId, `Polling for verification code...`);
        const code = await pollForVerificationCode(token, 40, 3000);
        if (code) {
          await storage.updateAccount(accountId, { verificationCode: code });
          broadcastLog(batchId, accountId, `Got verification code: ${code}`);
        } else {
          broadcastLog(batchId, accountId, `Timed out waiting for code`);
        }
        return code;
      }
    );

    if (result.success) {
      const updated = await storage.updateAccount(accountId, { status: "verified" });
      if (updated) broadcastAccountUpdate(updated);
      broadcastLog(batchId, accountId, `Account verified successfully!`);

      await storage.createBillingRecord({
        accountId,
        amount: COST_PER_ACCOUNT.toFixed(2),
        description: `Account creation: ${firstName} ${lastName} (${tempEmail})`,
      });
    } else {
      const updated = await storage.updateAccount(accountId, { status: "failed", errorMessage: result.error || "Failed" });
      if (updated) broadcastAccountUpdate(updated);
      broadcastLog(batchId, accountId, `Failed: ${result.error}`);
    }
  } catch (err: any) {
    const updated = await storage.updateAccount(accountId, { status: "failed", errorMessage: err.message });
    if (updated) broadcastAccountUpdate(updated);
    broadcastLog(batchId, accountId, `Error: ${err.message}`);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    wsClients.add(ws);
    ws.on("close", () => wsClients.delete(ws));
  });

  async function ensureDefaultAdmin() {
    const existing = await storage.getUserByEmail("admin@la28panel.com");
    if (!existing) {
      await storage.createUser({
        username: "admin",
        email: "admin@la28panel.com",
        password: hashPassword("admin123"),
        role: "admin",
      });
      console.log("[Auth] Default admin created: admin@la28panel.com / admin123");
    }
  }
  await ensureDefaultAdmin();

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
      res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
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
    res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
  });

  app.post("/api/create-batch", requireAuth, async (req, res) => {
    try {
      const { count = 1, country = "India", language = "English" } = req.body;
      const numAccounts = Math.min(Math.max(1, parseInt(count)), 30);
      const batchId = randomUUID();
      const domain = await getAvailableDomain();

      const created: any[] = [];
      for (let i = 0; i < numAccounts; i++) {
        const fn = randomFrom(FIRST_NAMES);
        const ln = randomFrom(LAST_NAMES);
        const pw = generatePassword();
        const username = generateRandomUsername();
        const tempEmail = `${username}@${domain}`;
        const tempEmailPassword = "TempPass123!";

        const account = await storage.createAccount({
          tempEmail,
          tempEmailPassword,
          firstName: fn,
          lastName: ln,
          la28Password: pw,
          country,
          language,
          status: "pending",
          batchId,
          verificationCode: null,
          errorMessage: null,
        });

        created.push(account);
      }

      res.json({ batchId, accounts: created, count: numAccounts });

      (async () => {
        for (const acc of created) {
          broadcastLog(batchId, acc.id, `Starting registration for ${acc.firstName} ${acc.lastName}...`);
          await processAccount(
            acc.id, batchId, acc.firstName, acc.lastName, acc.la28Password,
            acc.country, acc.language, acc.tempEmail, acc.tempEmailPassword
          );
        }
        broadcastBatchComplete(batchId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/create-single", requireAuth, async (req, res) => {
    try {
      const { firstName, lastName, password, country = "India", language = "English" } = req.body;
      if (!firstName || !lastName || !password) {
        return res.status(400).json({ error: "firstName, lastName, and password are required" });
      }

      const domain = await getAvailableDomain();
      const username = generateRandomUsername();
      const tempEmail = `${username}@${domain}`;
      const tempEmailPassword = "TempPass123!";
      const batchId = randomUUID();

      const account = await storage.createAccount({
        tempEmail,
        tempEmailPassword,
        firstName,
        lastName,
        la28Password: password,
        country,
        language,
        status: "pending",
        batchId,
        verificationCode: null,
        errorMessage: null,
      });

      res.json({ batchId, account });

      (async () => {
        await processAccount(
          account.id, batchId, firstName, lastName, password,
          country, language, tempEmail, tempEmailPassword
        );
        broadcastBatchComplete(batchId);
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/accounts", requireAuth, async (_req, res) => {
    const all = await storage.getAllAccounts();
    res.json(all);
  });

  app.get("/api/accounts/stats", requireAuth, async (_req, res) => {
    const stats = await storage.getAccountStats();
    res.json(stats);
  });

  app.get("/api/accounts/:id", requireAuth, async (req, res) => {
    const account = await storage.getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Not found" });
    res.json(account);
  });

  app.get("/api/billing", requireAuth, async (_req, res) => {
    const records = await storage.getAllBillingRecords();
    const total = await storage.getBillingTotal();
    res.json({ records, total });
  });

  app.get("/api/dashboard", requireAuth, async (_req, res) => {
    const stats = await storage.getAccountStats();
    const total = await storage.getBillingTotal();
    res.json({ stats, billingTotal: total });
  });

  return httpServer;
}
