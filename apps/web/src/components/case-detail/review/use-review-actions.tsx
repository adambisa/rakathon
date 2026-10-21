import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { useRef } from "react";

import type { AppRouter } from "@prostapaper/api";
import {
  CaseId,
  type ReviewFieldRef,
  type ReviewOperation,
  type ReviewSectionRef,
  type ReviewWorkspace,
} from "@prostapaper/contracts";

import { toast } from "#lib/toast";
import { useTRPC, useTRPCClient } from "#trpc";

type ReviewAction =
  | { kind: "save"; operations: ReviewOperation[]; note?: string }
  | { kind: "decideField"; reference: ReviewFieldRef; note: string | null }
  | { kind: "confirmSection" | "revokeSection"; reference: ReviewSectionRef }
  | { kind: "assignMark"; markId: string; lesionId: string; note: string }
  | { kind: "dismissMark"; markId: string; note: string }
  | { kind: "approve" };
interface Command {
  action: ReviewAction;
  workspace: ReviewWorkspace;
  requestId: string;
}

const SUCCESS_MESSAGE: Record<ReviewAction["kind"], string> = {
  save: "Změna byla uložena.",
  decideField: "Rozhodnutí bylo zaznamenáno.",
  confirmSection: "Sekce byla potvrzena.",
  revokeSection: "Sekce byla znovu otevřena.",
  assignMark: "Značka byla přiřazena.",
  dismissMark: "Značka byla odmítnuta.",
  approve: "Revize byla schválena.",
};

const lostResponse = (error: unknown) =>
  isTRPCClientError<AppRouter>(error) && error.data?.code === undefined;

export function useReviewActions(caseId: string, workspace: ReviewWorkspace) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const cache = useQueryClient();
  const previous = useRef<{ key: string; command: Command } | null>(null);
  const refreshReview = async () => cache.invalidateQueries(trpc.case.review.get.queryFilter({ caseId }));
  const refreshCase = async () => {
    await Promise.all([
      refreshReview(),
      cache.invalidateQueries(trpc.case.get.queryFilter({ caseId })),
      cache.invalidateQueries(trpc.case.list.pathFilter()),
      cache.invalidateQueries(trpc.case.reviewQueue.pathFilter()),
      cache.invalidateQueries(trpc.case.exports.pathFilter()),
    ]);
  };
  const mutation = useMutation({
    mutationFn: async ({ action, workspace: base, requestId }: Command) => {
      const identity = {
        caseId: CaseId.parse(caseId),
        mappingIdentity: base.mappingIdentity,
        baseline: base.baseline,
        expectedRevision: base.revision,
        requestId,
      };
      switch (action.kind) {
        case "save": {
          if (action.note !== undefined)
            return client.case.review.save.mutate({
              ...identity,
              operations: action.operations,
              note: action.note,
            });

          return client.case.review.save.mutate({ ...identity, operations: action.operations });
        }
        case "decideField": {
          return client.case.review.decideField.mutate({
            ...identity,
            reference: action.reference,
            note: action.note,
          });
        }
        case "confirmSection": {
          return client.case.review.confirmSection.mutate({ ...identity, reference: action.reference });
        }
        case "revokeSection": {
          return client.case.review.revokeSection.mutate({ ...identity, reference: action.reference });
        }
        case "assignMark": {
          return client.case.review.assignMark.mutate({
            ...identity,
            markId: action.markId,
            lesionId: action.lesionId,
            note: action.note,
          });
        }
        case "dismissMark": {
          return client.case.review.dismissMark.mutate({
            ...identity,
            markId: action.markId,
            note: action.note,
          });
        }
        case "approve": {
          return client.case.approve.mutate({
            caseId: identity.caseId,
            expectedRevision: identity.expectedRevision,
          });
        }
      }
    },
    // A lost response is replayed with the same request ID, which the server deduplicates.
    retry: (count, error) => count < 1 && lostResponse(error),
    onSuccess: async (_result, { action }) => {
      previous.current = null;
      if (action.kind !== "save" || action.operations.length > 0 || action.note !== undefined)
        toast.success(SUCCESS_MESSAGE[action.kind]);
      await refreshCase();
    },
    // Refresh the workspace after rejection so retained editors can compare against the latest revision.
    onError: refreshReview,
  });
  const run = async (action: ReviewAction, base = workspace) => {
    const key = JSON.stringify([base.revision, base.baseline, action]);
    let command = previous.current?.command;
    if (previous.current?.key !== key || command === undefined) {
      command = { action, workspace: base, requestId: crypto.randomUUID() };
      previous.current = { key, command };
    }
    await mutation.mutateAsync(command);
  };

  return { run, mutation };
}
