type Level = "INFO" | "WARN" | "ERROR" | "DEBUG";

function log(level: Level, context: string, message: string, data?: unknown) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [CRYPTO-${level}] [${context}] ${message}`;
  const out  = level === "ERROR" ? console.error : console.log;
  if (data !== undefined) {
    out(line, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    out(line);
  }
}

export const logger = {
  info:  (ctx: string, msg: string, data?: unknown) => log("INFO",  ctx, msg, data),
  warn:  (ctx: string, msg: string, data?: unknown) => log("WARN",  ctx, msg, data),
  error: (ctx: string, msg: string, data?: unknown) => log("ERROR", ctx, msg, data),
  debug: (ctx: string, msg: string, data?: unknown) => log("DEBUG", ctx, msg, data),
};
