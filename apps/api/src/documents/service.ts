import type { PresignedPost } from "@aws-sdk/s3-presigned-post";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { Document as DocumentModel, DocumentFile, DocumentKind } from "@prostapaper/contracts";
import { documents } from "@prostapaper/db/schema";

import { accessibleCaseIds, lockCase } from "#cases/access";
import type { DatabaseService, DatabaseTransaction } from "#database/service";
import { documentReadRelations, toDocument } from "#documents/model";
import type { ObjectStorageService } from "#storage/service";

const PRESIGNED_POST_TTL_SECONDS = 5 * 60;
const PRESIGNED_GET_TTL_SECONDS = 5 * 60;

export class DocumentService {
  private readonly db: DatabaseService["db"];
  constructor(
    private readonly storage: ObjectStorageService,
    database: DatabaseService,
  ) {
    this.db = database.db;
  }

  async list(ownerId: string): Promise<DocumentModel[]> {
    const rows = await this.db.query.documents.findMany({
      where: inArray(documents.caseId, accessibleCaseIds(this.db, ownerId)),
      orderBy: [desc(documents.createdAt), desc(documents.id)],
      limit: 50,
      with: documentReadRelations,
    });

    return rows.map(toDocument);
  }

  async findById(documentId: string, ownerId: string): Promise<DocumentModel> {
    return toDocument(await this.findOwnedDocument(documentId, ownerId));
  }

  private async findOwnedDocument(documentId: string, ownerId: string) {
    const row = await this.db.query.documents.findFirst({
      where: and(
        eq(documents.id, documentId),
        inArray(documents.caseId, accessibleCaseIds(this.db, ownerId)),
      ),
      with: documentReadRelations,
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

    return row;
  }

  private async lockDraft(tx: DatabaseTransaction, caseId: string, ownerId: string): Promise<void> {
    const parent = await lockCase(tx, caseId, { userId: ownerId });
    if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    if (parent.submittedAt) throw new TRPCError({ code: "CONFLICT", message: "Case documents are frozen" });
  }

  async register(
    {
      caseId,
      documentId,
      kind,
      file,
    }: { caseId: string; documentId: string; kind: DocumentKind; file: DocumentFile },
    uploadedBy: string,
  ): Promise<{ documentId: string; uploaded: boolean }> {
    const bucket = this.storage.bucketName;

    return this.db.transaction(async (tx) => {
      await this.lockDraft(tx, caseId, uploadedBy);
      const [existing] = await tx.select().from(documents).where(eq(documents.id, documentId));
      if (existing) {
        if (
          existing.caseId !== caseId ||
          existing.uploadedBy !== uploadedBy ||
          existing.kind !== kind ||
          existing.filename !== file.filename ||
          existing.contentType !== file.contentType ||
          existing.sizeBytes !== file.size
        ) {
          throw new TRPCError({ code: "CONFLICT", message: "Document registration does not match" });
        }

        return { documentId, uploaded: existing.uploadedAt !== null };
      }
      const [sibling] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.caseId, caseId), eq(documents.kind, kind)));
      if (sibling) {
        throw new TRPCError({ code: "CONFLICT", message: `The case already has its ${kind}` });
      }
      await tx
        .insert(documents)
        .values({
          id: documentId,
          caseId,
          kind,
          uploadedBy,
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: file.size,
          storageBucket: bucket,
          storageKey: `uploads/${documentId}/source`,
        })
        .returning({ id: documents.id });

      return { documentId, uploaded: false };
    });
  }

  async presignGet(
    documentId: string,
    ownerId: string,
    target: "source" | "extraction" = "source",
  ): Promise<{ url: string; expiresAt: string }> {
    const doc = await this.findOwnedDocument(documentId, ownerId);
    if (!doc.uploadedAt || doc.sourceVersionId === null) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document upload is not complete" });
    }
    if (doc.storageBucket !== this.storage.bucketName) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Document storage is not configured for this bucket",
      });
    }

    let key = doc.storageKey;
    let versionId: string | undefined = doc.sourceVersionId;
    if (target === "extraction") {
      if (doc.extractedAt === null || doc.extractionResultKey === null) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document extraction is not complete" });
      }
      key = doc.extractionResultKey;
      versionId = undefined;
    }

    const url = await this.storage.presignDownload(key, PRESIGNED_GET_TTL_SECONDS, versionId);

    return { url, expiresAt: new Date(Date.now() + PRESIGNED_GET_TTL_SECONDS * 1000).toISOString() };
  }

  async presign(
    documentId: string,
    ownerId: string,
  ): Promise<PresignedPost & { documentId: string; expiresAt: string }> {
    const owned = await this.findOwnedDocument(documentId, ownerId);

    return this.db.transaction(async (tx) => {
      await this.lockDraft(tx, owned.caseId, ownerId);
      const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
      if (!doc || doc.uploadedAt)
        throw new TRPCError({ code: "CONFLICT", message: "Document is already uploaded" });
      if (doc.storageBucket !== this.storage.bucketName || doc.sizeBytes === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Document upload requires a configured bucket and known file size",
        });
      }
      const post = await this.storage.presignUpload({
        key: doc.storageKey,
        contentType: doc.contentType,
        size: doc.sizeBytes,
        metadata: { "filename-base64url": Buffer.from(doc.filename, "utf8").toString("base64url") },
        ttlSeconds: PRESIGNED_POST_TTL_SECONDS,
      });

      return {
        documentId,
        ...post,
        expiresAt: new Date(Date.now() + PRESIGNED_POST_TTL_SECONDS * 1000).toISOString(),
      };
    });
  }
}
