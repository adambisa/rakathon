import { type Case, CaseStatus } from "@prostapaper/contracts";

import { CaseDocuments } from "#components/case-detail/shared/case-documents";
import { toProcessingGraph } from "#lib/processing-graph";
import { Card, PipelineGraph } from "#ui";

export interface ProcessingStageProps {
  case: Case;
}

export function ProcessingStage({ case: item }: ProcessingStageProps) {
  const { nodes, links, progress } = toProcessingGraph(item);

  return (
    <div className="grid items-start gap-4 @3xl/main:grid-cols-[minmax(0,13fr)_minmax(0,7fr)]">
      <Card heading="Průběh zpracování" className="min-w-0">
        <p role="status" className="text-sm opacity-70">
          {progress.extracted} z {progress.total} dokumentů má extrahovaný text.
          {progress.complete && " Extrakce je dokončena."}
          {item.status === CaseStatus.enum.mapping && " Probíhá mapování případu."}
        </p>
        {nodes.length > 0 && <PipelineGraph nodes={nodes} links={links} nodeWidth={220} />}
      </Card>
      <CaseDocuments case={item} />
    </div>
  );
}
