import { Document, type Document as DocumentModel } from "@prostapaper/contracts";
import type { documents } from "@prostapaper/db/schema";

export const documentReadRelations = {
  uploader: { columns: { id: true, name: true, displayEmail: true, image: true } },
} as const;

interface DocumentUploader {
  id: string;
  name: string;
  displayEmail: string;
  image: string | null;
}

type DocumentRow = typeof documents.$inferSelect & {
  uploader: DocumentUploader;
};

export function toDocument(row: DocumentRow): DocumentModel {
  return Document.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    extractionStartedAt: row.extractionStartedAt?.toISOString() ?? null,
    extractedAt: row.extractedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    uploadedBy: {
      id: row.uploader.id,
      name: row.uploader.name,
      email: row.uploader.displayEmail,
      image: row.uploader.image,
    },
  });
}
