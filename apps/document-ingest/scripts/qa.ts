import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

import { MAX_DOCUMENT_SIZE } from "@prostapaper/contracts";

import { type EvaluationResult, reportCsv, summarizeResults, transcriptDiff } from "#eval/reporting";
import { NORMALIZATION_VERSION, scoreTranscript } from "#eval/scoring";
import { parseCandidate, parseReference } from "#eval/transcripts";
import { object, parseDataset, parseQaRequest, string } from "#qa/contracts";

const exec = promisify(execFile);
const { values } = parseArgs({
  options: {
    bucket: { type: "string" },
    function: { type: "string" },
    region: { type: "string", default: "eu-central-1" },
    profile: { type: "string" },
    qualifier: { type: "string" },
    method: { type: "string" },
    dataset: { type: "string" },
    "upload-only": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.info(
    "pnpm qa:extraction --bucket <bucket> --function <name> [--region eu-central-1] [--profile name] [--qualifier version] [--dataset path] [--method label]\nUse --upload-only to validate and upload local input/reference files without invoking Lambda.",
  );
} else {
  await main();
}

async function main(): Promise<void> {
  const bucket = string(values.bucket);
  const datasetPath = resolve(
    values.dataset ?? fileURLToPath(new URL("../../../qa/dataset.json", import.meta.url)),
  );
  const dataset = parseDataset(JSON.parse(await readFile(datasetPath, "utf8")) as unknown);
  if (dataset.length === 0) {
    throw new Error("QA dataset is empty. Add input/reference pairs to qa/dataset.json first.");
  }
  const directory = await mkdtemp(join(tmpdir(), "prostapaper-qa-"));
  const globals = ["--region", values.region, "--no-cli-pager", "--output", "json"];
  if (values.profile !== undefined) {
    globals.push("--profile", values.profile);
  }
  const aws = async (args: string[]): Promise<Record<string, unknown>> => {
    const { stdout } = await exec("aws", [...args, ...globals], { maxBuffer: 1024 * 1024 });

    return object(JSON.parse(stdout) as unknown);
  };
  const put = async (key: string, body: string | Uint8Array, contentType: string): Promise<void> => {
    const path = join(directory, randomUUID());
    await writeFile(path, body);
    await aws([
      "s3api",
      "put-object",
      "--bucket",
      bucket,
      "--key",
      key,
      "--body",
      path,
      "--content-type",
      contentType,
      "--if-none-match",
      "*",
    ]);
  };
  const get = async (key: string): Promise<{ bytes: Buffer; versionId: string; sha256: string }> => {
    const path = join(directory, randomUUID());
    const response = await aws(["s3api", "get-object", "--bucket", bucket, "--key", key, path]);
    const versionId = string(response["VersionId"]);
    if (versionId === "null") {
      throw new Error(`S3 versioning is required for ${key}`);
    }
    const bytes = await readFile(path);

    return { bytes, versionId, sha256: createHash("sha256").update(bytes).digest("hex") };
  };
  try {
    if (values["upload-only"]) {
      const files = await Promise.all(
        dataset.map(async (example) => {
          const input = await readFile(join(dirname(datasetPath), example.inputKey.slice(3)));
          const reference = await readFile(join(dirname(datasetPath), example.referenceKey.slice(3)));
          parseReference(JSON.parse(reference.toString("utf8")) as unknown);
          if (input.length === 0 || input.length > MAX_DOCUMENT_SIZE) {
            throw new Error(`Invalid input size for ${example.id}`);
          }

          return { example, input, reference };
        }),
      );
      await files.reduce(async (previous, { example, input, reference }) => {
        await previous;
        await put(example.inputKey, input, example.contentType);
        await put(example.referenceKey, reference, "application/json");
      }, Promise.resolve());
      console.info(
        `Uploaded ${dataset.length} input/reference pairs. Existing objects are never overwritten.`,
      );

      return;
    }
    const functionName = string(values.function);
    const qualifier: string[] = [];
    if (values.qualifier !== undefined) {
      qualifier.push("--qualifier", values.qualifier);
    }
    const configuration = await aws([
      "lambda",
      "get-function-configuration",
      "--function-name",
      functionName,
      ...qualifier,
    ]);
    const prepared = await Promise.all(
      dataset.map(async (example) => {
        const [input, reference] = await Promise.all([get(example.inputKey), get(example.referenceKey)]);
        if (input.bytes.length === 0 || input.bytes.length > MAX_DOCUMENT_SIZE) {
          throw new Error(`Invalid input size for ${example.id}`);
        }

        return {
          example,
          inputVersionId: input.versionId,
          inputSha256: input.sha256,
          referenceVersionId: reference.versionId,
          referenceSha256: reference.sha256,
          reference: parseReference(JSON.parse(reference.bytes.toString("utf8")) as unknown),
        };
      }),
    );
    const runId = `${new Date()
      .toISOString()
      .replaceAll(/[^\da-z]/giu, "")
      .toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const prefix = `qa/${runId}`;
    const manifest = {
      runId,
      startedAt: new Date().toISOString(),
      normalization: NORMALIZATION_VERSION,
      bucket,
      functionName,
      method: values.method ?? functionName,
      qualifier: values.qualifier ?? "$LATEST",
      deployed: {
        codeSha256: configuration["CodeSha256"],
        revisionId: configuration["RevisionId"],
        version: configuration["Version"],
        runtime: configuration["Runtime"],
        architectures: configuration["Architectures"],
        memorySize: configuration["MemorySize"],
        timeout: configuration["Timeout"],
      },
      examples: prepared.map(({ reference, ...example }) => ({
        ...example,
        referenceQuality: reference.quality,
      })),
    };
    await put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), "application/json");
    const results: EvaluationResult[] = [];
    await prepared.reduce(async (previous, item) => {
      await previous;
      const request = parseQaRequest({
        mode: "extraction-qa",
        bucket,
        runId,
        exampleId: item.example.id,
        inputKey: item.example.inputKey,
        inputVersionId: item.inputVersionId,
        contentType: item.example.contentType,
      });
      const requestPath = join(directory, `${item.example.id}-request.json`);
      const responsePath = join(directory, `${item.example.id}-response.json`);
      await writeFile(requestPath, JSON.stringify(request));
      try {
        const invocation = await aws([
          "lambda",
          "invoke",
          "--function-name",
          functionName,
          ...qualifier,
          "--invocation-type",
          "RequestResponse",
          "--cli-read-timeout",
          "660",
          "--cli-connect-timeout",
          "30",
          "--payload",
          `fileb://${requestPath}`,
          responsePath,
        ]);
        const response = object(JSON.parse(await readFile(responsePath, "utf8")) as unknown);
        if (invocation["FunctionError"] !== undefined || invocation["StatusCode"] !== 200) {
          throw new Error(`Lambda failed: ${JSON.stringify(response)}`);
        }
        const outputKey = `${prefix}/output/${item.example.id}.json`;
        if (response["outputKey"] !== outputKey) {
          throw new Error("Lambda returned an unexpected output key");
        }
        const output = await get(outputKey);
        const actual = parseCandidate(JSON.parse(output.bytes.toString("utf8")) as unknown);
        const score = scoreTranscript(item.reference.text, actual.text);
        await put(
          `${prefix}/diff/${item.example.id}.txt`,
          transcriptDiff(score),
          "text/plain; charset=utf-8",
        );
        results.push({
          id: item.example.id,
          referenceQuality: item.reference.quality,
          status: "ok",
          extraction: {
            ...response,
            executedVersion: invocation["ExecutedVersion"],
            outputVersionId: output.versionId,
            outputSha256: output.sha256,
          },
          diagnostics: actual.diagnostics,
          score,
        });
        console.info(
          `${item.example.id}: CER=${String(score.normalized.cer)} WER=${String(score.normalized.wer)}`,
        );
      } catch (error) {
        results.push({
          id: item.example.id,
          referenceQuality: item.reference.quality,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`${item.example.id}: failed`);
      }
    }, Promise.resolve());
    const after = await aws([
      "lambda",
      "get-function-configuration",
      "--function-name",
      functionName,
      ...qualifier,
    ]);
    const deploymentUnchanged =
      configuration["RevisionId"] === after["RevisionId"] &&
      configuration["CodeSha256"] === after["CodeSha256"];
    const report = {
      runId,
      method: values.method ?? functionName,
      finishedAt: new Date().toISOString(),
      deploymentUnchanged,
      ...summarizeResults(results),
      results,
    };
    await put(`${prefix}/report.json`, JSON.stringify(report, null, 2), "application/json");
    await put(`${prefix}/report.csv`, reportCsv(results), "text/csv");
    console.info(`Report: s3://${bucket}/${prefix}/report.json`);
    if (!deploymentUnchanged || report.failed > 0) {
      throw new Error("QA run failed or deployment changed during the run; see the saved report");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
