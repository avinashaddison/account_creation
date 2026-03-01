import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getAvailableDomain, createTempEmail, getAuthToken, pollForVerificationCode, generateRandomUsername } from "./mailService";
import { fullRegistrationFlow } from "./playwrightService";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post("/api/register", async (req, res) => {
    try {
      const { firstName, lastName, password, country = "India", language = "English" } = req.body;

      if (!firstName || !lastName || !password) {
        return res.status(400).json({ error: "firstName, lastName, and password are required" });
      }

      const domain = await getAvailableDomain();
      const username = generateRandomUsername();
      const tempEmail = `${username}@${domain}`;
      const tempEmailPassword = "TempPass123!";

      const reg = await storage.createRegistration({
        tempEmail,
        tempEmailPassword,
        firstName,
        lastName,
        la28Password: password,
        country,
        language,
        status: "pending",
      });

      res.json({ id: reg.id, tempEmail, status: "pending" });

      (async () => {
        try {
          console.log(`[Register] Creating temp email: ${tempEmail}`);
          await createTempEmail(tempEmail, tempEmailPassword);
          const token = await getAuthToken(tempEmail, tempEmailPassword);
          console.log(`[Register] Temp email ready, token obtained`);

          const result = await fullRegistrationFlow(
            tempEmail,
            firstName,
            lastName,
            password,
            country,
            language,
            async (status) => {
              await storage.updateRegistration(reg.id, { status: status as any });
            },
            async () => {
              const code = await pollForVerificationCode(token, 40, 3000);
              if (code) {
                await storage.updateRegistration(reg.id, { verificationCode: code });
              }
              return code;
            }
          );

          if (result.success) {
            await storage.updateRegistration(reg.id, { status: "verified" });
            console.log(`[Register] Registration verified successfully!`);
          } else {
            await storage.updateRegistration(reg.id, {
              status: "failed",
              errorMessage: result.error || "Registration failed",
            });
            console.log(`[Register] Registration failed: ${result.error}`);
          }
        } catch (err: any) {
          console.error(`[Register] Error:`, err.message);
          await storage.updateRegistration(reg.id, { status: "failed", errorMessage: err.message });
        }
      })();
    } catch (err: any) {
      console.error("[API] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/registrations", async (_req, res) => {
    const all = await storage.getAllRegistrations();
    res.json(all);
  });

  app.get("/api/registrations/:id", async (req, res) => {
    const reg = await storage.getRegistration(req.params.id);
    if (!reg) return res.status(404).json({ error: "Not found" });
    res.json(reg);
  });

  return httpServer;
}
