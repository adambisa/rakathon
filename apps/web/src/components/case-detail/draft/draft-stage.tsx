import type { Case } from "@prostapaper/contracts";

import { CaseDocuments } from "#components/case-detail/shared/case-documents";
import { Card } from "#ui";

export interface DraftStageProps {
  case: Case;
}

export function DraftStage({ case: item }: DraftStageProps) {
  return (
    <div className="grid items-start gap-4 @3xl/main:grid-cols-[minmax(0,13fr)_minmax(0,7fr)]">
      <Card heading="Nedokončený případ" className="min-w-0">
        <p>Případ ještě nebyl odeslán ke zpracování.</p>
      </Card>
      <CaseDocuments case={item} />
    </div>
  );
}
