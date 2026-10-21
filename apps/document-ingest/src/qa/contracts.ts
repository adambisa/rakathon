import { DocumentContentType } from "@prostapaper/contracts";

const QA_ID = /^[\da-z][\da-z_-]{0,79}$/u;

export interface QaRequest {
  mode: "extraction-qa";
  bucket: string;
  runId: string;
  exampleId: string;
  inputKey: string;
  inputVersionId: string;
  contentType: DocumentContentType;
}

export interface QaExample {
  id: string;
  inputKey: string;
  referenceKey: string;
  contentType: DocumentContentType;
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object");
  }

  return value as Record<string, unknown>;
}

export function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected a nonempty string");
  }

  return value;
}

function id(value: unknown): string {
  const result = string(value);
  if (!QA_ID.test(result)) {
    throw new Error(`Invalid QA identifier: ${result}`);
  }

  return result;
}

function runId(value: unknown): string {
  const result = id(value);
  if (["input", "reference", "gold"].includes(result)) {
    throw new Error("QA run ID cannot use a reserved dataset prefix");
  }

  return result;
}

function key(value: unknown, prefix: string): string {
  const result = string(value);
  if (
    !result.startsWith(prefix) ||
    result.length === prefix.length ||
    result.split("/").some((part) => ["..", ".", ""].includes(part))
  ) {
    throw new Error(`Expected a key under ${prefix}`);
  }

  return result;
}

export function parseQaRequest(value: unknown): QaRequest {
  const request = object(value);
  if (request["mode"] !== "extraction-qa") {
    throw new Error("Unknown invocation mode");
  }
  const inputVersionId = string(request["inputVersionId"]);
  if (inputVersionId === "null") {
    throw new Error("QA inputs must have an S3 version ID");
  }

  return {
    mode: "extraction-qa",
    bucket: string(request["bucket"]),
    runId: runId(request["runId"]),
    exampleId: id(request["exampleId"]),
    inputKey: key(request["inputKey"], "qa/input/"),
    inputVersionId,
    contentType: DocumentContentType.parse(request["contentType"]),
  };
}

export function parseDataset(value: unknown): QaExample[] {
  const dataset = object(value);
  if (dataset["version"] !== 1 || !Array.isArray(dataset["examples"])) {
    throw new Error("Expected dataset version 1 with an examples array");
  }
  const ids = new Set<string>();

  return dataset["examples"].map((value: unknown) => {
    const example = object(value);
    const exampleId = id(example["id"]);
    if (ids.has(exampleId)) {
      throw new Error(`Duplicate example ID: ${exampleId}`);
    }
    ids.add(exampleId);

    return {
      id: exampleId,
      inputKey: key(example["inputKey"], "qa/input/"),
      referenceKey: key(example["referenceKey"], "qa/reference/"),
      contentType: DocumentContentType.parse(example["contentType"]),
    };
  });
}
