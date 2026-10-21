import { eq } from "drizzle-orm";

import { user } from "#auth-schema";
import { createDatabaseClient } from "#client";
import { loadDatabaseConfig } from "#config";
import { cases } from "#schema";

const seedUploader = "reviewer@prostapaper.local";
const db = createDatabaseClient({ ...loadDatabaseConfig(process.env), max: 1 });
try {
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, seedUploader));
  if (!owner) throw new Error(`Seed user ${seedUploader} is missing; run the user seed first`);
  await db
    .insert(cases)
    .values({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Syntetický případ",
      ownerId: owner.id,
    })
    .onConflictDoNothing();
  console.info("Synthetic demo case seeded");
} catch (error) {
  console.error("Database seed failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
