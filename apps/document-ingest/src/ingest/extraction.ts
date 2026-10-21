import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import { DocumentContentType } from "@prostapaper/contracts";
import type { Database } from "@prostapaper/db";
import { completeExtraction, type DocumentRow, startExtraction } from "@prostapaper/db/documents";
import { extractors, type PageReader, type SectorSheetDetector } from "@prostapaper/extraction";

type UploadedDocument = DocumentRow & { sourceVersionId: string };

export interface IngestContext {
  database: Database;
  s3: S3Client;
  reader: PageReader;
  /** Loaded on first use, so a report never pays for OpenCV. */
  sectorSheet: () => Promise<SectorSheetDetector>;
}

export async function extractUploadedDocument(
  { database, s3, reader, sectorSheet }: IngestContext,
  row: UploadedDocument,
): Promise<void> {
  await startExtraction(database, row.id);

  // The recorded version, never whichever object happens to be current.
  const source = await s3.send(
    new GetObjectCommand({ Bucket: row.storageBucket, Key: row.storageKey, VersionId: row.sourceVersionId }),
  );
  if (!source.Body) {
    throw new Error(`Empty body for ${row.storageKey} version ${row.sourceVersionId}`);
  }

  const input = {
    bytes: await source.Body.transformToByteArray(),
    contentType: DocumentContentType.parse(row.contentType),
  };
  const extracted = await extractors[row.kind](input, { reader, sectorSheet, log: console.info });
  const extractionResultKey = `derived/${row.id}/document.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: row.storageBucket,
      Key: extractionResultKey,
      Body: JSON.stringify(extracted),
      ContentType: "application/json",
    }),
  );

  await completeExtraction(database, row.id, extractionResultKey);
}
