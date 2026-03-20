import { defineConfig } from "drizzle-kit";

const effectiveDatabaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!effectiveDatabaseUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: effectiveDatabaseUrl,
  },
});
