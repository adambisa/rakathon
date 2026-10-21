import { and, eq, or, type SQL, sql, type SQLWrapper } from "drizzle-orm";

import type { CaseStatus } from "@prostapaper/contracts";
import { caseMembers, cases } from "@prostapaper/db/schema";

import type { DatabaseService, DatabaseTransaction } from "#database/service";

type Access = "read" | "review" | "owner";

export function caseAccess(userId: string, access: Access = "read"): SQL {
  const owner = eq(cases.ownerId, userId);
  if (access === "owner") return owner;
  // Keep membership columns qualified inside the subquery: relational reads
  // rewrite interpolated Drizzle columns to the outer table alias.
  const role = access === "review" ? sql`and membership.role = 'reviewer'` : sql``;

  return sql`${or(
    owner,
    sql`exists (select 1 from ${caseMembers} membership where membership.case_id = ${cases.id} and membership.user_id = ${userId} ${role})`,
  )}`;
}

export function accessibleCaseIds(db: DatabaseService["db"], userId: string): SQLWrapper {
  return db.select({ id: cases.id }).from(cases).where(caseAccess(userId));
}

interface LockedCase {
  id: string;
  submittedAt: Date | null;
  status: CaseStatus;
  mappingResultKey: string | null;
}

export async function lockCase(
  tx: DatabaseTransaction,
  caseId: string,
  { userId, access = "review" }: { userId: string; access?: Access },
): Promise<LockedCase | undefined> {
  const [row] = await tx
    .select({
      id: cases.id,
      submittedAt: cases.submittedAt,
      status: cases.status,
      mappingResultKey: cases.mappingResultKey,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), caseAccess(userId, access)))
    .for("update");
  if (row) await tx.execute(sql`select set_config('app.actor_id', ${userId}, true)`);

  return row;
}
