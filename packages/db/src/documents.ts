import { and, eq, isNull } from "drizzle-orm";

import { type Executor, now } from "#executor";
import { documents } from "#schema";

export type DocumentRow = typeof documents.$inferSelect;

export async function markUploaded(db: Executor, documentId: string, versionId: string): Promise<void> {
  await db
    .update(documents)
    .set({ uploadedAt: now, sourceVersionId: versionId, updatedAt: now })
    .where(and(eq(documents.id, documentId), isNull(documents.uploadedAt)));
}

export async function startExtraction(db: Executor, documentId: string): Promise<void> {
  await db
    .update(documents)
    .set({ extractionStartedAt: now, updatedAt: now })
    .where(and(eq(documents.id, documentId), isNull(documents.extractionStartedAt)));
}

export async function completeExtraction(
  db: Executor,
  documentId: string,
  extractionResultKey: string,
): Promise<void> {
  await db
    .update(documents)
    .set({ extractedAt: now, extractionResultKey, updatedAt: now })
    .where(and(eq(documents.id, documentId), isNull(documents.extractedAt)));
}

export async function listCaseDocuments(db: Executor, caseId: string): Promise<DocumentRow[]> {
  return db
    .select()
    .from(documents)
    .where(eq(documents.caseId, caseId))
    .orderBy(documents.createdAt, documents.id);
}
