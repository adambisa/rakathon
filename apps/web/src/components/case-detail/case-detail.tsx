import type { ComponentType } from "react";

import { type Case, CaseStatus } from "@prostapaper/contracts";

import { CaseLayout } from "#components/case-detail/case-layout";
import { DraftStage } from "#components/case-detail/draft/draft-stage";
import { ExportStage } from "#components/case-detail/export/export-stage";
import { ProcessingStage } from "#components/case-detail/processing/processing-stage";
import { ReviewReadyStage } from "#components/case-detail/review/review-ready-stage";
import { ReviewStage } from "#components/case-detail/review/review-stage";

const CASE_STAGES = {
  [CaseStatus.enum.draft]: DraftStage,
  [CaseStatus.enum.queued]: ProcessingStage,
  [CaseStatus.enum.mapping]: ProcessingStage,
  [CaseStatus.enum.ready_for_review]: ReviewReadyStage,
  [CaseStatus.enum.in_review]: ReviewStage,
  [CaseStatus.enum.approved]: ExportStage,
  [CaseStatus.enum.exporting]: ExportStage,
  [CaseStatus.enum.exported]: ExportStage,
} satisfies Record<CaseStatus, ComponentType<CaseDetailProps>>;

export interface CaseDetailProps {
  case: Case;
}

export function CaseDetail({ case: item }: CaseDetailProps) {
  const Stage = CASE_STAGES[item.status];

  return (
    <CaseLayout case={item}>
      <Stage case={item} />
    </CaseLayout>
  );
}
