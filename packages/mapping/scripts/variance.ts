import { readFile } from "node:fs/promises";

import { consensus } from "#consensus";
import { DEFAULT_EFFORT, DEFAULT_MODEL, mapReportText, type ReasoningEffort, summarizePasses } from "#index";

const [file, passesArg = "5", model = DEFAULT_MODEL, effortArg = DEFAULT_EFFORT] = process.argv.slice(2);
if (file === undefined) {
  throw new Error(
    "Usage: pnpm --filter @prostapaper/mapping variance <report.txt> [passes] [model] [effort]",
  );
}
const passes = Number(passesArg);
const effort = effortArg as ReasoningEffort;

const text = await readFile(file, "utf8");
const started = Date.now();
const settled = await Promise.allSettled(
  Array.from({ length: passes }, async () => mapReportText(text, { model, effort })),
);
const elapsed = Date.now() - started;
const outputs = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
const rejected = settled
  .filter((result) => result.status === "rejected")
  .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));

const result = consensus(outputs.map((output) => output.record));

const { usage, repairedPasses } = summarizePasses(outputs);

console.error(
  `${model} effort=${effort} passes=${passes} wall=${elapsed} ms tokens in=${usage.input_tokens} out=${usage.output_tokens}`,
);
console.error(
  `stable fields: ${result.stable}/${result.fields}; repaired passes: ${repairedPasses}; rejected passes: ${rejected.length}`,
);
if (result.unstable.length === 0) {
  console.error("all fields agreed");
} else {
  console.error(`unstable fields (${result.unstable.length}):\n  ${result.unstable.join("\n  ")}`);
}
console.error(`consensus: ${result.source} (closest pass ${result.closestIndex})`);
console.info(
  JSON.stringify(
    {
      model,
      effort,
      passes,
      consensusSource: result.source,
      lesionAlignment: result.lesionAlignment,
      consensusIndex: result.closestIndex,
      consensus: result.record,
      unstable: result.unstable,
      rejected,
      outputs,
    },
    null,
    2,
  ),
);
