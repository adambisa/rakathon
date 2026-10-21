import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  type Document,
  type DocumentKind,
  type DocumentPageSource,
  ExtractedDocument,
  lesionsFromSectorMap,
} from "@prostapaper/contracts";

import { errorMessage } from "#lib/error-message";
import { useDocumentSource } from "#lib/use-document-source";
import { Badge, Button, ButtonAnchor, Card, Expandable, SectorDiagram, Skeleton } from "#ui";

const SOURCE_LABELS: Record<DocumentPageSource, string> = {
  ocr: "OCR",
  model: "Přepis modelem",
  opencv: "OpenCV",
};

/** A sector sheet's output is the drawn map itself, so its card is named for it. */
const HEADINGS: Record<DocumentKind, string> = {
  text_description: "Výstup extrakce",
  sector_map: "Sektorová mapa",
};

const waitingMessages = {
  awaiting_upload: "Výstup bude dostupný po nahrání a zpracování dokumentu.",
  uploaded: "Dokument čeká na extrakci. Výstup se zobrazí automaticky.",
  extracting: "Probíhá extrakce textu. Výstup se zobrazí automaticky.",
};

export interface DocumentExtractionProps {
  document: Document;
}

export function DocumentExtraction({ document }: DocumentExtractionProps) {
  const heading = HEADINGS[document.kind];
  if (document.status === "extracted") return <ExtractionOutput documentId={document.id} heading={heading} />;

  return (
    <Card heading={heading} className="min-w-0">
      <p className="text-sm opacity-60" role="status">
        {waitingMessages[document.status]}
      </p>
    </Card>
  );
}

interface ExtractionOutputProps {
  documentId: string;
  heading: string;
}

function ExtractionOutput({ documentId, heading }: ExtractionOutputProps) {
  const ticket = useDocumentSource(documentId, "extraction");
  const url = ticket.data?.url;
  const output = useQuery(
    queryOptions({
      queryKey: ["document-extraction", documentId, url],
      enabled: url !== undefined,
      gcTime: 0,
      queryFn: async ({ signal }) => {
        if (url === undefined) throw new Error("Výstup extrakce není dostupný.");
        const response = await fetch(url, { signal, cache: "no-store", referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error("Výstup extrakce se nepodařilo načíst.");
        const parsed = ExtractedDocument.safeParse(await response.json());
        if (!parsed.success) throw new Error("Výstup extrakce má neplatný formát.");

        return parsed.data;
      },
    }),
  );
  const error = ticket.error ?? output.error;
  const retry = async () => {
    const refreshed = await ticket.refetch();
    if (refreshed.data?.url === url) await output.refetch();
  };

  if (error !== null) {
    return (
      <ExtractionCard heading={heading}>
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{errorMessage(error)}</p>
          <Button
            size="sm"
            variant="outline"
            loading={ticket.isFetching || output.isFetching}
            onClick={() => void retry()}
          >
            Zkusit znovu
          </Button>
        </div>
      </ExtractionCard>
    );
  }
  if (output.data === undefined) {
    return (
      <ExtractionCard heading={heading}>
        <Skeleton className="h-96 w-full" />
      </ExtractionCard>
    );
  }

  const { pages, sectorMap } = output.data;
  if (sectorMap !== undefined) {
    return (
      <ExtractionCard heading={heading} url={url}>
        <Expandable title={heading}>
          <SectorDiagram lesions={lesionsFromSectorMap(sectorMap)} />
        </Expandable>
      </ExtractionCard>
    );
  }

  return (
    <ExtractionCard heading={heading} url={url}>
      <div className="flex min-w-0 flex-col gap-5 rounded-box bg-base-200 p-3 sm:p-4 @3xl/main:max-h-[75vh] @3xl/main:overflow-y-auto">
        {pages.map((page) => (
          <section
            key={page.page}
            aria-label={`Strana ${page.page}`}
            className="flex shrink-0 flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 pb-3">
              <h3 className="font-semibold">Strana {page.page}</h3>
              <Badge size="sm" variant="outline" className="text-base-content/60">
                {SOURCE_LABELS[page.source]}
              </Badge>
            </div>
            <p className="text-[0.9375rem] leading-7 wrap-anywhere whitespace-pre-wrap">
              {displayText(page.text)}
            </p>
          </section>
        ))}
      </div>
    </ExtractionCard>
  );
}

interface ExtractionCardProps {
  heading: string;
  children: ReactNode;
  url?: string | undefined;
}

function ExtractionCard({ heading, children, url }: ExtractionCardProps) {
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="card-title">{heading}</h2>
        {url !== undefined && (
          <ButtonAnchor
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            variant="ghost"
            className="ml-auto"
          >
            Otevřít JSON
          </ButtonAnchor>
        )}
      </div>
      {children}
    </Card>
  );
}

function displayText(text: string): string {
  if (text.trim() === "") return "Na této straně nebyl nalezen žádný text.";

  return text;
}
