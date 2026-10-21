import assert from "node:assert/strict";
import test from "node:test";

import { reconstructPage } from "@prostapaper/extraction/reading-order";

await test("layout keeps wrapped labels before values, separates adjacent rows, and preserves words", () => {
  const word = (text: string, range: readonly [number, number], y0: number) => ({
    text,
    bbox: { x0: range[0], x1: range[1], y0, y1: y0 + 20 },
  });
  const line = (words: ReturnType<typeof word>[]) => {
    const first = words[0];
    const last = words.at(-1);
    if (first === undefined || last === undefined) throw new Error("Expected fixture words");

    return { words, bbox: { x0: first.bbox.x0, x1: last.bbox.x1, y0: first.bbox.y0, y1: first.bbox.y1 } };
  };
  const lines = [
    line([word("Wrapped", [10, 80], 50), word("A", [300, 320], 50)]),
    line([word("label:", [10, 80], 78)]),
    line([word("Second:", [10, 90], 114), word("B", [300, 320], 114)]),
    line([word("Third:", [10, 90], 164), word("C", [300, 320], 164)]),
  ];
  const original = JSON.stringify(lines);
  for (const scale of [1, 2]) {
    const scaled = lines.map((item) => ({
      ...item,
      bbox: Object.fromEntries(
        Object.entries(item.bbox).map(([key, value]) => [key, value * scale]),
      ) as typeof item.bbox,
      words: item.words.map((item) => ({
        ...item,
        bbox: Object.fromEntries(
          Object.entries(item.bbox).map(([key, value]) => [key, value * scale]),
        ) as typeof item.bbox,
      })),
    }));
    const result = reconstructPage([{ paragraphs: [{ lines: scaled }] }]);
    assert.equal(result.text, "Wrapped label: A Second: B Third: C");
    assert.equal(result.diagnostics.tableRows, 3);
    assert.equal(result.diagnostics.wordCount, 7);
    assert.deepEqual(
      result.text.split(" ").toSorted(),
      lines.flatMap((line) => line.words.map((word) => word.text)).toSorted(),
    );
  }
  assert.equal(JSON.stringify(lines), original);
  const plain = reconstructPage([
    {
      paragraphs: [
        {
          lines: [
            line([word("Normal", [10, 80], 50), word("paragraph", [90, 190], 50)]),
            line([word("continues.", [10, 100], 78)]),
          ],
        },
      ],
    },
  ]);
  assert.equal(plain.text, "Normal paragraph continues.");
  assert.equal(plain.diagnostics.tableRows, 0);
});
