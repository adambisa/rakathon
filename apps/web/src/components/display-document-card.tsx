import type { ReactNode } from "react";

import type { Document } from "@prostapaper/contracts";

import { DocumentThumbnail } from "#components/document-thumbnail";
import { LayoutCard } from "#components/layout-card";
import { UploadedBy } from "#components/uploaded-by";
import { fileExtension } from "#lib/file-key";
import { isUploaded } from "#lib/use-document-source";
import { ButtonLink, DocumentKindBadge, DocumentStatusBadge, Link } from "#ui";

export interface DisplayDocumentCardProps {
  document: Document;
  compact?: boolean;
  showOpenButton?: boolean;
  showDate?: boolean;
}

export function DisplayDocumentCard({
  document,
  compact = false,
  showOpenButton = true,
  showDate = true,
}: DisplayDocumentCardProps) {
  const createdAt = new Date(document.createdAt);
  let thumbnail: ReactNode;
  if (isUploaded(document)) thumbnail = <DocumentThumbnail document={document} />;
  let actions: ReactNode;
  if (showOpenButton) {
    actions = (
      <ButtonLink
        to="/dokumenty/$documentId"
        params={{ documentId: document.id }}
        size="sm"
        variant="outline"
        className="relative z-10"
      >
        Otevřít
      </ButtonLink>
    );
  }

  return (
    <div className="group relative h-full rounded-box">
      <LayoutCard
        name={document.filename}
        extension={fileExtension(document.filename) ?? "?"}
        size={compact ? "sm" : "md"}
        thumbnail={thumbnail}
        className="h-full transition-colors group-hover:bg-base-200"
        actions={actions}
      >
        <div className="flex flex-wrap items-center gap-2">
          <DocumentStatusBadge size="sm" status={document.status} />
          <DocumentKindBadge size="sm" kind={document.kind} />
        </div>
        {showDate && (
          <time dateTime={document.createdAt} className="block text-sm opacity-70">
            {createdAt.toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" })}
          </time>
        )}
        <UploadedBy user={document.uploadedBy} />
      </LayoutCard>
      <Link
        to="/dokumenty/$documentId"
        params={{ documentId: document.id }}
        aria-label={`Otevřít dokument: ${document.filename}`}
        className="absolute inset-0 rounded-box no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
    </div>
  );
}
