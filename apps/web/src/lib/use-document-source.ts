import { useQuery } from "@tanstack/react-query";

import type { Document } from "@prostapaper/contracts";

import { documentTicketCache, usableDocumentTicket } from "#lib/document-ticket-cache";
import { useTRPC } from "#trpc";

export const isUploaded = (document: Document): boolean => document.status !== "awaiting_upload";

export function useDocumentSource(documentId: string, target: "source" | "extraction" = "source") {
  const trpc = useTRPC();

  const source = useQuery(trpc.document.presignGet.queryOptions({ documentId, target }, documentTicketCache));

  return {
    data: usableDocumentTicket(source.data),
    error: source.error,
    isPending: source.isPending,
    isError: source.isError,
    isFetching: source.isFetching,
    refetch: source.refetch,
  };
}
