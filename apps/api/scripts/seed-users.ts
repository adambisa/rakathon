import { z } from "zod";

import { AuthService, type NewUser } from "#auth/service";
import { DatabaseService } from "#database/service";
import { loadEnv } from "#env";

const { SEED_USER_PASSWORD: password } = z
  .object({ SEED_USER_PASSWORD: z.string().min(8) })
  .parse(process.env);

const accounts: NewUser[] = [
  { email: "reviewer@prostapaper.local", name: "Reviewer", password, role: "reviewer" },
  { email: "admin@prostapaper.local", name: "Admin", password, role: "admin" },
];

const database = new DatabaseService();
const auth = new AuthService(loadEnv(), database);

try {
  await Promise.all(accounts.map(async (account) => auth.createUser(account)));
  console.info(`Seeded ${accounts.map((account) => account.email).join(", ")}`);
} catch (error) {
  console.error("User seed failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
