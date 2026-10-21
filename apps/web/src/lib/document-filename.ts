import { MAX_DOCUMENT_FILENAME_LENGTH } from "@prostapaper/contracts";

import { fileBasename } from "#lib/file-key";

const SEPARATORS = /[^\p{L}\p{N}]+/gu;
const EDGES = /^_|_$/g;

export function documentFilename(caseName: string, filename: string): string {
  const room = Math.max(MAX_DOCUMENT_FILENAME_LENGTH - filename.length - 1, 0);
  const prefix = underscored(caseName.slice(0, room));
  if (prefix === "" || underscored(fileBasename(filename)) === prefix) return filename;

  return `${prefix}_${filename}`;
}

function underscored(value: string): string {
  return value.replaceAll(SEPARATORS, "_").replaceAll(EDGES, "");
}
