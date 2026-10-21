import { useSuspenseQuery } from "@tanstack/react-query";

import { DisplayDocumentCard } from "#components/display-document-card";
import { PageHeader } from "#components/page-header";
import { useTRPC } from "#trpc";
import { Card, Skeleton } from "#ui";

const HEADING = "Nahrané dokumenty";

export function DocumentList() {
  const trpc = useTRPC();
  const { data: documents } = useSuspenseQuery(trpc.document.list.queryOptions());

  return (
    <div className="flex flex-col gap-4">
      <PageHeader>{HEADING}</PageHeader>
      <Card>
        {documents.length === 0 && <p className="text-sm opacity-70">Zatím nebyl nahrán žádný dokument.</p>}
        {documents.length > 0 && (
          <ul className="grid gap-3 @3xl/main:grid-cols-2">
            {documents.map((document) => (
              <li key={document.id}>
                <DisplayDocumentCard document={document} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function DocumentListPending() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader>{HEADING}</PageHeader>
      <Card>
        <div className="grid gap-3 @3xl/main:grid-cols-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      </Card>
    </div>
  );
}
