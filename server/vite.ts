import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: false as const,
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use((req, res, next) => {
    if (req.url === "/@vite/client" || req.url?.startsWith("/@vite/client?")) {
      const originalEnd = res.end.bind(res);
      const originalWrite = res.write.bind(res);
      const chunks: Buffer[] = [];
      let intercepting = true;

      res.write = function(chunk: any, ...args: any[]) {
        if (intercepting && chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        }
        return originalWrite(chunk, ...args as any);
      } as any;

      res.end = function(chunk?: any, ...args: any[]) {
        if (intercepting) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          let body = Buffer.concat(chunks).toString("utf-8");
          if (body.includes("new WebSocket(")) {
            const stub = '(function(){var s={readyState:3,CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3,addEventListener:function(){},removeEventListener:function(){},send:function(){},close:function(){},dispatchEvent:function(){return false}};return s;})()';
            body = body.replace(
              /new WebSocket\([^)]*"vite-hmr"\)/g,
              stub
            );
            body = body.replace(
              /new WebSocket\([^)]*"vite-ping"\)/g,
              stub
            );
          }
          res.setHeader("content-length", Buffer.byteLength(body));
          intercepting = false;
          return originalEnd(body);
        }
        return originalEnd(chunk, ...args as any);
      } as any;
    }
    next();
  });

  app.use(vite.middlewares);

  app.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
