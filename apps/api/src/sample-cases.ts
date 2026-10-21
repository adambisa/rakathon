import { readFile } from "node:fs/promises";

import type { DocumentKind } from "@prostapaper/contracts";

export async function sampleDocuments(
  sampleId: "0005" | "0008" | "0012",
): Promise<{ kind: DocumentKind; filename: string; body: Buffer }[]> {
  const files: { kind: DocumentKind; filename: string }[] = [
    { kind: "text_description", filename: `scan-${sampleId}.jpg` },
    { kind: "sector_map", filename: `schema-${sampleId}.jpg` },
  ];

  return Promise.all(
    files.map(async (file) => ({
      ...file,
      body: await readFile(new URL(`sample-cases/${file.filename}`, import.meta.url)),
    })),
  );
}
