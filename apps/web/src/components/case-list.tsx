import { useSuspenseQuery } from "@tanstack/react-query";
import { useState, useTransition } from "react";

import { CASE_PAGE_SIZE, CaseStatus, DocumentStatus } from "@prostapaper/contracts";

import { PageHeader } from "#components/page-header";
import { useTRPC } from "#trpc";
import { Button, Card, CaseStatusBadge, Icon, Link, Skeleton } from "#ui";

const POLLED_CASE_STATUSES = new Set<CaseStatus>([
  CaseStatus.enum.queued,
  CaseStatus.enum.mapping,
  CaseStatus.enum.exporting,
]);

const HEADING = "Moje případy";

export function CaseList() {
  const trpc = useTRPC();
  const [limit, setLimit] = useState(CASE_PAGE_SIZE);
  const [isLoadingMore, startLoadingMore] = useTransition();
  const {
    data: { cases, hasMore },
  } = useSuspenseQuery({
    ...trpc.case.list.queryOptions({ limit }),
    refetchInterval: (query) => {
      const items = query.state.data?.cases;
      if (items === undefined) return false;
      if (
        items.some(
          (item) =>
            item.documents.some((doc) => doc.status === DocumentStatus.enum.awaiting_upload) ||
            POLLED_CASE_STATUSES.has(item.status),
        )
      )
        return 2000;

      return false;
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader>{HEADING}</PageHeader>
      <Card>
        {cases.length === 0 && <p className="text-sm opacity-70">Zatím nebyl vytvořen žádný případ.</p>}
        <ul className="divide-y divide-base-300">
          {cases.map((item) => (
            <li key={item.id}>
              <Link
                to="/pripady/$caseId"
                params={{ caseId: item.id }}
                className="flex flex-wrap items-center gap-3 rounded-field p-4 text-base-content no-underline hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="min-w-0 flex-1 font-medium break-words">{item.name}</span>
                <CaseStatusBadge size="sm" status={item.status} />
                <span className="text-sm opacity-70">{item.documents.length} dokumentů</span>
                <time className="text-sm opacity-70" dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleDateString("cs-CZ")}
                </time>
                <Icon name="arrowLeft" size="sm" className="rotate-180 opacity-60" />
              </Link>
            </li>
          ))}
        </ul>
        {hasMore && (
          <Button
            variant="ghost"
            loading={isLoadingMore}
            className="self-center"
            onClick={() => startLoadingMore(() => setLimit((current) => current + CASE_PAGE_SIZE))}
          >
            Zobrazit dalších {CASE_PAGE_SIZE}
          </Button>
        )}
      </Card>
    </div>
  );
}

export function CaseListPending() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader>{HEADING}</PageHeader>
      <Card>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </Card>
    </div>
  );
}
