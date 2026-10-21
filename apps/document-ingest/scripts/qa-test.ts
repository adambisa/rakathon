import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

import { parseDataset } from "#qa/contracts";
import { awsEnvironment, invocationDirectory } from "#qa/env";

const exec = promisify(execFile);
const { values } = parseArgs({
  options: {
    bucket: { type: "string", default: "prostapaper-demo-documents-000000000000-eu-central-1" },
    prefix: { type: "string", default: "qa/scans/" },
    profile: { type: "string", default: "prostapaper" },
    region: { type: "string", default: "eu-central-1" },
    reader: { type: "string", default: "tesseract" },
    model: { type: "string" },
    report: { type: "string" },
    ref: { type: "string", default: "main" },
    method: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.info(
    "pnpm qa:test [--reader tesseract|bedrock-mantle] [--model id] [--bucket name] [--prefix qa/scans/]\n" +
      "             [--profile prostapaper] [--region eu-central-1] [--report dir] [--ref main] [--method label]\n" +
      "Downloads the dataset under s3://<bucket>/<prefix>, fetches origin/<ref> into a temporary worktree,\n" +
      "reads every input there with the chosen reader, and scores the outputs with that worktree's qa:score.\n" +
      "Your checkout's own code and local qa/ files are not used.",
  );
} else {
  await main();
}

async function main(): Promise<void> {
  const cwd = invocationDirectory();
  const { stdout: toplevel } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  const repoRoot = toplevel.trim();
  const prefix = values.prefix.replace(/\/*$/u, "/");
  const source = `s3://${values.bucket}/${prefix}`;
  const scratch = await mkdtemp(join(tmpdir(), "prostapaper-qa-"));
  const data = join(scratch, "data");
  const worktree = join(scratch, "repo");
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await exec("git", args, { cwd: repoRoot, maxBuffer: 1024 * 1024 });

    return stdout.trim();
  };
  let worktreeAdded = false;
  try {
    // The dataset lives in S3: dataset.json plus input/ and reference/, laid out like the local qa/ folder.
    console.info(`Downloading ${source}…`);
    await exec(
      "aws",
      [
        "s3",
        "cp",
        source,
        data,
        "--recursive",
        "--only-show-errors",
        "--profile",
        values.profile,
        "--region",
        values.region,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const datasetPath = join(data, "dataset.json");
    const dataset = parseDataset(JSON.parse(await readFile(datasetPath, "utf8")) as unknown);
    if (dataset.length === 0) {
      throw new Error(`QA dataset at ${source}dataset.json is empty`);
    }

    await git("fetch", "--quiet", "origin", values.ref);
    const commit = await git("rev-parse", "FETCH_HEAD");
    const subject = await git("log", "-1", "--format=%s", commit);
    console.info(`Testing origin/${values.ref} at ${commit.slice(0, 7)}: ${subject}`);

    const method = values.method ?? `${values.model ?? values.reader}-${commit.slice(0, 7)}`;
    const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
    let reportDirectory = join(repoRoot, "qa/runs", `${method}-${stamp}`);
    if (values.report !== undefined) {
      reportDirectory = resolve(cwd, values.report);
    }
    // A fresh report directory, like qa:score: never mix outputs from different runs.
    await mkdir(dirname(reportDirectory), { recursive: true });
    await mkdir(reportDirectory);
    const outputDirectory = join(reportDirectory, "output");
    await mkdir(outputDirectory);
    await writeFile(
      join(reportDirectory, "pipeline.json"),
      JSON.stringify(
        {
          ref: `origin/${values.ref}`,
          commit,
          subject,
          reader: values.reader,
          model: values.model,
          dataset: source,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );

    await git("worktree", "add", "--quiet", "--detach", worktree, commit);
    worktreeAdded = true;
    console.info("Installing dependencies in the temporary worktree…");
    await exec("pnpm", ["install", "--frozen-lockfile", "--prefer-offline", "--silent"], {
      cwd: worktree,
      maxBuffer: 16 * 1024 * 1024,
    });

    // The worktree's own extraction CLI and scorer, so every run tests that commit's pipeline as a whole.
    const extraction = join(worktree, "packages/extraction");
    const readerArguments = ["--reader", values.reader];
    if (values.model !== undefined) {
      readerArguments.push("--model", values.model);
    }
    await dataset.reduce(async (previous, example) => {
      await previous;
      const input = join(dirname(datasetPath), example.inputKey.slice(3));
      const started = performance.now();
      const { stdout } = await exec(process.execPath, ["scripts/cli.ts", input, ...readerArguments], {
        cwd: extraction,
        maxBuffer: 64 * 1024 * 1024,
        // A reader that calls AWS uses the run's credentials, like the dataset download, not the shell's.
        env: awsEnvironment(values),
      });
      await writeFile(join(outputDirectory, `${example.id}.json`), stdout, { flag: "wx" });
      console.info(`${example.id}: ${Math.round(performance.now() - started)} ms`);
    }, Promise.resolve());

    const { stdout, stderr } = await exec(process.execPath, [
      join(worktree, "apps/document-ingest/scripts/qa-score.ts"),
      "--dataset",
      datasetPath,
      "--outputs",
      outputDirectory,
      "--report",
      reportDirectory,
      "--method",
      method,
    ]);
    process.stderr.write(stderr);
    process.stdout.write(stdout);

    const report = JSON.parse(await readFile(join(reportDirectory, "report.json"), "utf8")) as ScoreReport;
    const rows = report.results.map((result) => scoreLine(result.id, result.score?.normalized));
    console.info(["", ...rows, scoreLine("total", report.normalized)].join("\n"));
  } finally {
    if (worktreeAdded) {
      await git("worktree", "remove", "--force", worktree);
    }
    await rm(scratch, { recursive: true, force: true });
  }
}

function percent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) {
    return "n/a";
  }

  return `${(rate * 100).toFixed(2)}%`;
}

function scoreLine(id: string, rates: Rates | undefined): string {
  return `${id.padEnd(16)} CER ${percent(rates?.cer).padStart(7)}   WER ${percent(rates?.wer).padStart(7)}`;
}

interface Rates {
  cer: number | null;
  wer: number | null;
}

interface ScoreReport {
  normalized: Rates;
  results: { id: string; score?: { normalized: Rates } }[];
}
