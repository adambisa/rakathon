interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Word {
  text: string;
  bbox: Box;
}

interface Line {
  words: Word[];
  bbox: Box;
}

interface Block {
  paragraphs: { lines: Line[] }[];
}

interface LineGroup {
  lines: Line[];
  lastCenter: number;
}

interface ColumnGap {
  x: number;
  line: Line;
}

interface ColumnCluster {
  x: number;
  gaps: ColumnGap[];
}

interface TableLayout {
  valueColumnStart: number;
  divider: number;
  lineHeight: number;
}

interface Reconstruction {
  text: string;
  diagnostics: {
    lineCount: number;
    wordCount: number;
    medianLineHeight: number;
    linePitch: number;
    valueColumnStart: number | null;
    tableRows: number;
  };
}

const LARGE_GAP_FACTOR = 2;
const COLUMN_ALIGNMENT_TOLERANCE_FACTOR = 1;
const MIN_REPEATED_ALIGNMENTS = 3;
const COLUMN_DIVIDER_INSET_FACTOR = 0.4;
const MIN_LINE_STEP_FACTOR = 0.5;
const ROW_GAP_FACTOR = 1.05;

/** Reconstructs reading order for single-column reports with label/value tables. */
export function reconstructPage(blocks: readonly Block[]): Reconstruction {
  const lines = flattenLinesInEngineOrder(blocks);
  const medianLineHeight = getMedianLineHeight(lines);
  const valueColumnStart = findValueColumnStart(lines, medianLineHeight);
  const linePitch = estimateLinePitch(lines, medianLineHeight);
  const groups = groupLinesIntoRows(lines, linePitch);
  const { words, tableRows } = orderWords(groups, valueColumnStart, medianLineHeight);

  ensureWordsWerePreserved(lines, words);

  return {
    text: words.map((word) => word.text).join(" "),
    diagnostics: {
      lineCount: lines.length,
      wordCount: words.length,
      medianLineHeight,
      linePitch,
      valueColumnStart,
      tableRows,
    },
  };
}

function flattenLinesInEngineOrder(blocks: readonly Block[]): Line[] {
  // Keep Tesseract's block, paragraph, line, and word order; raw y/x sorting can interleave columns.
  return blocks
    .flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
    .filter((line) => line.words.length > 0);
}

function getMedianLineHeight(lines: readonly Line[]): number {
  const heights = lines
    .map((line) => line.bbox.y1 - line.bbox.y0)
    .filter((height) => height > 0)
    .toSorted((a, b) => a - b);

  return heights[Math.floor(heights.length / 2)] ?? 1;
}

function findValueColumnStart(lines: readonly Line[], lineHeight: number): number | null {
  const gaps = findLargeColumnGaps(lines, lineHeight);
  const clusters = clusterColumnGaps(gaps, lineHeight * COLUMN_ALIGNMENT_TOLERANCE_FACTOR);
  const repeatedCluster = clusters
    .filter((cluster) => countAlignedLines(cluster) >= MIN_REPEATED_ALIGNMENTS)
    .toSorted((a, b) => b.gaps.length - a.gaps.length)[0];

  return repeatedCluster?.x ?? null;
}

function findLargeColumnGaps(lines: readonly Line[], lineHeight: number): ColumnGap[] {
  const gaps: ColumnGap[] = [];
  for (const line of lines) {
    for (let index = 1; index < line.words.length; index++) {
      const leftWord = line.words[index - 1];
      const rightWord = line.words[index];
      if (leftWord === undefined || rightWord === undefined) throw new Error("Missing OCR word");

      const gap = rightWord.bbox.x0 - leftWord.bbox.x1;
      if (gap > LARGE_GAP_FACTOR * lineHeight) gaps.push({ x: rightWord.bbox.x0, line });
    }
  }

  return gaps;
}

