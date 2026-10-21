import assert from "node:assert/strict";
import test from "node:test";

import { S3Client } from "@aws-sdk/client-s3";

import { normalizeComparisonText, normalizeText, scoreTranscript, sumScores } from "#eval/scoring";
import { parseCandidate, parseReference } from "#eval/transcripts";
import { handler } from "#handler";

const reference = (text: string) => ({ version: 1, quality: "silver", text });

await test("normalization preserves clinical characters and is idempotent", () => {
  const texts = [
    "Příliš žluťoučký kůň",
    "PSA 0,12 ng/ml; Gleason 3+4=7; pT2",
    "Číslo 1 vs l; O vs 0",
    "  A\t B\r\nC  ",
    "Pr\u030Ci\u0301lis\u030C",
  ];
  for (const text of texts) {
    const normalized = normalizeText(text);
    assert.equal(normalizeText(normalized), normalized);
  }
  assert.equal(normalizeText(texts[0] ?? ""), texts[0]);
  assert.equal(normalizeText(texts[1] ?? ""), texts[1]);
  assert.equal(normalizeText(texts[2] ?? ""), texts[2]);
  assert.equal(normalizeText(texts[3] ?? ""), "A B C");
  assert.equal(normalizeText(texts[4] ?? ""), "Příliš");
});

await test("JSON reference validation preserves text and rejects implicit normalization", () => {
  const input = reference("PSA 0,12 ng/ml");
  const original = JSON.stringify(input);
  assert.deepEqual(parseReference(input), input);
  assert.equal(JSON.stringify(input), original);
  for (const text of [" PSA", "PSA\n0,12", "PSA  0,12", "Pr\u030Ci\u0301lis\u030C"]) {
    assert.throws(() => parseReference(reference(text)), /changes under/u);
  }
  assert.throws(() => parseReference({ ...input, quality: "unverified" }), /quality/u);
});

await test("raw and normalized scores retain numeric errors across extraction methods", () => {
  const expected = parseReference(reference("PSA 0,12"));
  const actual = { text: "PSA\n0,13", diagnostics: { method: "any-provider" } };
  const original = JSON.stringify(actual);
  const candidate = parseCandidate(actual);
  const score = scoreTranscript(expected.text, candidate.text);
  assert.equal(score.raw.characterErrors, 2);
  assert.equal(score.normalized.characterErrors, 1);
  assert.equal(score.normalized.cer, 1 / 8);
  assert.equal(score.normalized.wer, 1 / 2);
  assert.equal(JSON.stringify(actual), original);
  assert.equal(scoreTranscript(expected.text, expected.text).normalized.cer, 0);
});

await test("measurement spacing is equivalent while changed values, units and separators remain errors", () => {
  const input = reference("Rozměry: 3.5 x 1.5 x 0.5 cm;");
  const original = JSON.stringify(input);
  const expected = parseReference(input);
  const actual = "Rozměry: 3.5x1.5x0.5cm;";
  const score = scoreTranscript(expected.text, actual);
  assert.equal(score.normalized.cer, 0);
  assert.equal(score.normalized.wer, 0);
  assert.ok(score.raw.characterErrors > 0);
  assert.equal(score.expected, expected.text);
  assert.equal(score.actual, actual);
  assert.equal(JSON.stringify(input), original);
  assert.equal(normalizeComparisonText(expected.text), expected.text);
  for (const [spaced, compact] of [
    ["1 cm", "1cm"],
    ["3,5 x 1,5 mm", "3,5x1,5mm"],
    ["3 × 4 cm", "3×4cm"],
  ] as const) {
    assert.equal(scoreTranscript(spaced, compact).normalized.cer, 0);
    const normalized = normalizeComparisonText(compact);
    assert.equal(normalizeComparisonText(normalized), normalized);
  }
  for (const wrong of [
    "Rozměry: 3.5x1.5x0.6cm;",
    "Rozměry: 3.5x1.5x0.5mm;",
    "Rozměry: 3,5x1.5x0.5cm;",
    "Rozměry: 3.5x0.5x1.5cm;",
    "Rozměry: 3.5x1.5cm;",
    "Rozměry: 3.5 1.5 0.5cm;",
    "Rozměry: 3.5x1.5x0.5;",
  ]) {
    const changed = scoreTranscript(expected.text, wrong).normalized;
    assert.ok(changed.characterErrors > 0, wrong);
    assert.ok(changed.wordErrors > 0, wrong);
  }
  for (const unrelated of ["pT1cm", "A1cmB", "abc 1cmword", "3 + 4 = 7", "3x4"]) {
    assert.equal(normalizeComparisonText(unrelated), unrelated);
  }
  for (const unrelated of ["abc def", "3 + 4 = 7", "3. 5cm"]) {
    assert.ok(scoreTranscript(unrelated, unrelated.replaceAll(" ", "")).normalized.characterErrors > 0);
  }
});

await test("whole-report scoring ignores pagination and penalizes missing or extra text", () => {
  const candidate = parseCandidate({
    pages: [
      { page: 2, text: "xyz", source: "another-extractor" },
      { page: 1, text: "abc", source: "another-extractor" },
    ],
  });
  assert.equal(scoreTranscript("abc xyz", candidate.text).normalized.cer, 0);
  assert.equal(scoreTranscript("abc xyz", parseCandidate({ text: "abc xyz" }).text).normalized.cer, 0);
  assert.equal(candidate.diagnostics["pageCount"], 2);
  assert.equal(scoreTranscript("abc xyz", "abc").normalized.characterErrors, 4);
  assert.equal(scoreTranscript("abc", "abc extra").normalized.characterErrors, 6);
  assert.throws(
    () =>
      parseCandidate({
        pages: [
          { page: 1, text: "abc" },
          { page: 1, text: "xyz" },
        ],
      }),
    /unique/u,
  );
  assert.equal(scoreTranscript("", "extra").normalized.cer, null);
  assert.equal(scoreTranscript("", "extra").normalized.characterErrors, 5);
});

await test("corpus scores weight by reference length rather than averaging document rates", () => {
  const short = scoreTranscript("a", "b").normalized;
  const long = scoreTranscript("123456789", "123456789").normalized;
  assert.equal(sumScores([short, long]).cer, 0.1);
});

await test("valid QA requests reach S3 without loading database configuration", async (t) => {
  const send = t.mock.method(
    S3Client.prototype,
    "send",
    async () => await Promise.reject(new Error("QA S3 read")),
  );
  await assert.rejects(
    handler({
      mode: "extraction-qa",
      bucket: "documents",
      runId: "run-1",
      exampleId: "report-1",
      inputKey: "qa/input/report-1.jpg",
      inputVersionId: "version-1",
      contentType: "image/jpeg",
    }),
    /QA S3 read/u,
  );
  assert.equal(send.mock.callCount(), 1);
});
