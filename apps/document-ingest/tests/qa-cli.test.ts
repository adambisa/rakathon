import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { object } from "#qa/contracts";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/qa.ts", import.meta.url));

interface Fixture {
  directory: string;
  storage: string;
  dataset: string;
  invoke: () => Promise<{ stdout: string; stderr: string }>;
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "qa-cli-test-"));
  const storage = join(directory, "storage");
  await mkdir(join(storage, "qa/input"), { recursive: true });
  await mkdir(join(storage, "qa/reference"), { recursive: true });
  await writeFile(join(storage, "qa/input/report.jpg"), "input document bytes");
  await writeFile(
    join(storage, "qa/reference/report.json"),
    JSON.stringify({
      version: 1,
      quality: "silver",
      text: "PSA 0,12",
    }),
  );
  const dataset = join(directory, "dataset.json");
  await writeFile(
    dataset,
    JSON.stringify({
      version: 1,
      examples: [
        {
          id: "report",
          inputKey: "qa/input/report.jpg",
          referenceKey: "qa/reference/report.json",
          contentType: "image/jpeg",
        },
      ],
    }),
  );
  await writeFile(join(storage, "qa/dataset.json"), await readFile(dataset));
  const mock = String.raw`#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const root = ${JSON.stringify(storage)};
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const [service, action] = args;
const config = { CodeSha256: 'deployed-sha', RevisionId: 'revision', Version: '$LATEST', Runtime: 'nodejs22.x', Architectures: ['arm64'], MemorySize: 3008, Timeout: 600 };
if (service === 's3api') {
  const path = join(root, option('--key'));
  if (action === 'get-object') {
    await copyFile(path, args[args.indexOf('--key') + 2]);
  } else if (action === 'put-object') {
    try { await access(path); throw new Error('precondition failed'); }
    catch (error) { if (error.message === 'precondition failed') throw error; }
    await mkdir(dirname(path), { recursive: true });
    await copyFile(option('--body'), path);
  } else { throw new Error('unexpected s3 command'); }
  console.log(JSON.stringify({ VersionId: 'version-1' }));
} else if (service === 'lambda' && action === 'get-function-configuration') {
  console.log(JSON.stringify(config));
} else if (service === 'lambda' && action === 'invoke') {
  const request = JSON.parse(await readFile(option('--payload').slice(8), 'utf8'));
  if (request.inputVersionId !== 'version-1') throw new Error('unpinned input');
  const responsePath = args[args.indexOf('--payload') + 2];
    const outputKey = 'qa/' + request.runId + '/output/report.json';
    await mkdir(dirname(join(root, outputKey)), { recursive: true });
    await writeFile(join(root, outputKey), JSON.stringify({ text: 'PSA\n0,13', diagnostics: { provider: 'fixture' } }));
    await writeFile(responsePath, JSON.stringify({ outputKey, durationMs: 42, settings: { provider: "fixture" } }));
    console.log(JSON.stringify({ StatusCode: 200, ExecutedVersion: '$LATEST' }));
} else { throw new Error('unexpected command'); }
`;
  const binary = join(directory, "aws");
  await writeFile(binary, mock);
  await chmod(binary, 0o755);

  return {
    directory,
    storage,
    dataset,
    invoke: async () => {
      const args = ["--bucket", "documents", "--function", "ingest", "--dataset", dataset];

      return exec("bash", [
        "-c",
        'export PATH="$1:$PATH"; shift; exec "$@"',
        "qa-test",
        directory,
        process.execPath,
        script,
        ...args,
      ]);
    },
  };
}

async function report(fixture: Fixture): Promise<Record<string, unknown>> {
  const directories = await readdir(join(fixture.storage, "qa"));
  const run = directories.find((name) => name !== "input" && name !== "reference");
  assert.ok(run !== undefined);

  return object(
    JSON.parse(await readFile(join(fixture.storage, "qa", run, "report.json"), "utf8")) as unknown,
  );
}

await test("CLI saves reproducible outputs, diffs and raw/normalized reports", async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.storage, "qa/reference/report.json"), "utf8");
    await f.invoke();
    const result = await report(f);
    assert.equal(result["failed"], 0);
    assert.equal(result["deploymentUnchanged"], true);
    assert.equal(object(result["raw"])["characterErrors"], 2);
    assert.equal(object(result["normalized"])["characterErrors"], 1);
    assert.equal(await readFile(join(f.storage, "qa/reference/report.json"), "utf8"), before);
    const directories = await readdir(join(f.storage, "qa"));
    const run_ = directories.find((name) => name !== "input" && name !== "reference");
    const run = run_ ?? "missing";
    const manifest = object(
      JSON.parse(await readFile(join(f.storage, "qa", run, "manifest.json"), "utf8")) as unknown,
    );
    assert.equal(object(manifest["deployed"])["codeSha256"], "deployed-sha");
    assert.match(await readFile(join(f.storage, "qa", run, "report.csv"), "utf8"), /report,silver,ok/u);
    assert.match(
      await readFile(join(f.storage, "qa", run, "diff/report.txt"), "utf8"),
      /REFERENCE:\nPSA 0,12/u,
    );
    const local = join(f.directory, "local-report");
    const scoreScript = fileURLToPath(new URL("../scripts/qa-score.ts", import.meta.url));
    await exec(process.execPath, [
      scoreScript,
      "--dataset",
      join(f.storage, "qa/dataset.json"),
      "--outputs",
      join(f.storage, "qa", run, "output"),
      "--report",
      local,
      "--method",
      "any-extractor",
    ]);
    const localReport = object(JSON.parse(await readFile(join(local, "report.json"), "utf8")) as unknown);
    assert.equal(localReport["method"], "any-extractor");
    assert.deepEqual(localReport["normalized"], result["normalized"]);
    assert.equal(object(object(localReport["byReferenceQuality"])["silver"])["examples"], 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
