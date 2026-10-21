export const REFERENCE_NORMALIZATION_VERSION = "nfc-whitespace-v1";
export const NORMALIZATION_VERSION = "nfc-whitespace-measurement-spacing-v2";

/** Preserve case, accents, numbers and punctuation; canonicalize Unicode and whitespace. */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replaceAll(/\s+/gu, " ").trim();
}

/** Compare copies only: ignore spacing in numeric mm/cm measurements and dimensions. */
export function normalizeComparisonText(text: string): string {
  return normalizeText(text).replaceAll(
    /(?<![\p{L}\p{N}_.,+-])\d+(?:[.,]\d+)?(?: *[x×] *\d+(?:[.,]\d+)?)* *(?:mm|cm)(?![\p{L}\p{N}_])/gu,
    (measurement) => measurement.replaceAll(/ *([x×]) */gu, " $1 ").replace(/ *(mm|cm)$/u, " $1"),
  );
}

/** Trim shared edges and keep only one dynamic-programming row in memory. */
function editDistance(expected: readonly string[], actual: readonly string[]): number {
  let start = 0;
  let expectedEnd = expected.length;
  let actualEnd = actual.length;
  while (start < expectedEnd && start < actualEnd && expected[start] === actual[start]) {
    start++;
  }
  while (expectedEnd > start && actualEnd > start && expected[expectedEnd - 1] === actual[actualEnd - 1]) {
    expectedEnd--;
    actualEnd--;
  }
  let a = expected.slice(start, expectedEnd);
  let b = actual.slice(start, actualEnd);
  if (a.length < b.length) {
    [a, b] = [b, a];
  }
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (const [i, character] of a.entries()) {
    let diagonal = row[0] ?? 0;
    row[0] = i + 1;
    for (const [j, other] of b.entries()) {
      const above = row[j + 1] ?? 0;
      row[j + 1] = Math.min(above + 1, (row[j] ?? 0) + 1, diagonal + (character === other ? 0 : 1));
      diagonal = above;
    }
  }

  return row[b.length] ?? 0;
}

export interface TextScore {
  characterErrors: number;
  goldCharacters: number;
  cer: number | null;
  wordErrors: number;
  goldWords: number;
  wer: number | null;
}

export function sumScores(scores: readonly TextScore[]): TextScore {
  const characterErrors = scores.reduce((sum, score) => sum + score.characterErrors, 0);
  const goldCharacters = scores.reduce((sum, score) => sum + score.goldCharacters, 0);
  const wordErrors = scores.reduce((sum, score) => sum + score.wordErrors, 0);
  const goldWords = scores.reduce((sum, score) => sum + score.goldWords, 0);

  let cer: number | null = null;
  let wer: number | null = null;
  if (goldCharacters > 0) {
    cer = characterErrors / goldCharacters;
  }
  if (goldWords > 0) {
    wer = wordErrors / goldWords;
  }

  return {
    characterErrors,
    goldCharacters,
    cer,
    wordErrors,
    goldWords,
    wer,
  };
}

function scoreText(expected: string, actual: string): TextScore {
  const expectedChars = expected.match(/./gsu) ?? [];
  const expectedWords = expected.match(/\S+/gu) ?? [];

  return sumScores([
    {
      characterErrors: editDistance(expectedChars, actual.match(/./gsu) ?? []),
      goldCharacters: expectedChars.length,
      cer: null,
      wordErrors: editDistance(expectedWords, actual.match(/\S+/gu) ?? []),
      goldWords: expectedWords.length,
      wer: null,
    },
  ]);
}

export function scoreTranscript(
  expected: string,
  actual: string,
): {
  raw: TextScore;
  normalized: TextScore;
  expected: string;
  actual: string;
} {
  return {
    raw: scoreText(expected, actual),
    normalized: scoreText(normalizeComparisonText(expected), normalizeComparisonText(actual)),
    expected,
    actual,
  };
}
