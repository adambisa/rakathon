import { z } from "zod";

import { CaseId } from "@prostapaper/contracts";

import { runQaExtraction } from "#qa/handler";

const IngestEvent = z.object({ caseId: CaseId });

export async function handler(event: unknown): Promise<unknown> {
  if (typeof event === "object" && event !== null && "mode" in event) return runQaExtraction(event);
  const request = IngestEvent.parse(event);
  const { handler: ingest } = await import("#ingest/handler");

  return ingest(request);
}
