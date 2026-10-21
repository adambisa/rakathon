import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { DocumentList, DocumentListPending } from "#components/document-list";
import { RouteError } from "#components/route-error";

export const Route = createFileRoute("/_app/dokumenty/")({
  loader: async ({ context: { queryClient, trpc } }) => {
    await queryClient.query(trpc.document.list.queryOptions());
  },
  pendingComponent: DocumentListPending,
  errorComponent: DokumentyError,
  component: DocumentList,
});

function DokumentyError(props: ErrorComponentProps) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries();
    props.reset();
  };

  return <RouteError {...props} reset={() => void retry()} />;
}
