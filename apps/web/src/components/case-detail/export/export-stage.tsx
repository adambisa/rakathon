import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type Case, lesionsFromRecord } from "@prostapaper/contracts";

import { CaseDocuments } from "#components/case-detail/shared/case-documents";
import { errorMessage } from "#lib/error-message";
import { formatMappingValue } from "#lib/mapping-format";
import { toast } from "#lib/toast";
import { useTRPC } from "#trpc";
import { Button, ButtonLink, Card, SectorDiagram, Skeleton } from "#ui";

export interface ExportStageProps {
  case: Case;
}

export function ExportStage({ case: item }: ExportStageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const result = useQuery(trpc.case.review.get.queryOptions({ caseId: item.id }, { staleTime: 0 }));
  const lesions = result.data?.record.lesions;
  const settle = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.case.review.get.queryFilter({ caseId: item.id })),
      queryClient.invalidateQueries(trpc.case.get.queryFilter({ caseId: item.id })),
      queryClient.invalidateQueries(trpc.case.list.pathFilter()),
      queryClient.invalidateQueries(trpc.case.reviewQueue.pathFilter()),
      queryClient.invalidateQueries(trpc.case.exports.pathFilter()),
    ]);
  };
  const reopen = useMutation(
    trpc.case.reopen.mutationOptions({
      retry: false,
      onError: () => toast.error("Revizi se nepodařilo znovu otevřít. Obnovte stav případu."),
      onSettled: settle,
    }),
  );
  const send = useMutation(
    trpc.case.sendToRedcap.mutationOptions({
      retry: false,
      onSuccess: () => toast.success("Záznam byl odeslán do REDCap."),
      onError: () => toast.error("Odeslání nebylo potvrzeno. Zkontrolujte aktuální stav případu."),
      onSettled: settle,
    }),
  );
  const busy = send.isPending || reopen.isPending;
  let heading = "Odeslání do REDCap";
  if (item.status === "exporting") heading = "Odesílání do REDCap";
  if (item.status === "exported") heading = "Odesláno do REDCap";

  return (
    <div className="grid items-start gap-4 @3xl/main:grid-cols-[minmax(0,13fr)_minmax(0,7fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card heading={heading}>
          {item.status === "approved" && (
            <p className="text-sm opacity-70">
              Revize je schválena. Odesláním se v REDCap vytvoří nový záznam s automaticky přiděleným ID.
              Opakované formuláře resekovaných ložisek budou označeny jako dokončené.
            </p>
          )}
          {item.status === "exporting" && (
            <p role="status" className="text-sm">
              {item.exportUnconfirmed
                ? "Výsledek odeslání není potvrzen. Před dalším pokusem musí správce ověřit záznam v REDCap. Opakované odeslání a návrat k revizi jsou zablokovány."
                : "Probíhá odesílání do REDCap. Vyčkejte na potvrzení; stav se aktualizuje automaticky."}
            </p>
          )}
          {item.status === "exported" && (
            <p className="text-sm opacity-70">Záznam je uzamčen a nelze jej znovu odeslat ani upravit.</p>
          )}
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 [&_dd]:text-2xl [&_dd]:font-semibold [&_dt]:text-base-content/70">
            <div>
              <dt>{item.status === "exported" ? "Odeslaná ložiska" : "Ložiska k odeslání"}</dt>
              <dd>
                {lesions?.length}
                {lesions === undefined && <Skeleton className="h-8 w-10" />}
              </dd>
            </div>
            {item.status === "exported" && (
              <div>
                <dt>REDCap ID</dt>
                <dd className="break-all">{item.redcapRecordId}</dd>
              </div>
            )}
          </dl>
          <p className="text-sm opacity-70">
            {item.approvedAt !== null && (
              <>
                Schváleno <DateTime value={item.approvedAt} />.{" "}
              </>
            )}
            {item.exportedAt !== null && (
              <>
                Odesláno <DateTime value={item.exportedAt} />.
              </>
            )}
          </p>
          {item.status === "approved" && (
            <div className="flex flex-wrap justify-end gap-3">
              {item.accessRole !== "viewer" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  loading={reopen.isPending}
                  onClick={() => reopen.mutate({ caseId: item.id })}
                >
                  Zpět k revizi
                </Button>
              )}
              {item.accessRole === "owner" && (
                <Button
                  tone="primary"
                  disabled={busy}
                  loading={send.isPending}
                  onClick={() => send.mutate({ caseId: item.id })}
                >
                  Odeslat do REDCap
                </Button>
              )}
            </div>
          )}
          {send.isError && (
            <p role="alert" className="text-sm text-error">
              Odeslání se nepodařilo zahájit. Zkontrolujte připojení a konfiguraci REDCap. Pokud odeslání již
              začalo, aktualizovaný stav zabrání opakování.
            </p>
          )}
          {item.status === "exported" && (
            <ButtonLink to="/exporty" variant="outline" className="self-end">
              Zobrazit exporty
            </ButtonLink>
          )}
        </Card>
        <Card heading="Schválená ložiska">
          {result.error !== null && (
            <div role="alert" className="text-sm text-error">
              {errorMessage(result.error)}{" "}
              <Button size="sm" onClick={() => void result.refetch()}>
                Zkusit znovu
              </Button>
            </div>
          )}
          {result.data === undefined && result.error === null && <Skeleton className="h-48 w-full" />}
          {result.data !== undefined && lesions !== undefined && (
            <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
              <ol className="grid gap-2 text-sm">
                {lesions.map((lesion, index) => (
                  <li
                    key={result.data.lesionIds[index] ?? index}
                    className="rounded-box border border-base-300 p-3"
                  >
                    <p className="font-medium">Ložisko {index + 1}</p>
                    <p className="text-base-content/70">{formatMappingValue(lesion.sur_prostate_regions)}</p>
                    <p className="text-base-content/70">
                      {[lesion.lesion_x_mm, lesion.lesion_y_mm, lesion.lesion_z_mm]
                        .map((size) => size ?? "–")
                        .join(" × ")}{" "}
                      mm
                    </p>
                  </li>
                ))}
              </ol>
              <SectorDiagram lesions={lesionsFromRecord(result.data.record)} />
            </div>
          )}
        </Card>
        {result.data !== undefined && result.data.note !== "" && (
          <Card heading="Poznámka k případu">
            <p className="text-sm whitespace-pre-wrap">{result.data.note}</p>
          </Card>
        )}
      </div>
      <CaseDocuments case={item} />
    </div>
  );
}

interface DateTimeProps {
  value: string;
}

function DateTime({ value }: DateTimeProps) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}
