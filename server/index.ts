import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import pg from "pg";

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

const effectiveDatabaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
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

  await registerRoutes(httpServer, app);

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
    },
  );
})();
