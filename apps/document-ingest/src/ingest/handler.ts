import { fileURLToPath } from "node:url";

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";

import { createDatabaseClient } from "@prostapaper/db";
import { listCaseDocuments } from "@prostapaper/db/documents";
import { withCaseLock } from "@prostapaper/db/locking";
import {
  createPageReader,
  createSectorSheetDetector,
  loadSectorSheets,
  type SectorSheetDetector,
} from "@prostapaper/extraction";

import { loadEnv, loadReaderEnv } from "#ingest/env";
import { extractUploadedDocument } from "#ingest/extraction";

const tessdata = fileURLToPath(new URL("tessdata", import.meta.url));
const bundleDirectory = fileURLToPath(new URL(".", import.meta.url));

export const handler = async ({ caseId }: { caseId: string }): Promise<void> => {
  const readerConfig = loadReaderEnv();
  const env = loadEnv();
  const database = createDatabaseClient({ ...env.database, max: 2 });
  const lambda = new LambdaClient({});
  const s3 = new S3Client({});
  const reader = createPageReader(readerConfig, { tessdataDirectory: tessdata, log: console.info });
  let detector: Promise<SectorSheetDetector> | undefined;
  const sectorSheet = async (): Promise<SectorSheetDetector> =>
    (detector ??= loadSectorSheets(bundleDirectory).then(createSectorSheetDetector));
  try {
    await withCaseLock(database, `ingest:${caseId}`, async () => {
      const rows = await listCaseDocuments(database, caseId);
      if (rows.length === 0) throw new Error(`Case ${caseId} has no documents`);
      await rows.reduce(async (previous, row) => {
        await previous;
        const sourceVersionId = row.sourceVersionId;
        if (row.uploadedAt === null || sourceVersionId === null)
          throw new Error(`Document ${row.id} has no upload receipt`);
        if (row.extractedAt !== null) return;
        await extractUploadedDocument({ database, s3, reader, sectorSheet }, { ...row, sourceVersionId });
      }, Promise.resolve());
      await lambda.send(
        new InvokeCommand({
          FunctionName: env.caseMappingFunction,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({ caseId })),
        }),
      );
    });
  } finally {
    const [loaded] = await Promise.allSettled([detector]);
    if (loaded.status === "fulfilled") loaded.value?.close();
    await reader.close?.();
    lambda.destroy();
    s3.destroy();
    await database.$client.end();
  }
};
