import { type Case, CaseStatus, type Document, DocumentStatus } from "@prostapaper/contracts";

import { type PipelineNode, StepState } from "#lib/pipeline";

const DOCUMENT_PRESENTATION: Record<
  DocumentStatus,
  { upload: StepState; extraction: StepState; description: string }
> = {
  [DocumentStatus.enum.awaiting_upload]: {
    upload: StepState.Pending,
    extraction: StepState.Pending,
    description: "Čeká na soubor",
  },
  [DocumentStatus.enum.uploaded]: {
    upload: StepState.Done,
    extraction: StepState.Queued,
    description: "Čeká na extrakci",
  },
  [DocumentStatus.enum.extracting]: {
    upload: StepState.Done,
    extraction: StepState.Active,
    description: "Probíhá extrakce",
  },
  [DocumentStatus.enum.extracted]: {
    upload: StepState.Done,
    extraction: StepState.Done,
    description: "Text připraven",
  },
};

function projectDocument(document: Document) {
  const presentation = DOCUMENT_PRESENTATION[document.status];
  const upload: PipelineNode = {
    id: `${document.id}-upload`,
    label: document.filename,
    description: presentation.upload === StepState.Done ? "Nahráno" : "Čeká na soubor",
    state: presentation.upload,
  };
  const extraction: PipelineNode = {
    id: `${document.id}-extraction`,
    label: "Extrakce textu",
    description: presentation.description,
    state: presentation.extraction,
  };

  return { nodes: [upload, extraction], link: { from: upload, to: extraction } };
}

const MAPPING_PRESENTATION: Record<CaseStatus, { state: StepState; description: string }> = {
  [CaseStatus.enum.draft]: { state: StepState.Pending, description: "Čeká na odeslání" },
  [CaseStatus.enum.queued]: { state: StepState.Queued, description: "Čeká na extrakci" },
  [CaseStatus.enum.mapping]: { state: StepState.Active, description: "Probíhá mapování" },
  [CaseStatus.enum.ready_for_review]: { state: StepState.Done, description: "Záznam připraven" },
  [CaseStatus.enum.in_review]: { state: StepState.Done, description: "Záznam připraven" },
  [CaseStatus.enum.approved]: { state: StepState.Done, description: "Záznam připraven" },
  [CaseStatus.enum.exporting]: { state: StepState.Done, description: "Záznam připraven" },
  [CaseStatus.enum.exported]: { state: StepState.Done, description: "Záznam připraven" },
};

/** Projects persisted document statuses into presentation data; no workflow transitions. */
export function toProcessingGraph(item: Case) {
  const documents = item.documents.map(projectDocument);
  const extracted = item.documents.filter(
    (document) => document.status === DocumentStatus.enum.extracted,
  ).length;
  const mapping: PipelineNode = {
    id: `${item.id}-mapping`,
    label: "Mapování záznamu",
    ...MAPPING_PRESENTATION[item.status],
  };

  return {
    nodes: [...documents.flatMap((document) => document.nodes), mapping],
    links: [
      ...documents.map((document) => document.link),
      ...documents.map((document) => ({ from: document.link.to, to: mapping })),
    ],
    progress: {
      extracted,
      total: item.documents.length,
      complete: item.documents.length > 0 && extracted === item.documents.length,
    },
  };
}
