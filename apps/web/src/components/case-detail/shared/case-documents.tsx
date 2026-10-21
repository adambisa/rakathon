import type { Case } from "@prostapaper/contracts";

import { DisplayDocumentCard } from "#components/display-document-card";
import { Card } from "#ui";

export interface CaseDocumentsProps {
  case: Case;
}

export function CaseDocuments({ case: item }: CaseDocumentsProps) {
  return (
    <Card heading="Dokumenty případu" className="@container/documents min-w-0">
      {item.documents.length === 0 && <p className="text-sm opacity-70">Případ zatím nemá dokumenty.</p>}
      <ul className="grid gap-3 @2xl/documents:grid-cols-2">
        {item.documents.map((document) => (
          <li key={document.id} className="min-w-0">
            <DisplayDocumentCard document={document} compact showOpenButton={false} showDate={false} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
