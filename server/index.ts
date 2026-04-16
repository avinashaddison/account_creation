import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { startTelegramBot } from "./telegramBot";
import { startShopBot } from "./shopBot";
import { ensureCryptoTable, startPaymentChecker, cryptoRouter } from "./crypto/index";
import { serveStatic } from "./static";
import { createServer } from "http";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { execSync, exec } from "child_process";
import fs from "fs";

// Set browser path before any playwright import resolves launch paths
const BROWSERS_PATH = path.join(process.cwd(), ".cache/ms-playwright");
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;

function ensurePlaywrightBrowsersAsync() {
  const playwrightBin = path.join(process.cwd(), "node_modules/.bin/playwright");
  const installEnv = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH };

  function hasBrowser(prefix: string): boolean {
    if (!fs.existsSync(BROWSERS_PATH)) return false;
    return fs.readdirSync(BROWSERS_PATH).some(e => e.startsWith(prefix));
  }

  const needsHeadlessShell = !hasBrowser("chromium_headless_shell");
  const needsChromium      = !hasBrowser("chromium-");

  if (!needsHeadlessShell && !needsChromium) {
    console.log("[startup] Playwright browsers already present.");
    return;
  }

  console.log("[startup] Playwright browsers missing — installing in background...");

  // Run install asynchronously so it doesn't block server startup
  const cmd = `${process.execPath} ${playwrightBin} install chromium chromium-headless-shell`;
  const child = exec(cmd, { env: installEnv, timeout: 300000 }, (err, stdout, stderr) => {
    if (err) {
      console.warn("[startup] Playwright install failed, trying chromium-only fallback...");
      const fallbackCmd = `${process.execPath} ${playwrightBin} install chromium`;
      exec(fallbackCmd, { env: installEnv, timeout: 300000 }, (err2, stdout2) => {
        if (err2) {
          console.error("[startup] Playwright browser install failed:", err2.message);
        } else {
          process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW = "1";
          console.log("[startup] Chromium installed (headless-new mode). Output:", stdout2?.trim());
        }
      });
    } else {
      console.log("[startup] Playwright browsers installed successfully.", stdout?.trim());
    }
  });
  child.on("error", (e) => console.error("[startup] Playwright install spawn error:", e.message));
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    role: string;
  }
}

const effectiveDatabaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!effectiveDatabaseUrl) {
  console.error("FATAL: DATABASE_URL environment variable is not set");
  process.exit(1);
}

const pgPool = new pg.Pool({ connectionString: effectiveDatabaseUrl });

const PgStore = connectPgSimple(session);

