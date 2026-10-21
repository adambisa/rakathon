import { z } from "zod";

import { SectorMap } from "#sector";

export const DocumentPageSource = z.enum(["ocr", "model", "opencv"]);
export type DocumentPageSource = z.infer<typeof DocumentPageSource>;

export const DocumentPage = z
  .object({
    page: z.int().positive(),
    text: z.string(),
    source: DocumentPageSource,
  })
  .readonly();
export type DocumentPage = z.infer<typeof DocumentPage>;

/** Output of the extraction pipeline and sole input of the mapping pipeline. */
export const ExtractedDocument = z
  .object({
    pages: z.array(DocumentPage).min(1),
    sectorMap: SectorMap.optional().meta({
      description: "Machine reading of the hand-marked sector sheet, one entry per pen mark",
    }),
  })
  .readonly();
export type ExtractedDocument = z.infer<typeof ExtractedDocument>;

export const MAX_DOCUMENT_SIZE = 20_000_000;
export const MAX_DOCUMENT_FILENAME_LENGTH = 255;
/** The hospital scans both documents as 300 DPI JPEG; nothing else is accepted. */
export const DocumentContentType = z.enum(["image/jpeg"]);
export type DocumentContentType = z.infer<typeof DocumentContentType>;
export const DOCUMENT_ACCEPT: Record<DocumentContentType, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
};

export const DocumentFile = z
  .object({
    filename: z.string().trim().min(1).max(MAX_DOCUMENT_FILENAME_LENGTH),
    contentType: DocumentContentType,
    size: z.int().positive().max(MAX_DOCUMENT_SIZE),
  })
  .refine(
    ({ filename, contentType }) =>
      DOCUMENT_ACCEPT[contentType].some((extension) => filename.toLowerCase().endsWith(extension)),
    { message: "File extension does not match content type", path: ["filename"] },
  );
export type DocumentFile = z.infer<typeof DocumentFile>;

export const DocumentId = z.uuid();
/** A case carries one pathology report and one hand-drawn schema, picked by the uploader, which routes extraction. */
export const DocumentKind = z.enum(["text_description", "sector_map"]);
export type DocumentKind = z.infer<typeof DocumentKind>;
export const MAX_CASE_DOCUMENTS = DocumentKind.options.length;
export const DocumentStatus = z.enum(["awaiting_upload", "uploaded", "extracting", "extracted"]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;
export const Document = z
  .object({
    id: DocumentId,
    caseId: z.uuid(),
    filename: z.string().trim().min(1).max(MAX_DOCUMENT_FILENAME_LENGTH),
    status: DocumentStatus,
    kind: DocumentKind,
    sizeBytes: z.int().positive().nullable(),
    contentType: DocumentContentType,
    uploadedBy: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        email: z.email(),
        image: z.url().nullable().default(null),
      })
      .readonly(),
    createdAt: z.iso.datetime(),
    uploadedAt: z.iso.datetime().nullable(),
    extractionStartedAt: z.iso.datetime().nullable(),
    extractedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .readonly();
export type Document = z.infer<typeof Document>;
