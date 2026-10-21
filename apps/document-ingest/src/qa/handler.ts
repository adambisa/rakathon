import { fileURLToPath } from "node:url";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { ExtractedDocument, MAX_DOCUMENT_SIZE } from "@prostapaper/contracts";
import { EXTRACTION_SETTINGS } from "@prostapaper/extraction/assets";

import { loadReaderEnv } from "#ingest/env";
import { parseQaRequest } from "#qa/contracts";

export async function runQaExtraction(event: unknown): Promise<{
  outputKey: string;
  durationMs: number;
  settings: typeof EXTRACTION_SETTINGS;
}> {
  const request = parseQaRequest(event);
  const s3 = new S3Client({});
  try {
    const source = await s3.send(
      new GetObjectCommand({
        Bucket: request.bucket,
        Key: request.inputKey,
        VersionId: request.inputVersionId,
      }),
    );
    if (!source.Body || source.ContentLength === undefined || source.ContentLength > MAX_DOCUMENT_SIZE) {
      throw new Error("QA input is missing or exceeds the document size limit");
    }
    const bytes = await source.Body.transformToByteArray();
    if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_SIZE) {
      throw new Error(`QA input must contain 1–${MAX_DOCUMENT_SIZE} bytes`);
    }
    const started = performance.now();
    const { createPageReader, extractDocument } = await import("@prostapaper/extraction");
    const reader = createPageReader(loadReaderEnv(), {
      tessdataDirectory: fileURLToPath(new URL("tessdata", import.meta.url)),
      log: console.info,
    });
    let result: ExtractedDocument;
    try {
      result = ExtractedDocument.parse(
        await extractDocument({ bytes, contentType: request.contentType }, reader),
      );
    } finally {
      await reader.close?.();
    }
    const durationMs = Math.round(performance.now() - started);
    const outputKey = `qa/${request.runId}/output/${request.exampleId}.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: request.bucket,
        Key: outputKey,
        Body: JSON.stringify(result),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    );

    return { outputKey, durationMs, settings: EXTRACTION_SETTINGS };
  } finally {
    s3.destroy();
  }
}
