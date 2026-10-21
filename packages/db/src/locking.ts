import type { Database } from "#client";

export async function withCaseLock(db: Database, key: string, run: () => Promise<void>): Promise<void> {
  const connection = await db.$client.connect();
  const normalized = key.toLowerCase();
  let locked = false;
  try {
    const result = await connection.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
      [normalized],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error(`Case processing lock is busy: ${normalized}`);
    await run();
  } finally {
    try {
      if (locked) await connection.query("select pg_advisory_unlock(hashtextextended($1, 0))", [normalized]);
    } finally {
      // Destroy the dedicated session so a failed unlock cannot leave a lock in the pool.
      connection.release(true);
    }
  }
}
