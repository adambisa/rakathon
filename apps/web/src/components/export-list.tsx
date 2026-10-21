import { useSuspenseQuery } from "@tanstack/react-query";

import { PageHeader } from "#components/page-header";
import { useTRPC } from "#trpc";
import { Card, CaseStatusBadge, Link, Skeleton } from "#ui";

export function ExportList() {
  const trpc = useTRPC();
  const { data: items } = useSuspenseQuery(trpc.case.exports.queryOptions());

  return (
    <div className="flex flex-col gap-4">
      <PageHeader>Exporty</PageHeader>
      <Card>
        {items.length === 0 && (
          <p className="text-sm opacity-70">Zatím nebyl odeslán žádný záznam do REDCap.</p>
        )}
        <ul className="divide-y divide-base-300">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/pripady/$caseId"
                params={{ caseId: item.id }}
                className="flex flex-wrap items-center gap-3 rounded-field p-4 text-base-content no-underline hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="min-w-0 flex-1 font-medium break-words">{item.name}</span>
                <CaseStatusBadge size="sm" status={item.status} />
                <span className="text-sm break-all">REDCap ID: {item.redcapRecordId}</span>
                {item.exportedAt !== null && (
                  <time className="text-sm opacity-70" dateTime={item.exportedAt}>
                    {new Date(item.exportedAt).toLocaleString("cs-CZ", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function ExportListPending() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader>Exporty</PageHeader>
      <Card>
        <Skeleton className="h-24 w-full" />
      </Card>
    </div>
  );
}
