import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps, notFound } from "@tanstack/react-router";
import { isTRPCClientError } from "@trpc/client";

import type { AppRouter } from "@prostapaper/api";
import { CaseId, CaseStatus, DocumentStatus } from "@prostapaper/contracts";

import { CaseDetail } from "#components/case-detail/case-detail";
import { RouteError } from "#components/route-error";
import { useTRPC } from "#trpc";
import { ButtonLink, Card, Skeleton } from "#ui";

export const Route = createFileRoute("/_app/pripady/$caseId")({
  loader: async ({ params, context: { queryClient, trpc } }) => {
    if (!CaseId.safeParse(params.caseId).success) {
      notFound({ throw: true });
    }
    try {
      await queryClient.query(trpc.case.get.queryOptions({ caseId: params.caseId }, { staleTime: 30_000 }));
    } catch (error) {
      if (isTRPCClientError<AppRouter>(error) && error.data?.code === "NOT_FOUND") {
        notFound({ throw: true });
      }
      throw error;
    }
  },
  pendingComponent: CaseDetailPending,
  errorComponent: CaseDetailError,
  notFoundComponent: CaseNotFound,
  component: CaseDetailPage,
});

function CaseDetailPage() {
  const { caseId } = Route.useParams();
  const trpc = useTRPC();
  const { data: item } = useSuspenseQuery(
    trpc.case.get.queryOptions(
      { caseId },
      {
        staleTime: 30_000,
        refetchInterval: (query) => {
          const current = query.state.data;
          if (current === undefined) return false;
          if (
            current.status === CaseStatus.enum.queued ||
            current.status === CaseStatus.enum.mapping ||
            current.status === CaseStatus.enum.exporting ||
            current.documents.some((doc) => doc.status !== DocumentStatus.enum.extracted)
          )
            return 5000;

          return false;
        },
      },
    ),
  );

  return <CaseDetail key={caseId} case={item} />;
}

function CaseDetailError(props: ErrorComponentProps) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries();
    props.reset();
  };

  return <RouteError {...props} reset={() => void retry()} />;
}

function CaseNotFound() {
  return (
    <Card heading="Případ nebyl nalezen">
      <p>Případ neexistuje nebo není dostupný.</p>
      <ButtonLink to="/pripady" size="sm" variant="outline" className="self-start">
        Zpět na případy
      </ButtonLink>
    </Card>
  );
}

function CaseDetailPending() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
