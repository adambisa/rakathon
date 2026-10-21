import { useMutation, useQueryClient } from "@tanstack/react-query";

import { type Case, CaseStatus } from "@prostapaper/contracts";

import { errorMessage } from "#lib/error-message";
import { toast } from "#lib/toast";
import { useTRPC } from "#trpc";
import { Button, Card } from "#ui";

export interface ReviewActionsProps {
  case: Case;
}

export function ReviewActions({ case: item }: ReviewActionsProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const settle = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.case.review.get.queryFilter({ caseId: item.id })),
      queryClient.invalidateQueries(trpc.case.get.queryFilter({ caseId: item.id })),
      queryClient.invalidateQueries(trpc.case.list.pathFilter()),
      queryClient.invalidateQueries(trpc.case.reviewQueue.pathFilter()),
    ]);
  };
  const startReview = useMutation(
    trpc.case.startReview.mutationOptions({
      onSuccess: () => toast.success("Revize byla zahájena."),
      onError: (error) => toast.error(errorMessage(error)),
      onSettled: settle,
    }),
  );

  if (item.accessRole === "viewer") {
    return (
      <Card heading="Kontrola záznamu">
        <p className="text-sm opacity-70">Máte přístup pouze pro čtení.</p>
      </Card>
    );
  }

  if (item.status === CaseStatus.enum.ready_for_review) {
    return (
      <Card
        heading="Kontrola ložisek"
        actions={
          <Button
            tone="primary"
            loading={startReview.isPending}
            onClick={() => startReview.mutate({ caseId: item.id })}
          >
            Zahájit revizi
          </Button>
        }
      >
        <p className="text-sm opacity-70">
          Ložiska byla vyhodnocena. Zahájením revize otevřete editor pro porovnání s dokumenty a kontrolu
          údajů.
        </p>
      </Card>
    );
  }
  if (item.status === CaseStatus.enum.in_review) {
    return (
      <Card heading="Kontrola ložisek">
        <p className="text-sm opacity-70">
          Porovnejte ložiska s dokumenty. Schválením přejdete k odeslání do REDCap.
        </p>
      </Card>
    );
  }

  return null;
}
