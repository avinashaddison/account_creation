import { type User, type InsertUser, type Registration, type InsertRegistration } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createRegistration(reg: InsertRegistration): Promise<Registration>;
  updateRegistration(id: string, updates: Partial<Registration>): Promise<Registration | undefined>;
  getRegistration(id: string): Promise<Registration | undefined>;
  getAllRegistrations(): Promise<Registration[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private registrations: Map<string, Registration>;

  constructor() {
    this.users = new Map();
    this.registrations = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createRegistration(reg: InsertRegistration): Promise<Registration> {
    const id = randomUUID();
    const registration: Registration = {
      ...reg,
      id,
      verificationCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    };
    this.registrations.set(id, registration);
    return registration;
  }

  async updateRegistration(id: string, updates: Partial<Registration>): Promise<Registration | undefined> {
    const existing = this.registrations.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.registrations.set(id, updated);
    return updated;
  }

  async getRegistration(id: string): Promise<Registration | undefined> {
    return this.registrations.get(id);
  }

  async getAllRegistrations(): Promise<Registration[]> {
    return Array.from(this.registrations.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}

export const storage = new MemStorage();
