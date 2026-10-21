import { useSuspenseQuery } from "@tanstack/react-query";

import type { ReviewQueueSummary } from "@prostapaper/contracts";

import { PageHeader } from "#components/page-header";
import { useTRPC } from "#trpc";
import { Badge, Card, CaseStatusBadge, Icon, Link, Skeleton } from "#ui";

const HEADING = "Ke kontrole";

export function ReviewQueue() {
  const trpc = useTRPC();
  const { data: cases } = useSuspenseQuery({
    ...trpc.case.reviewQueue.queryOptions(),
    refetchInterval: 10_000,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader>{HEADING}</PageHeader>
      <Card>
        {cases.length === 0 && <p className="text-sm opacity-70">Žádný případ nečeká na kontrolu.</p>}
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
                <ReviewSummary status={item.status} review={item.review} />
                <span className="text-sm opacity-70">{item.documents.length} dokumentů</span>
                {item.mappedAt !== null && (
                  <time className="text-sm opacity-70" dateTime={item.mappedAt}>
                    {new Date(item.mappedAt).toLocaleString("cs-CZ", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                )}
                <Icon name="arrowLeft" size="sm" className="rotate-180 opacity-60" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

interface ReviewSummaryProps {
  status: string;
  review: ReviewQueueSummary | null;
}
function ReviewSummary({ status, review }: ReviewSummaryProps) {
  if (status !== "in_review") return null;
  if (review === null)
    return (
      <Badge size="sm" variant="outline">
        Bez uložené revize
      </Badge>
    );
  const open =
    review.blockingIssueCount +
    review.unresolvedFieldCount +
    review.unresolvedMarkCount +
    review.unconfirmedSectionCount;
  if (open === 0)
    return (
      <Badge size="sm" tone="success" variant="soft" icon="check">
        Připraveno ke schválení
      </Badge>
    );

  return (
    <span className="flex flex-wrap items-center gap-1">
      {review.blockingIssueCount > 0 && (
        <Badge size="sm" tone="error" variant="soft">
          Chyby: {review.blockingIssueCount}
        </Badge>
      )}
      {review.unresolvedFieldCount > 0 && (
        <Badge size="sm" tone="warning" variant="soft">
          Rozhodnutí: {review.unresolvedFieldCount}
        </Badge>
      )}
      {review.unresolvedMarkCount > 0 && (
        <Badge size="sm" tone="warning" variant="soft">
          Značky: {review.unresolvedMarkCount}
        </Badge>
      )}
      {review.unconfirmedSectionCount > 0 && (
        <Badge size="sm" variant="outline">
          Sekce k potvrzení: {review.unconfirmedSectionCount}
        </Badge>
      )}
    </span>
  );
}

export function ReviewQueuePending() {
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
