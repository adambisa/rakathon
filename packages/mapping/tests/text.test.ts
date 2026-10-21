import assert from "node:assert/strict";
import test from "node:test";

import { assembleCaseText } from "#text";

void test("report pages are numbered and joined in order, blank pages dropped", () => {
  const text = assembleCaseText([
    {
      filename: "nalez.jpg",
      kind: "text_description",
      extracted: {
        pages: [
          { page: 1, text: " Strana jedna ", source: "ocr" },
          { page: 2, text: "", source: "ocr" },
          { page: 3, text: "Strana tři", source: "ocr" },
        ],
      },
    },
    {
      filename: "dodatek.jpg",
      kind: "sector_map",
      extracted: { pages: [{ page: 1, text: "Dodatek", source: "ocr" }] },
    },
  ]);

  assert.equal(
    text,
    [
      "=== Dokument 1 (textový popis): nalez.jpg ===",
      "Strana jedna",
      "Strana tři",
      "=== Dokument 2 (sektorová mapa): dodatek.jpg ===",
      "Dodatek",
    ].join("\n\n"),
  );
});

void test("the report leads and the sector map follows as structured foci, never as its page text", () => {
  const text = assembleCaseText([
    {
      filename: "mapa.jpg",
      kind: "sector_map",
      extracted: {
        pages: [{ page: 1, text: "Sektorová mapa, vyznačeno: značka 1: báze PZpl L.", source: "opencv" }],
        sectorMap: {
          pages: [
            {
              page: 1,
              foci: [
                {
                  sectors: [
                    { id: "base_PZpl_L", share: 0.91, coverage: 0.42 },
                    { id: "base_PZpm_L", share: 0.09, coverage: 0.05 },
                  ],
                  marked: ["base_PZpl_L"],
                },
              ],
            },
          ],
        },
      },
    },
    {
      filename: "nalez.jpg",
      kind: "text_description",
      extracted: { pages: [{ page: 1, text: "Závěr: karcinom", source: "ocr" }] },
    },
  ]);

  assert.equal(
    text,
    [
      "=== Dokument 1 (textový popis): nalez.jpg ===",
      "Závěr: karcinom",
      "=== Dokument 2 (sektorová mapa): mapa.jpg ===",
      [
        "[Sektorová mapa, strojově přečtená: značky lokalizují ložiska popsaná v textu]",
        'značka 1: [{"id":"pzpl_base_ls","share":0.91,"coverage":0.42}]',
      ].join("\n"),
    ].join("\n\n"),
  );
});
