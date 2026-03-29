import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Get admin user password hash
  const users = await db.execute(sql`SELECT email, password, role FROM users LIMIT 10`);
  console.log("Users:", JSON.stringify(users.rows, null, 2));
}
main().catch(console.error).finally(() => process.exit(0));
