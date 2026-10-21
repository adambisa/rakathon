import { useState } from "react";

import { reviewFieldKey, reviewRecordFields, type ReviewWorkspace } from "@prostapaper/contracts";

import type { useReviewActions } from "#components/case-detail/review/use-review-actions";
import { formatMappingValue, formatMarkLabel } from "#lib/mapping-format";
import type { MappingFieldView } from "#lib/mapping-review";
import { emptyReviewLesion } from "#lib/review-edit";
import { reviewErrorMessage } from "#lib/review-errors";
import { Button, Modal, Select, Textarea } from "#ui";

export type ReviewDialog =
  | { kind: "decision"; field: MappingFieldView; noteRequired: boolean }
  | { kind: "mark"; markId: string }
  | { kind: "delete" | "restore"; lesionId: string }
  | { kind: "add" };
const CHOOSE = "__choose";
const DISMISS = "";

interface ReviewCommandModalProps {
  target: ReviewDialog;
  workspace: ReviewWorkspace;
  actions: ReturnType<typeof useReviewActions>;
  onClose: () => void;
}
export function ReviewCommandModal({ target, workspace, actions, onClose }: ReviewCommandModalProps) {
  const [base, setBase] = useState(workspace);
  const [note, setNote] = useState("");
  const sourceMark = workspace.marks.find(
    (mark) => target.kind === "mark" && mark.source.id === target.markId,
  );
  const [markTarget, setMarkTarget] = useState<string | null>(() => {
    if (sourceMark === undefined) return null;
    if (sourceMark.status === "assigned") return sourceMark.lesionId;
    if (sourceMark.status === "dismissed") return DISMISS;

    return null;
  });
  const [newId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const pending = actions.mutation.isPending;
  const changedRevision = base.revision !== workspace.revision;
  const currentDecisionField = reviewRecordFields(workspace.record, workspace.lesionIds).find(
    (field) =>
      target.kind === "decision" &&
      reviewFieldKey(field.reference) === reviewFieldKey(target.field.reference),
  );
  let decisionValue = currentDecisionField?.value ?? null;
  if (target.kind === "decision" && !changedRevision) {
    const bound = reviewRecordFields(base.record, base.lesionIds).find(
      (field) => reviewFieldKey(field.reference) === reviewFieldKey(target.field.reference),
    );
    decisionValue = bound?.value ?? null;
  }
  let decisionLabel = "Kontrolovaná hodnota: ";
  if (target.kind === "decision" && target.field.definition === null)
    decisionLabel = "Kontrolovaný počet ložisek: ";
  let title = "Přidat ložisko";
  if (target.kind === "decision") title = `Rozhodnutí: ${target.field.definition?.label ?? "Počet ložisek"}`;
  if (target.kind === "mark")
    title = `${formatMarkLabel(workspace.marks.findIndex((mark) => mark.source.id === target.markId))} · přiřazení`;
  if (target.kind === "delete") title = "Odebrat ložisko";
  if (target.kind === "restore") title = "Obnovit původní ložisko";
  const submit = async () => {
    if (workspace.readOnly || changedRevision) return;
    try {
      if (target.kind === "decision")
        await actions.run(
          { kind: "decideField", reference: target.field.reference, note: note.trim() || null },
          base,
        );
      if (target.kind === "mark") {
        if (markTarget === null) return;
        if (markTarget === DISMISS)
          await actions.run({ kind: "dismissMark", markId: target.markId, note }, base);
        else
          await actions.run({ kind: "assignMark", markId: target.markId, lesionId: markTarget, note }, base);
      }
      if (target.kind === "add")
        await actions.run(
          {
            kind: "save",
            operations: [{ kind: "add_lesion", lesionId: newId, lesion: emptyReviewLesion() }],
          },
          base,
        );
      if (target.kind === "delete" || target.kind === "restore")
        await actions.run(
          {
            kind: "save",
            operations: [
              {
                kind: target.kind === "delete" ? "delete_lesion" : "restore_lesion",
                lesionId: target.lesionId,
              },
            ],
          },
          base,
        );
      onClose();
    } catch (error_) {
      setError(reviewErrorMessage(error_));
    }
  };
  let noteRequired = false;
  if (target.kind === "decision")
    noteRequired =
      workspace.workflowStatus.fields.find(
        (field) => reviewFieldKey(field.reference) === reviewFieldKey(target.field.reference),
      )?.noteRequired ?? target.noteRequired;
  if (target.kind === "mark") noteRequired = true;
  const markUnchosen = target.kind === "mark" && markTarget === null;

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      dismissible={false}
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Zrušit
          </Button>
          <Button
            tone="primary"
            loading={pending}
            disabled={
              pending ||
              workspace.readOnly ||
              changedRevision ||
              markUnchosen ||
              (noteRequired && note.trim() === "")
            }
            onClick={() => void submit()}
          >
            Potvrdit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {workspace.readOnly && (
          <p role="alert" className="text-warning">
            Kontrola už není otevřená pro úpravy. Váš vstup zůstal zachován, ale nelze jej uložit.
          </p>
        )}
        {target.kind === "decision" && (
          <p>
            {decisionLabel}
            {formatMappingValue(decisionValue, target.field.definition?.metadata.choices)}. Rozhodnutí
            potvrzuje vaši kontrolu; původní jistota modelu se nemění.
          </p>
        )}
        {target.kind === "mark" && (
          <>
            <p>
              Strana {sourceMark?.source.page}; oblasti {formatMappingValue(sourceMark?.source.regions)}.
              Změna přiřazení může změnit oblasti ložisek a znovu otevřít jejich potvrzení.
            </p>
            <Select
              label="Přiřazení značky"
              value={markTarget ?? CHOOSE}
              disabled={pending}
              onChange={(event) => setMarkTarget(event.target.value === CHOOSE ? null : event.target.value)}
            >
              <option value={CHOOSE} disabled>
                Vyberte přiřazení…
              </option>
              {workspace.lesionIds.map((id, index) => (
                <option key={id} value={id}>
                  Ložisko {index + 1}
                </option>
              ))}
              <option value={DISMISS}>Odmítnout značku</option>
            </Select>
          </>
        )}
        {(target.kind === "decision" || target.kind === "mark") && (
          <Textarea
            label={noteRequired ? "Odůvodnění (povinné)" : "Poznámka (volitelná)"}
            value={note}
            maxLength={2000}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
        {target.kind === "delete" && (
          <p>
            Ložisko bude odebráno. Dotčená rozhodnutí a potvrzení se znovu otevřou. Původní ložisko lze
            později obnovit.
          </p>
        )}
        {target.kind === "restore" && (
          <p>
            Obnoví se původní hodnoty a identita ložiska. Dřívější potvrzení ani přiřazení značek se
            automaticky neobnoví.
          </p>
        )}
        {target.kind === "add" && (
          <p>Vznikne prázdné ložisko. Doplňte jeho údaje a znovu potvrďte úplnost souboru ložisek.</p>
        )}
        {changedRevision && (
          <div role="alert" className="rounded-box bg-warning/10 p-3">
            <p>
              Revize se změnila z {base.revision} na {workspace.revision}. Zavřete dialog a porovnejte
              aktuální záznam před opakováním akce. Vstup zůstal zachován.
            </p>
            {target.kind === "decision" && (
              <p>
                Při otevření:{" "}
                {formatMappingValue(target.field.value, target.field.definition?.metadata.choices)}. Nyní na
                serveru:{" "}
                {formatMappingValue(
                  currentDecisionField?.value ?? null,
                  target.field.definition?.metadata.choices,
                )}
                .
              </p>
            )}
            <Button
              disabled={pending || (target.kind === "decision" && currentDecisionField === undefined)}
              size="sm"
              className="mt-2"
              onClick={() => {
                setBase(workspace);
                setError(null);
              }}
            >
              Zkontroloval/a jsem aktuální stav; použít na novou revizi
            </Button>
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
