import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { ExportList, ExportListPending } from "#components/export-list";
import { RouteError } from "#components/route-error";

export const Route = createFileRoute("/_app/exporty")({
  loader: async ({ context: { queryClient, trpc } }) => {
    await queryClient.query(trpc.case.exports.queryOptions());
  },
  pendingComponent: ExportListPending,
  errorComponent: ExportListError,
  component: ExportList,
});

function ExportListError(props: ErrorComponentProps) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries();
    props.reset();
  };

  return <RouteError {...props} reset={() => void retry()} />;
}
