import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { ReviewQueue, ReviewQueuePending } from "#components/review-queue";
import { RouteError } from "#components/route-error";

export const Route = createFileRoute("/_app/ke-kontrole")({
  loader: async ({ context: { queryClient, trpc } }) => {
    await queryClient.query(trpc.case.reviewQueue.queryOptions());
  },
  pendingComponent: ReviewQueuePending,
  errorComponent: ReviewQueueError,
  component: ReviewQueue,
});

function ReviewQueueError(props: ErrorComponentProps) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries();
    props.reset();
  };

  return <RouteError {...props} reset={() => void retry()} />;
}