function clusterColumnGaps(gaps: readonly ColumnGap[], tolerance: number): ColumnCluster[] {
  const clusters: ColumnCluster[] = [];
  for (const gap of gaps.toSorted((a, b) => a.x - b.x)) {
    let cluster = clusters.find((candidate) => Math.abs(candidate.x - gap.x) <= tolerance);
    if (cluster === undefined) {
      cluster = { x: gap.x, gaps: [] };
      clusters.push(cluster);
    }
    cluster.gaps.push(gap);
    cluster.x = average(cluster.gaps.map((item) => item.x));
  }

  return clusters;
}

function countAlignedLines(cluster: ColumnCluster): number {
  return new Set(cluster.gaps.map((gap) => gap.line)).size;
}

function estimateLinePitch(lines: readonly Line[], lineHeight: number): number {
  const centers = lines.map(lineCenter);
  const lineSteps = centers
    .slice(1)
    .map((center, index) => center - (centers[index] ?? center))
    .filter((step) => step > MIN_LINE_STEP_FACTOR * lineHeight)
    .toSorted((a, b) => a - b);

  return lineSteps[Math.floor(lineSteps.length / 4)] ?? lineHeight;
}

function groupLinesIntoRows(lines: readonly Line[], linePitch: number): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const center = lineCenter(line);
    const previousGroup = groups.at(-1);
    let gapFromPrevious = Number.POSITIVE_INFINITY;
    if (previousGroup !== undefined) gapFromPrevious = center - previousGroup.lastCenter;

    if (previousGroup === undefined || gapFromPrevious > ROW_GAP_FACTOR * linePitch) {
      groups.push({ lines: [line], lastCenter: center });
    } else {
      previousGroup.lines.push(line);
      previousGroup.lastCenter = center;
    }
  }

  return groups;
}

function orderWords(
  groups: readonly LineGroup[],
  valueColumnStart: number | null,
  lineHeight: number,
): { words: Word[]; tableRows: number } {
  const words: Word[] = [];
  let tableRows = 0;
  if (valueColumnStart === null) {
    return { words: groups.flatMap((group) => group.lines.flatMap((line) => line.words)), tableRows };
  }

  const layout = {
    valueColumnStart,
    divider: valueColumnStart - COLUMN_DIVIDER_INSET_FACTOR * lineHeight,
    lineHeight,
  };
  for (const group of groups) {
    const rowWords = group.lines.flatMap((line) => line.words);
    if (isTableRow(group.lines, rowWords, layout)) {
      tableRows++;
      words.push(
        ...rowWords.filter((word) => word.bbox.x0 < layout.divider),
        ...rowWords.filter((word) => word.bbox.x0 >= layout.divider),
      );
    } else {
      words.push(...rowWords);
    }
  }

  return { words, tableRows };
}

function isTableRow(lines: readonly Line[], words: readonly Word[], layout: TableLayout): boolean {
  const hasLabelAndAlignedValue = lines.some(
    (line) =>
      line.words.some((word) => Math.abs(word.bbox.x0 - layout.valueColumnStart) <= layout.lineHeight) &&
      line.words.some((word) => word.bbox.x1 < layout.divider),
  );
  const hasClearColumnGap = !words.some(
    (word) => word.bbox.x0 < layout.divider && word.bbox.x1 > layout.divider,
  );

  return hasLabelAndAlignedValue && hasClearColumnGap;
}

function ensureWordsWerePreserved(lines: readonly Line[], orderedWords: readonly Word[]): void {
  const recognizedWords = lines.flatMap((line) => line.words);
  if (
    orderedWords.length !== recognizedWords.length ||
    new Set(orderedWords).size !== new Set(recognizedWords).size
  ) {
    throw new Error("Layout reconstruction must preserve every recognized word");
  }
}

function lineCenter(line: Line): number {
  return (line.bbox.y0 + line.bbox.y1) / 2;
}

function average(numbers: readonly number[]): number {
  return numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
}
