import { useState } from "react";

import type { Document } from "@prostapaper/contracts";

import { DocumentExtraction } from "#components/document-extraction";
import { PageHeader, PageHeaderBack } from "#components/page-header";
import { UploadedBy } from "#components/uploaded-by";
import { errorMessage } from "#lib/error-message";
import { fileExtension } from "#lib/file-key";
import { formatBytes } from "#lib/format";
import { useDocumentSource } from "#lib/use-document-source";
import {
  Badge,
  Button,
  ButtonAnchor,
  Card,
  DocumentKindBadge,
  DocumentStatusBadge,
  Expandable,
  Skeleton,
} from "#ui";

export interface DocumentDetailProps {
  document: Document;
}

export function DocumentDetail({ document }: DocumentDetailProps) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={<PageHeaderBack fallback="/dokumenty" aria-label="Zpět na dokumenty" />}
        status={
          <>
            <DocumentStatusBadge status={document.status} size="md" />
            <DocumentKindBadge kind={document.kind} size="md" />
          </>
        }
      >
        Detail dokumentu: {document.filename}
      </PageHeader>
      <Card heading="Informace o dokumentu">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 text-sm sm:grid-cols-2 @3xl/main:grid-cols-3 [&_dd]:wrap-anywhere [&_dt]:mb-1.5 [&_dt]:opacity-60 [&>div]:min-w-0">
          <div>
            <dt>Formát</dt>
            <dd>
              <Badge size="sm" variant="outline">
                {fileExtension(document.filename) ?? "?"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>Velikost</dt>
            <dd>{documentSize(document.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Nahrál</dt>
            <dd>
              <UploadedBy user={document.uploadedBy} />
            </dd>
          </div>
          <div>
            <dt>Nahráno</dt>
            <dd>
              <DocumentTime timestamp={document.uploadedAt} />
            </dd>
          </div>
          {typeof document.updatedAt === "string" && (
            <div>
              <dt>Poslední změna</dt>
              <dd>
                <DocumentTime timestamp={document.updatedAt} />
              </dd>
            </div>
          )}
          {typeof document.extractionStartedAt === "string" && (
            <div>
              <dt>Začátek extrakce</dt>
              <dd>
                <DocumentTime timestamp={document.extractionStartedAt} />
              </dd>
            </div>
          )}
          {typeof document.extractedAt === "string" && (
            <div>
              <dt>Dokončení extrakce</dt>
              <dd>
                <DocumentTime timestamp={document.extractedAt} />
              </dd>
            </div>
          )}
        </dl>
      </Card>
      <div className="grid items-start gap-4 @3xl/main:grid-cols-2">
        {document.status === "awaiting_upload" ? (
          <Card heading="Originální dokument">
            <p>Čekáme na dokončení nahrávání dokumentu.</p>
          </Card>
        ) : (
          <DocumentPreview document={document} />
        )}
        <DocumentExtraction document={document} />
      </div>
    </div>
  );
}

function documentSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return "Není k dispozici";

  return formatBytes(sizeBytes);
}

interface DocumentTimeProps {
  timestamp: string | null;
}

function DocumentTime({ timestamp }: DocumentTimeProps) {
  if (timestamp === null) return "Čekáme na nahrání";

  return (
    <time dateTime={timestamp}>
      {new Date(timestamp).toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

interface DocumentPreviewProps {
  document: Document;
}

function DocumentPreview({ document }: DocumentPreviewProps) {
  const { filename } = document;
  const source = useDocumentSource(document.id);
  const [failedUrl, setFailedUrl] = useState<string>();

  return (
    <Card heading="Originální dokument" className="min-w-0">
      {source.data === undefined && !source.isError && <Skeleton className="h-96 w-full" />}
      {source.isError && source.data === undefined && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p>{errorMessage(source.error)}</p>
          <Button
            size="sm"
            variant="outline"
            loading={source.isFetching}
            onClick={() => void source.refetch()}
          >
            Zkusit znovu
          </Button>
        </div>
      )}
      {source.data !== undefined && (
        <div className="flex flex-col gap-4">
          {failedUrl !== source.data.url && (
            <Expandable title={filename}>
              <img
                src={source.data.url}
                alt={filename}
                referrerPolicy="no-referrer"
                className="max-h-[75vh] w-full object-contain [.modal-box_&]:max-h-[78vh]"
                onError={() => setFailedUrl(source.data?.url)}
              />
            </Expandable>
          )}
          {failedUrl === source.data.url && (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <p>Náhled se nepodařilo načíst.</p>
              <Button
                size="sm"
                variant="outline"
                loading={source.isFetching}
                onClick={() => void source.refetch()}
              >
                Zkusit znovu
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <ButtonAnchor href={source.data.url} target="_blank" rel="noopener noreferrer" size="sm">
              Otevřít originál
            </ButtonAnchor>
          </div>
        </div>
      )}
    </Card>
  );
}

export function DocumentDetailPending() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-36" />
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-4 @3xl/main:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
