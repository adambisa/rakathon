import type { Page } from "mupdf";
import type { z } from "zod";

import type { DocumentPageSource } from "@prostapaper/contracts";

export type ReaderLog = (entry: Record<string, unknown>) => void;

export interface PageReader {
  source: Exclude<DocumentPageSource, "opencv">;
  readPage: (page: Page) => Promise<string>;
  close?: () => Promise<void>;
}

export interface ReaderOptions {
  tessdataDirectory: string;
  log?: ReaderLog | undefined;
}

/** A reader strategy parses its own environment and builds its reader; the package only keeps a map of them. */
export interface ReaderStrategy<Settings extends { reader: string }> {
  settings: z.ZodType<Settings>;
  create: (settings: Settings, options: ReaderOptions) => PageReader;
}
