import { useQuery } from "@tanstack/react-query";

import type { Case } from "@prostapaper/contracts";

import { ReviewActions } from "#components/case-detail/review/review-actions";
import { CaseDocuments } from "#components/case-detail/shared/case-documents";
import { errorMessage } from "#lib/error-message";
import { useTRPC } from "#trpc";
import { Button, Card, Skeleton } from "#ui";

export interface ReviewReadyStageProps {
  case: Case;
}

export function ReviewReadyStage({ case: item }: ReviewReadyStageProps) {
  const trpc = useTRPC();
  const result = useQuery(trpc.case.review.get.queryOptions({ caseId: item.id }, { staleTime: 0 }));
  const workspace = result.data;

  return (
    <div className="grid items-start gap-4 @3xl/main:grid-cols-[minmax(0,13fr)_minmax(0,7fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card heading="Souhrn před revizí">
          <p className="text-sm opacity-70">
            Při revizi ověříte počet ložisek, jejich údaje a přiřazení značek ze schématu.
          </p>
          {result.error !== null && (
            <div role="alert" className="text-sm text-error">
              {errorMessage(result.error)}{" "}
              <Button size="sm" onClick={() => void result.refetch()}>
                Zkusit znovu
              </Button>
            </div>
          )}
          {workspace === undefined && result.error === null && <Skeleton className="h-24 w-full" />}
          {workspace !== undefined && (
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3 [&_dd]:text-2xl [&_dd]:font-semibold [&_dt]:text-base-content/70">
              <div>
                <dt>Navržená ložiska</dt>
                <dd>{workspace.record.lesions.length}</dd>
              </div>
              <div>
                <dt>Údaje k ověření</dt>
                <dd>
                  {
                    workspace.workflowStatus.fields.filter(
                      (field) =>
                        field.reference.scope !== "surgery" && field.decisionRequired && !field.resolved,
                    ).length
                  }
                </dd>
              </div>
              <div>
                <dt>Značky k přiřazení</dt>
                <dd>
                  {
                    workspace.marks.filter(
                      (mark) => mark.status !== "assigned" && mark.status !== "dismissed",
                    ).length
                  }
                </dd>
              </div>
            </dl>
          )}
        </Card>
        <ReviewActions case={item} />
      </div>
      <CaseDocuments case={item} />
    </div>
  );
}
