import type { ReactNode } from "react";

import { type Case, DocumentStatus } from "@prostapaper/contracts";

import { CaseSharing } from "#components/case-detail/case-sharing";
import { PageHeader, PageHeaderBack } from "#components/page-header";
import { UploadedBy } from "#components/uploaded-by";
import { CaseStatusBadge } from "#ui";

export interface CaseLayoutProps {
  case: Case;
  children: ReactNode;
}

export function CaseLayout({ case: item, children }: CaseLayoutProps) {
  const extractedDocuments = item.documents.filter(
    (document) => document.status === DocumentStatus.enum.extracted,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={<PageHeaderBack fallback="/pripady" aria-label="Zpět na případy" />}
        status={<CaseStatusBadge status={item.status} />}
        actions={item.accessRole === "owner" && <CaseSharing case={item} />}
      >
        Pripad: {item.name}
      </PageHeader>
      <dl
        aria-label="Informace o případu"
        className="-mt-2 flex flex-wrap gap-x-6 gap-y-2 border-b border-base-300 pb-4 text-sm [&_dd]:font-medium [&_dd]:wrap-anywhere [&_dt]:text-base-content/70 [&>div]:flex [&>div]:min-w-0 [&>div]:flex-wrap [&>div]:gap-x-2"
      >
        <div>
          <dt>Vlastník</dt>
          <dd>
            <UploadedBy user={item.owner} />
          </dd>
        </div>
        <div>
          <dt>Vytvořeno</dt>
          <dd>
            <time dateTime={item.createdAt}>
              {new Date(item.createdAt).toLocaleString("cs-CZ", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </dd>
        </div>
        <div>
          <dt>Dokumenty</dt>
          <dd>{item.documents.length}</dd>
        </div>
        <div>
          <dt>Zpracováno</dt>
          <dd>
            {extractedDocuments} z {item.documents.length}
          </dd>
        </div>
      </dl>

      {children}
    </div>
  );
}
