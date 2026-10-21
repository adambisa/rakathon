import type { Case } from "@prostapaper/contracts";

import { CaseMapping } from "#components/case-detail/review/case-mapping";
import { ReviewActions } from "#components/case-detail/review/review-actions";
import { CaseDocuments } from "#components/case-detail/shared/case-documents";

export interface ReviewStageProps {
  case: Case;
}

export function ReviewStage({ case: item }: ReviewStageProps) {
  return (
    <CaseMapping
      caseId={item.id}
      sidebar={
        <>
          <ReviewActions case={item} />
          <CaseDocuments case={item} />
        </>
      }
    />
  );
}
