import { createHash } from "node:crypto";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { ExtractedDocument } from "@prostapaper/contracts";
import { createDatabaseClient, type Database } from "@prostapaper/db";
import { completeMapping, startMapping } from "@prostapaper/db/cases";
import { type DocumentRow, listCaseDocuments } from "@prostapaper/db/documents";
import { withCaseLock } from "@prostapaper/db/locking";
import { type CaseDocumentText, mapCaseDocuments } from "@prostapaper/mapping";

import { type Env, loadEnv } from "#env";
import { readSecret } from "#secret";
import { MappingEvent } from "#trigger";

interface Context {
  database: Database;
  s3: S3Client;
  env: Env;
  apiKey: string;
}

async function loadDocuments(s3: S3Client, rows: readonly DocumentRow[]): Promise<CaseDocumentText[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (row.extractionResultKey === null) {
        throw new Error(`Document ${row.id} has no extraction result`);
      }
      const object = await s3.send(
        new GetObjectCommand({ Bucket: row.storageBucket, Key: row.extractionResultKey }),
      );
      if (!object.Body) {
        throw new Error(`Empty extraction result ${row.extractionResultKey}`);
      }

      const body = await object.Body.transformToString();

      return {
        documentId: row.id,
        sourceVersion: row.sourceVersionId ?? undefined,
        extractionIdentity: `sha256:${createHash("sha256").update(body).digest("hex")}`,
        filename: row.filename,
        kind: row.kind,
        extracted: ExtractedDocument.parse(JSON.parse(body)),
      };
    }),
  );
}

async function mapCase({ database, s3, env, apiKey }: Context, caseId: string): Promise<void> {
  const rows = await listCaseDocuments(database, caseId);
  const bucket = rows[0]?.storageBucket;
  if (bucket === undefined) {
    throw new Error(`Case ${caseId} has no documents`);
  }
  const documents = await loadDocuments(s3, rows);
  const output = await mapCaseDocuments(documents, {
    passes: env.passes,
    model: env.model,
    citations: env.citations,
    apiKey,
  });
  const mappingResultKey = `mapping/${caseId}/record.json`;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: mappingResultKey,
        Body: JSON.stringify(output),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "PreconditionFailed") throw error;
  }
  await completeMapping(database, caseId, mappingResultKey);
}

export async function handler(event: unknown): Promise<void> {
  const { caseId } = MappingEvent.parse(event);
  const env = loadEnv();
  const database = createDatabaseClient({ ...env.database, max: 2 });
  const s3 = new S3Client({});
  try {
    await withCaseLock(database, `mapping:${caseId}`, async () => {
      if (!(await startMapping(database, caseId))) return;
      const apiKey = await readSecret(env.openaiApiKeyParameter);
      await mapCase({ database, s3, env, apiKey }, caseId);
      console.info({ caseId, outcome: "mapped" });
    });
  } finally {
    s3.destroy();
    await database.$client.end();
  }
}
