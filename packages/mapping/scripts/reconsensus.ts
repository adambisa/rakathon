import { readFile, writeFile } from "node:fs/promises";

import { SurgeryRecord } from "@prostapaper/contracts";

import { consensus } from "#consensus";

const files = process.argv.slice(2);
if (files.length === 0) {
  throw new Error("Usage: pnpm --filter @prostapaper/mapping reconsensus <variance.json>...");
}

async function recompute(file: string): Promise<string> {
  const batch = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const outputs = (batch["outputs"] as { record: unknown }[]).map((output) =>
    SurgeryRecord.parse(output.record),
  );
  const result = consensus(outputs);
  await writeFile(
    file,
    JSON.stringify(
      {
        ...batch,
        consensusSource: result.source,
        lesionAlignment: result.lesionAlignment,
        consensusIndex: result.closestIndex,
        consensus: result.record,
        unstable: result.unstable,
      },
      null,
      2,
    ),
  );

  return `${file}: ${result.source}, stable ${result.stable}/${result.fields}, unstable ${result.unstable.length}`;
}

const lines = await Promise.all(files.map(recompute));
console.error(lines.join("\n"));
