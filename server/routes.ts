import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { getAvailableDomain, createTempEmail, getAuthToken, pollForVerificationCode, generateRandomUsername } from "./mailService";
import { fullRegistrationFlow } from "./playwrightService";
import { randomUUID } from "crypto";

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Lisa", "Matthew", "Nancy",
  "Arjun", "Priya", "Rahul", "Anita", "Vikram", "Sneha", "Amit", "Pooja",
  "Raj", "Neha", "Sanjay", "Divya", "Arun", "Kavita", "Suresh", "Meena",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore",
  "Kumar", "Sharma", "Singh", "Patel", "Gupta", "Mehta", "Verma", "Jain",
  "Reddy", "Nair", "Rao", "Mishra", "Chopra", "Malhotra", "Bhat", "Das",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const special = "@#$!%&";
  const all = upper + lower + digits + special;
  let pwd = special[Math.floor(Math.random() * special.length)]
    + upper[Math.floor(Math.random() * upper.length)]
    + upper[Math.floor(Math.random() * upper.length)]
    + lower[Math.floor(Math.random() * lower.length)]
    + lower[Math.floor(Math.random() * lower.length)];
  for (let i = 0; i < 7; i++) pwd += all[Math.floor(Math.random() * all.length)];
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
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

  app.post("/api/create-batch", async (req, res) => {
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

  app.post("/api/create-single", async (req, res) => {
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

  app.get("/api/accounts", async (_req, res) => {
    const all = await storage.getAllAccounts();
    res.json(all);
  });

  app.get("/api/accounts/stats", async (_req, res) => {
    const stats = await storage.getAccountStats();
    res.json(stats);
  });

  app.get("/api/accounts/:id", async (req, res) => {
    const account = await storage.getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Not found" });
    res.json(account);
  });

  app.get("/api/billing", async (_req, res) => {
    const records = await storage.getAllBillingRecords();
    const total = await storage.getBillingTotal();
    res.json({ records, total });
  });

  app.get("/api/dashboard", async (_req, res) => {
    const stats = await storage.getAccountStats();
    const total = await storage.getBillingTotal();
    res.json({ stats, billingTotal: total });
  });

  return httpServer;
}
