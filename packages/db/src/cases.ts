import { and, eq, isNull, sql } from "drizzle-orm";

import { type Executor, now } from "#executor";
import { cases } from "#schema";

export type CaseRow = typeof cases.$inferSelect;

export async function submitCase(db: Executor, caseId: string): Promise<boolean> {
  const rows = await db
    .update(cases)
    .set({ submittedAt: now, updatedAt: now })
    .where(and(eq(cases.id, caseId), isNull(cases.submittedAt)))
    .returning({ id: cases.id });

  return rows.length === 1;
}

export async function startReview(db: Executor, caseId: string): Promise<boolean> {
  const rows = await db
    .update(cases)
    .set({ reviewStartedAt: now, updatedAt: now })
    .where(and(eq(cases.id, caseId), sql`${cases.mappedAt} is not null`, isNull(cases.reviewStartedAt)))
    .returning({ id: cases.id });

  return rows.length === 1;
}

export async function approveCase(db: Executor, caseId: string, approvedBy: string): Promise<boolean> {
  const rows = await db
    .update(cases)
    .set({ approvedAt: now, approvedBy, updatedAt: now })
    .where(and(eq(cases.id, caseId), sql`${cases.reviewStartedAt} is not null`, isNull(cases.approvedAt)))
    .returning({ id: cases.id });

  return rows.length === 1;
}

export async function startMapping(db: Executor, caseId: string): Promise<boolean> {
  const rows = await db
    .update(cases)
    .set({ mappingStartedAt: now, updatedAt: now })
    .where(and(eq(cases.id, caseId), sql`${cases.submittedAt} is not null`, isNull(cases.mappedAt)))
    .returning({ id: cases.id });

  return rows.length === 1;
}

export async function completeMapping(db: Executor, caseId: string, mappingResultKey: string): Promise<void> {
  await db
    .update(cases)
    .set({ mappedAt: now, mappingResultKey, updatedAt: now })
    .where(and(eq(cases.id, caseId), isNull(cases.mappedAt)));
}
