import { useState } from "react";

import type { Document } from "@prostapaper/contracts";

import { useDocumentSource } from "#lib/use-document-source";
import { Skeleton } from "#ui";

export interface DocumentThumbnailProps {
  document: Document;
}

export function DocumentThumbnail({ document }: DocumentThumbnailProps) {
  const source = useDocumentSource(document.id);
  const [failedUrl, setFailedUrl] = useState<string>();

  if (source.data === undefined && !source.isError) {
    return <Skeleton className="absolute inset-0 rounded-none" />;
  }
  if (source.data === undefined || source.data.url === failedUrl) return null;

  return (
    <img
      src={source.data.url}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="absolute inset-0 size-full bg-base-200 object-cover"
      onError={() => setFailedUrl(source.data?.url)}
    />
  );
}
