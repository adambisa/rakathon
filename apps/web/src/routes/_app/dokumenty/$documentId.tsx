import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps, notFound } from "@tanstack/react-router";
import { isTRPCClientError } from "@trpc/client";

import type { AppRouter } from "@prostapaper/api";
import { DocumentId } from "@prostapaper/contracts";

import { DocumentDetail, DocumentDetailPending } from "#components/document-detail";
import { RouteError } from "#components/route-error";
import { useTRPC } from "#trpc";
import { ButtonLink, Card } from "#ui";

export const Route = createFileRoute("/_app/dokumenty/$documentId")({
  loader: async ({ params, context: { queryClient, trpc } }) => {
    if (!DocumentId.safeParse(params.documentId).success) {
      notFound({ throw: true });
    }
    try {
      await queryClient.query(
        trpc.document.get.queryOptions({ documentId: params.documentId }, { staleTime: 30_000 }),
      );
    } catch (error) {
      if (isTRPCClientError<AppRouter>(error) && error.data?.code === "NOT_FOUND") {
        notFound({ throw: true });
      }
      throw error;
    }
  },
  pendingComponent: DocumentDetailPending,
  errorComponent: DocumentDetailError,
  notFoundComponent: DocumentNotFound,
  component: DocumentDetailPage,
});

function DocumentDetailPage() {
  const { documentId } = Route.useParams();
  const trpc = useTRPC();
  const { data: document } = useSuspenseQuery(
    trpc.document.get.queryOptions(
      { documentId },
      {
        staleTime: 30_000,
        refetchInterval: (query) => (query.state.data?.status === "extracted" ? false : 5000),
      },
    ),
  );

  return <DocumentDetail key={documentId} document={document} />;
}

function DocumentDetailError(props: ErrorComponentProps) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries();
    props.reset();
  };

  return <RouteError {...props} reset={() => void retry()} />;
}

function DocumentNotFound() {
  return (
    <Card heading="Dokument nebyl nalezen">
      <p>Dokument neexistuje nebo není dostupný.</p>
      <ButtonLink to="/dokumenty" size="sm" variant="outline" className="self-start">
        Zpět na dokumenty
      </ButtonLink>
    </Card>
  );
}
