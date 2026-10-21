import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { CASE_PAGE_SIZE } from "@prostapaper/contracts";

import { CaseList, CaseListPending } from "#components/case-list";
import { RouteError } from "#components/route-error";

export const Route = createFileRoute("/_app/pripady/")({
  loader: async ({ context: { queryClient, trpc } }) => {
    await queryClient.query(trpc.case.list.queryOptions({ limit: CASE_PAGE_SIZE }));
  },
  pendingComponent: CaseListPending,
  errorComponent: PripadyError,
  component: CaseList,
});

function PripadyError(props: ErrorComponentProps) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries();
    props.reset();
  };

  return <RouteError {...props} reset={() => void retry()} />;
}