// Probe whether the DB is currently reachable
async function isDbReachable(): Promise<boolean> {
  try {
    const client = await pgPool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch {
    return false;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.set("trust proxy", 1);

const sessionSecret = process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === "production"
    ? (() => { console.error("FATAL: SESSION_SECRET is required in production"); process.exit(1); return ""; })()
    : "la28-admin-dev-secret-key");

// Build session store — use PgStore if DB is reachable, otherwise MemoryStore
async function buildSessionStore(): Promise<session.Store | undefined> {
  const reachable = await isDbReachable();
  if (reachable) {
    console.log("[Session] PostgreSQL session store ready");
    return new PgStore({
      pool: pgPool,
      createTableIfMissing: true,
      tableName: "user_sessions",
      errorLog: (err: Error) => console.warn("[Session] PgStore error:", err.message),
    } as any);
  } else {
    console.warn("[Session] DB unreachable — using in-memory session store (sessions lost on restart)");
    return undefined; // express-session defaults to MemoryStore when store is undefined
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Run drizzle migrations on startup so all schema changes are applied
  try {
    const migratePool = new pg.Pool({ connectionString: effectiveDatabaseUrl });
    const migrateDb = drizzle(migratePool);
    await migrate(migrateDb, { migrationsFolder: path.join(process.cwd(), "migrations") });
    await migratePool.end();
    console.log("[Migration] Schema migrations applied");
  } catch (err: any) {
    console.warn("[Migration] Migration warning:", err.message);
  }

  // Ensure biz_mail_accounts table always exists (idempotent bootstrap)
  try {
    const { db: startupDb } = await import("./db");
    const { sql: sqlRaw } = await import("drizzle-orm");
    // Create table if missing
    await startupDb.execute(sqlRaw`
      CREATE TABLE IF NOT EXISTS biz_mail_accounts (
        id SERIAL PRIMARY KEY,
        account_num INTEGER UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `);
    // Make account_num nullable if it isn't already (idempotent via DO block)
    await startupDb.execute(sqlRaw`
      DO $$ BEGIN
        ALTER TABLE biz_mail_accounts ALTER COLUMN account_num DROP NOT NULL;
      EXCEPTION WHEN others THEN NULL;
      END $$;
    `);
    console.log("[Migration] Ensured biz_mail_accounts table exists");
  } catch (err: any) {
    console.warn("[Migration] biz_mail_accounts bootstrap warning:", err.message);
  }

  // Reset any accounts stuck in "generating" from a previous crashed run so
  // they re-enter the processing pool and are not permanently orphaned.
  try {
    const { db: startupDb } = await import("./db");
    const { replitAccounts: raTable } = await import("@shared/schema");
    const { eq: eqOp } = await import("drizzle-orm");
    const rows = await startupDb
      .update(raTable)
      .set({ status: "processing" })
      .where(eqOp(raTable.status, "generating"))
      .returning();
    if (rows.length > 0) {
      console.log(`[Startup] Reset ${rows.length} stuck "generating" account(s) → "processing"`);
    }
  } catch (err: any) {
    console.warn("[Startup] Could not reset stuck generating accounts:", err.message);
  }

  const store = await buildSessionStore();

  app.use(
    session({
      store,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
    })
  );

  await ensureCryptoTable().catch(err =>
    console.error("[Crypto] Table init failed:", err)
  );
  app.use("/api/crypto", cryptoRouter);

  await registerRoutes(httpServer, app);

  // ── Telegram Mini App page — powers the "Menu" button in the shop bot ──────
  app.get("/tma", (req, res) => {
    const bot = req.query.bot as string ?? "";
    // Telegram injects window.Telegram.WebApp automatically — no external script needed.
    // Page is transparent and closes itself as fast as possible; the user sees
    // at most a very brief flash before the bot chat shows the menu message.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent}</style>
<script>
(function(){
  var bot=${JSON.stringify(bot)};
  function go(){
    try{
      if(window.Telegram&&Telegram.WebApp){
        Telegram.WebApp.ready();
        if(bot) Telegram.WebApp.openTelegramLink('https://t.me/'+bot+'?start=show_menu');
        Telegram.WebApp.close();
      }
    }catch(e){}
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',go);}else{go();}
})();
</script>
</head><body></body></html>`);
  });

  // ── Webhook domain detection ─────────────────────────────────────────────
  // Priority:
  //  1. WEBHOOK_DOMAIN secret  – explicit override (use this on production VM
  //                              or Replit deployment with a custom/app domain)
  //  2. REPLIT_DEV_DOMAIN      – only used when NOT in a Replit deployment,
  //                              i.e. the dev workspace server is actually live
  //  3. None → long-polling fallback (safe default for deployed app)
  //
  // IMPORTANT: REPLIT_DEV_DOMAIN is the *dev-workspace* tunnel URL.  It only
  // serves traffic while the dev workflow is running.  The deployed app must
  // NOT register that URL as its webhook or bots will go silent the moment
  // the dev workflow is stopped.
  const isReplitDeployment = process.env.REPLIT_DEPLOYMENT === "1";
  const rawDomain =
    process.env.WEBHOOK_DOMAIN ||
    (!isReplitDeployment && process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "");
  const webhookDomain = rawDomain.trim().replace(/\/$/, "");
  const webhookConfig = webhookDomain
    ? { domain: webhookDomain, register: (path: string, handler: any) => app.use(path, handler) }
    : undefined;

  if (webhookDomain) {
    console.log(`[Bots] Webhook mode → ${webhookDomain}`);
  } else if (isReplitDeployment) {
    console.log("[Bots] Deployed app — polling mode (set WEBHOOK_DOMAIN secret to use webhook mode)");
  } else {
    console.log("[Bots] Polling mode (no WEBHOOK_DOMAIN found)");
  }

  // Start primary Telegram bot
  const primaryToken = process.env.TELEGRAM_BOT_TOKEN;
  if (primaryToken) {
    startTelegramBot({ token: primaryToken, allowedIdsEnv: "TELEGRAM_ALLOWED_IDS", label: "Bot1", webhook: webhookConfig });
  } else {
    console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — primary bot disabled");
  }

  // Start secondary Telegram bot — Project Addison v2 (customer shop bot)
  const secondaryToken = process.env.TELEGRAM_BOT_TOKEN_2;
  if (secondaryToken) {
    startShopBot(secondaryToken, webhookConfig);
    console.log("[ShopBot] Project Addison v2 shop bot starting...");
  }

  // Start crypto payment auto-checker background job
  startPaymentChecker();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    // Force browsers to always revalidate assets in dev — prevents stale cached JS
    app.use((req, res, next) => {
      if (!req.path.startsWith("/api")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
      next();
    });
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      // Install Playwright browsers in the background after server is up
      ensurePlaywrightBrowsersAsync();
      // smtp.dev handles all @addison.asia biz mail routing automatically
    },
  );
})();
