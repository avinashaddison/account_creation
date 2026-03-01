import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type Registration = {
  id: string;
  tempEmail: string;
  tempEmailPassword: string;
  firstName: string;
  lastName: string;
  la28Password: string;
  country: string;
  language: string;
  status: "pending" | "registering" | "waiting_code" | "verifying" | "verified" | "failed";
  verificationCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type InsertRegistration = Omit<Registration, "id" | "createdAt" | "verificationCode" | "errorMessage">;
