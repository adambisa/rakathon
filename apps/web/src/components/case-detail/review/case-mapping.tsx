import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  lesionsFromRecord,
  reviewFieldKey,
  type ReviewFieldRef,
  reviewSectionKey,
  type ReviewSectionState,
  type ReviewWorkspace,
} from "@prostapaper/contracts";

import { FieldEditor } from "#components/case-detail/review/field-editor";
import { MappingEvidence } from "#components/case-detail/review/mapping-evidence-modal";
import { ReviewCommandModal, type ReviewDialog } from "#components/case-detail/review/review-command-modal";
import { ReviewNote } from "#components/case-detail/review/review-note";
import { useReviewActions } from "#components/case-detail/review/use-review-actions";
import { cx } from "#lib/cx";
import { errorMessage } from "#lib/error-message";
import { formatMappingValue, formatMarkLabel, formatRegion, mappingFieldRowId } from "#lib/mapping-format";
import { type MappingAttentionItem, type MappingFieldView, mappingFieldViews } from "#lib/mapping-review";
import { reviewAttention } from "#lib/review-attention";
import { fieldChanged } from "#lib/review-edit";
import { reviewErrorMessage } from "#lib/review-errors";
import { useSession } from "#lib/use-session";
import { useTRPC } from "#trpc";
import { Badge, Button, ButtonAnchor, Card, Icon, SectorDiagram, Skeleton } from "#ui";

const MARKS_HEADING_ID = "review-marks";

export interface CaseMappingProps {
  caseId: string;
  sidebar?: ReactNode;
}
export function CaseMapping({ caseId, sidebar }: CaseMappingProps) {
  const trpc = useTRPC();
  const result = useQuery(trpc.case.review.get.queryOptions({ caseId }, { staleTime: 0 }));
  if (result.error !== null && result.data === undefined)
    return (
      <MappingCard>
        <p role="alert">{errorMessage(result.error)}</p>
        <Button size="sm" onClick={() => void result.refetch()}>
          Zkusit znovu
        </Button>
      </MappingCard>
    );
  if (result.data === undefined)
    return (
      <MappingCard>
        <Skeleton className="h-96 w-full" />
      </MappingCard>
    );

  const workspace = result.data;

  return (
    <>
      {result.error !== null && (
        <p role="alert" className="text-sm text-error">
          {errorMessage(result.error)}{" "}
          <Button size="sm" onClick={() => void result.refetch()}>
            Obnovit stav
          </Button>
        </p>
      )}
      <LoadedMapping key={caseId} caseId={caseId} workspace={workspace} sidebar={sidebar} />
    </>
  );
}

interface LoadedMappingProps {
  caseId: string;
  workspace: ReviewWorkspace;
  sidebar: ReactNode;
}
function LoadedMapping({ caseId, workspace, sidebar }: LoadedMappingProps) {
  const { session } = useSession();
  const [selectedRef, setSelectedRef] = useState<ReviewFieldRef | null>(null);
  const [editing, setEditing] = useState<MappingFieldView | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [dialog, setDialog] = useState<ReviewDialog | null>(null);
  const actions = useReviewActions(caseId, workspace);
  const fields = mappingFieldViews(workspace.record, workspace.evidence, workspace.lesionIds).filter(
    (field) => field.reference.scope !== "surgery",
  );
  const originalIds = workspace.proposalLesionIds;
  const originalFields = mappingFieldViews(workspace.proposal.record, workspace.evidence, originalIds).filter(
    (field) => field.reference.scope !== "surgery",
  );
  const originalByKey = new Map(originalFields.map((field) => [reviewFieldKey(field.reference), field]));
  const requirements = new Map(
    workspace.workflowStatus.fields.map((field) => [reviewFieldKey(field.reference), field]),
  );
  const attention = reviewAttention(workspace, fields);
  const changes = reviewChanges(workspace, fields, originalByKey);
  const editable = !workspace.readOnly;
  const modalOpen = editing !== null || dialog !== null || editingNote;
  const bootstrapping = editable && workspace.revision === 0;
  const busy = actions.mutation.isPending;
  const needsRevision = workspace.revision === 0;
  const bootstrapped = useRef(false);
  const attentionTrigger = useRef<HTMLElement | null>(null);
  // Decisions and confirmations need a saved revision, so the first editable view saves the proposal as is.
  useEffect(() => {
    if (!bootstrapping || bootstrapped.current) return;
    bootstrapped.current = true;
    void actions.run({ kind: "save", operations: [] }).catch(() => {
      /* The mutation error remains visible in the form. */
    });
  }, [actions, bootstrapping]);
  // Dialog triggers are disabled while a dialog is open, so the native dialog cannot return focus to them.
  const focusElement = (id: string) =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus());
  const restoreFocus = (field: MappingFieldView) =>
    focusElement(mappingFieldRowId(field.fieldName, field.lesionIndex));
  const closeDialog = () => {
    if (dialog?.kind === "decision") restoreFocus(dialog.field);
    else if (dialog?.kind === "mark") {
      const trigger = attentionTrigger.current;
      attentionTrigger.current = null;
      if (trigger?.isConnected === true) requestAnimationFrame(() => trigger.focus());
      else focusElement(MARKS_HEADING_ID);
    } else focusElement(mappingFieldRowId("lesions.length"));
    setDialog(null);
  };
  const openEvidence = (fieldName: string, lesionIndex?: number) => {
    const field = fields.find((item) => item.fieldName === fieldName && item.lesionIndex === lesionIndex);
    if (field !== undefined) setSelectedRef(field.reference);
  };
  const openAttention = (item: MappingAttentionItem) => {
    if (item.key.startsWith("mark:") && editable && !busy && !modalOpen && !needsRevision) {
      attentionTrigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDialog({ kind: "mark", markId: item.key.slice(5) });

      return;
    }
    const element = document.querySelector<HTMLElement>(
      `#${CSS.escape(mappingFieldRowId(item.fieldName, item.lesionIndex))}`,
    );
    // Jump to the row; the evidence panel stays one click away on the row's own button.
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  };
  // Shown under the value so a long original list never widens the actions column.
  const rowNote = (field: MappingFieldView) => {
    const original = originalByKey.get(reviewFieldKey(field.reference));
    if (!fieldChanged(field.fieldName, original?.value, field.value)) return null;

    return (
      <span className="block text-xs wrap-anywhere text-base-content/60">
        Původní návrh: {formatMappingValue(original?.value ?? null, field.definition?.metadata.choices)}
      </span>
    );
  };
  const rowActions = (field: MappingFieldView) => {
    const requirement = requirements.get(reviewFieldKey(field.reference));

    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
        {!editable && requirement?.resolved === true && (
          <Badge size="xs" tone="success" variant="soft" icon="check">
            Zkontrolováno
          </Badge>
        )}
        {requirement?.decisionRequired === true && !requirement.resolved && (
          <Badge size="xs" tone="warning" variant="soft">
            K ověření
          </Badge>
        )}
        {editable && (
          <>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || modalOpen}
              aria-label={`Upravit: ${field.definition?.label ?? "hodnota"}`}
              onClick={() => setEditing(field)}
            >
              <Icon name="pencil" size="xs" />
              Upravit
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy || modalOpen || needsRevision}
              aria-label={`Zkontrolovat: ${field.definition?.label ?? "hodnota"}`}
              onClick={() =>
                setDialog({ kind: "decision", field, noteRequired: requirement?.noteRequired ?? false })
              }
            >
              {requirement?.resolved === true ? "Zkontrolováno" : "Zkontrolovat"}
            </Button>
          </>
        )}
      </div>
    );
  };
  const collectionField = fields.find((field) => field.reference.scope === "collection");
  const firstUnresolvedField = (section: ReviewSectionState) =>
    fields.find((field) => {
      const requirement = requirements.get(reviewFieldKey(field.reference));
      if (requirement?.decisionRequired !== true || requirement.resolved) return false;
      const ref = field.reference;
      if (section.reference.scope === "lesion")
        return ref.scope === "lesion" && ref.lesionId === section.reference.lesionId;

      return ref.scope === "collection";
    });
  const jumpToField = (field: MappingFieldView) => {
    const element = document.querySelector<HTMLElement>(
      `#${CSS.escape(mappingFieldRowId(field.fieldName, field.lesionIndex))}`,
    );
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  };
  const sectionControl = (section: ReviewSectionState) => {
    const open = section.blockingIssueCount + section.unresolvedFieldCount + section.unresolvedMarkCount;
    const ready = !section.confirmed && open === 0;
    let nextField: MappingFieldView | undefined;
    if (!section.confirmed) nextField = firstUnresolvedField(section);
    let blockedHint: string | undefined;
    if (!ready && !section.confirmed) blockedHint = "Nejprve vyřešte položky uvedené vlevo.";
    const hint = [
      section.blockingIssueCount > 0 ? `Chyby: ${section.blockingIssueCount}` : null,
      section.unresolvedFieldCount > 0 ? `K ověření: ${section.unresolvedFieldCount}` : null,
      section.unresolvedMarkCount > 0 ? `Značky k přiřazení: ${section.unresolvedMarkCount}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <SectionStatus confirmed={section.confirmed} />
          {!section.confirmed && open > 0 && nextField !== undefined && (
            <Button size="xs" variant="ghost" onClick={() => jumpToField(nextField)}>
              {hint}
              <Icon name="chevronDown" size="xs" />
            </Button>
          )}
          {!section.confirmed && open > 0 && nextField === undefined && (
            <span className="text-base-content/70">{hint}</span>
          )}
        </div>
        {editable && (
          <Button
            size="md"
            tone={ready ? "primary" : "secondary"}
            variant={ready ? "solid" : "outline"}
            tooltip={blockedHint}
            disabled={busy || modalOpen || needsRevision || (!section.confirmed && open > 0)}
            onClick={() =>
              void actions
                .run({
                  kind: section.confirmed ? "revokeSection" : "confirmSection",
                  reference: section.reference,
                })
                .catch(() => {
                  /* The mutation error remains visible in the form. */
                })
            }
          >
            {ready && <Icon name="check" size="xs" />}
            {section.confirmed ? "Znovu otevřít sekci" : "Potvrdit sekci"}
          </Button>
        )}
      </div>
    );
  };
  const sections = workspace.workflowStatus.sections.filter(
    (section) => section.reference.scope !== "surgery",
  );
  const collection = sections.find((section) => section.reference.scope === "collection");
  const confirmedCount = sections.filter((section) => section.confirmed).length;
  const allConfirmed = confirmedCount === sections.length;
  const nextOpenIndex = sections.findIndex((section) => !section.confirmed);

  return (
    <MappingCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
          <Icon name="microscope" size="md" className="text-base-content/60" />
          Kontrola ložisek
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/70">
          <Badge size="sm" variant="outline">
            Revize {workspace.revision}
          </Badge>
          {workspace.approvedRevision !== null && (
            <Badge size="sm" tone="success" variant="soft" icon="check">
              Schválena revize {workspace.approvedRevision}
            </Badge>
          )}
          {workspace.readOnly && (
            <Badge size="sm" variant="soft">
              Pouze pro čtení
            </Badge>
          )}
        </div>
      </div>
      <MappingEvidence
        review={workspace.evidence}
        fields={fields}
        originalFields={originalFields}
        workflow={workspace.workflow}
        requirements={workspace.workflowStatus.fields}
        currentUserId={session?.user.id ?? null}
        attention={attention}
        selected={selectedRef}
        onSelectAttention={openAttention}
        markIds={workspace.marks.map((mark) => mark.source.id)}
        onClose={() => setSelectedRef(null)}
      />
      <nav
        aria-label="Sekce kontroly"
        className="sticky top-0 z-10 my-3 flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-100 py-3"
      >
        {sections.map((section, index) => (
          <ButtonAnchor
            key={reviewSectionKey(section.reference)}
            size="xs"
            variant="outline"
            tone={sectionTone(section)}
            href={`#review-section-${index}`}
          >
            {section.confirmed && <Icon name="check" size="xs" label="Potvrzeno" />}
            {sectionLabel(section, workspace)}
          </ButtonAnchor>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-base-content/70">
          <span>
            Potvrzeno {confirmedCount} z {sections.length}
          </span>
          {editable && nextOpenIndex !== -1 && (
            <ButtonAnchor size="xs" variant="ghost" href={`#review-section-${nextOpenIndex}`}>
              Další otevřená
              <Icon name="chevronDown" size="xs" />
            </ButtonAnchor>
          )}
        </div>
      </nav>
      {bootstrapping && actions.mutation.isPending && (
        <p role="status" className="my-3 text-sm text-base-content/70">
          Zakládá se pracovní revize kontroly…
        </p>
      )}
      {actions.mutation.error !== null && (
        <div role="alert" className="my-3 space-y-2 text-sm text-error">
          <p>{reviewErrorMessage(actions.mutation.error)}</p>
          {bootstrapping && (
            <>
              <p>
                Pracovní revize zatím nebyla založena. Zkuste to znovu; případné neplatné hodnoty opravte
                tlačítkem Upravit. Uložení zpřístupní rozhodnutí a potvrzení.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || modalOpen}
                onClick={() =>
                  void actions.run({ kind: "save", operations: [] }).catch(() => {
                    /* The mutation error remains visible in the form. */
                  })
                }
              >
                Zkusit založit revizi znovu
              </Button>
            </>
          )}
        </div>
      )}
      {/* Keep the review first on narrow screens; supporting documents follow it. */}
      <div className="@container/mapping">
        <div className="grid items-start gap-6 @4xl/mapping:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <section
              id={`review-section-${sections.findIndex((section) => section.reference.scope === "collection")}`}
              className={sectionClass(collection?.confirmed === true)}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3
                  id={mappingFieldRowId("lesions.length")}
                  tabIndex={-1}
                  className="flex flex-wrap items-center gap-2 font-semibold"
                >
                  <span>Počet ložisek: {workspace.record.lesions.length}</span>
                  <EvidenceButton
                    fieldName="lesions.length"
                    label="Počet ložisek"
                    onClick={() => openEvidence("lesions.length")}
                  />
                  {editable &&
                    collectionField !== undefined &&
                    requirements.get(reviewFieldKey(collectionField.reference))?.resolved !== true && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy || modalOpen || needsRevision}
                        onClick={() =>
                          setDialog({
                            kind: "decision",
                            field: collectionField,
                            noteRequired:
                              requirements.get(reviewFieldKey(collectionField.reference))?.noteRequired ??
                              false,
                          })
                        }
                      >
                        Zkontrolovat počet
                      </Button>
                    )}
                </h3>
                {collection !== undefined && sectionControl(collection)}
              </div>
              <p className="text-sm">
                Potvrďte počet a úplnost všech ložisek, včetně případného nulového počtu.
              </p>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || modalOpen || workspace.lesionIds.length >= 100}
                    onClick={() => setDialog({ kind: "add" })}
                  >
                    <Icon name="plus" size="xs" />
                    Přidat ložisko
                  </Button>
                  {originalIds
                    .filter((id) => !workspace.lesionIds.includes(id))
                    .map((id) => (
                      <Button
                        key={id}
                        size="sm"
                        variant="outline"
                        disabled={busy || modalOpen}
                        onClick={() => setDialog({ kind: "restore", lesionId: id })}
                      >
                        Obnovit původní ložisko {originalIds.indexOf(id) + 1}
                      </Button>
                    ))}
                </div>
              )}
            </section>
            {workspace.lesionIds.map((id, index) => {
              const section = sections.find(
                (item) => item.reference.scope === "lesion" && item.reference.lesionId === id,
              );

              return (
                <section
                  key={id}
                  id={`review-section-${sections.findIndex((item) => item.reference.scope === "lesion" && item.reference.lesionId === id)}`}
                  className={sectionClass(section?.confirmed === true)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">Ložisko {index + 1}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {editable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || modalOpen}
                          onClick={() => setDialog({ kind: "delete", lesionId: id })}
                        >
                          Odebrat ložisko {index + 1}
                        </Button>
                      )}
                      {section !== undefined && sectionControl(section)}
                    </div>
                  </div>
                  <RecordFields
                    fields={fields}
                    lesionIndex={index}
                    onEvidence={openEvidence}
                    rowNote={rowNote}
                    rowActions={rowActions}
                  />
                </section>
              );
            })}
            {workspace.marks.length > 0 && (
              <section className="space-y-3">
                <h3 id={MARKS_HEADING_ID} tabIndex={-1} className="font-semibold">
                  Značky ve schématu
                </h3>
                <p className="text-sm text-base-content/70">
                  Přiřaďte značky ze schématu k ložiskům. Podrobnosti zdroje zůstávají dostupné u každé
                  značky.
                </p>
                <div className="grid gap-3 @2xl/mapping:grid-cols-2">
                  {workspace.marks.map((mark, index) => (
                    <article
                      key={mark.source.id}
                      className="flex flex-col rounded-box border border-base-300 p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-semibold">{formatMarkLabel(index)}</h4>
                        <MarkStatus
                          status={mark.status}
                          index={workspace.lesionIds.indexOf(mark.lesionId ?? "")}
                        />
                      </div>
                      <p className="mt-2 text-sm">
                        {mark.source.regions.map(formatRegion).join(" · ") || "Oblast neurčena"}
                      </p>
                      <p className="mt-1 text-xs wrap-anywhere text-base-content/70">
                        {workspace.evidence?.sources.find(
                          (source) => source.documentId === mark.source.documentId,
                        )?.filename ?? "Schéma"}{" "}
                        · strana {mark.source.page}
                      </p>
                      <details className="mt-2 text-xs text-base-content/70">
                        <summary className="review-disclosure">
                          <Icon name="chevronDown" size="sm" />
                          <span>Technické údaje</span>
                        </summary>
                        <p className="mt-2 wrap-anywhere">{mark.source.id}</p>
                      </details>
                      {mark.note !== null && <p className="mt-1">Odůvodnění: {mark.note}</p>}
                      {editable && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-auto self-start"
                          disabled={busy || modalOpen || needsRevision}
                          onClick={() => setDialog({ kind: "mark", markId: mark.source.id })}
                        >
                          {mark.status === "assigned" || mark.status === "dismissed"
                            ? "Změnit přiřazení"
                            : "Přiřadit značku"}
                        </Button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
            {editable && (
              <div className="flex justify-end border-t border-base-300 pt-4">
                <Button
                  tone="primary"
                  tooltip={
                    approveHint(allConfirmed, workspace.issues.length) ??
                    "Uzamkne tuto revizi pro závěrečnou kontrolu a export."
                  }
                  disabled={
                    busy || modalOpen || needsRevision || !allConfirmed || workspace.issues.length > 0
                  }
                  loading={actions.mutation.isPending && actions.mutation.variables.action.kind === "approve"}
                  onClick={() =>
                    void actions.run({ kind: "approve" }).catch(() => {
                      /* The mutation error remains visible in the form. */
                    })
                  }
                >
                  Schválit revizi {workspace.revision}
                </Button>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-4 @4xl/mapping:sticky @4xl/mapping:top-20">
            {sidebar}
            <ReviewNote
              workspace={workspace}
              editable={editable}
              open={editingNote}
              disabled={busy || editing !== null || dialog !== null}
              pending={busy}
              onOpen={() => setEditingNote(true)}
              onClose={() => setEditingNote(false)}
              onSave={async (note, base) => actions.run({ kind: "save", operations: [], note }, base)}
            />
            <ReviewChanges changes={changes} />
            <SectorDiagram lesions={lesionsFromRecord(workspace.record)} />
          </div>
        </div>
      </div>
      {editing !== null && (
        <FieldEditor
          key={reviewFieldKey(editing.reference)}
          field={editing}
          original={originalByKey.get(reviewFieldKey(editing.reference))}
          workspace={workspace}
          pending={busy}
          onSave={async (operations, base) => actions.run({ kind: "save", operations }, base)}
          onClose={() => {
            restoreFocus(editing);
            setEditing(null);
          }}
        />
      )}
      {dialog !== null && (
        <ReviewCommandModal target={dialog} workspace={workspace} actions={actions} onClose={closeDialog} />
      )}
    </MappingCard>
  );
}
function approveHint(allConfirmed: boolean, issueCount: number): string | undefined {
  if (issueCount > 0) return "Nejprve opravte chyby validace.";
  if (!allConfirmed) return "Nejprve potvrďte všechny sekce.";

  return undefined;
}
function sectionLabel(section: ReviewSectionState, workspace: ReviewWorkspace): string {
  const ref = section.reference;
  if (ref.scope === "lesion") return `Ložisko ${workspace.lesionIds.indexOf(ref.lesionId) + 1}`;

  return "Úplnost ložisek";
}

function sectionClass(confirmed: boolean): string {
  return cx(
    "scroll-mt-24 space-y-4 rounded-box border p-4",
    confirmed ? "border-success/40 bg-success/5" : "border-base-300",
  );
}

function sectionTone(section: ReviewSectionState): "success" | undefined {
  if (section.confirmed) return "success";

  return undefined;
}

interface SectionStatusProps {
  confirmed: boolean;
}
function SectionStatus({ confirmed }: SectionStatusProps) {
  if (confirmed)
    return (
      <Badge size="sm" tone="success" variant="soft" icon="check">
        Potvrzeno
      </Badge>
    );

  return (
    <Badge size="sm" variant="outline">
      Čeká na potvrzení
    </Badge>
  );
}

interface ReviewChange {
  key: string;
  label: string;
  before: string;
  after: string;
}
function reviewChanges(
  workspace: ReviewWorkspace,
  fields: MappingFieldView[],
  originalByKey: Map<string, MappingFieldView>,
): ReviewChange[] {
  const changes: ReviewChange[] = [];
  for (const field of fields) {
    if (field.definition === null) continue;
    const original = originalByKey.get(reviewFieldKey(field.reference));
    if (original === undefined) continue;
    if (!fieldChanged(field.fieldName, original.value, field.value)) continue;
    let label = field.definition.label;
    if (field.lesionIndex !== undefined) label = `Ložisko ${field.lesionIndex + 1} · ${label}`;
    changes.push({
      key: reviewFieldKey(field.reference),
      label,
      before: formatMappingValue(original.value, field.definition.metadata.choices),
      after: formatMappingValue(field.value, field.definition.metadata.choices),
    });
  }
  for (const [index, id] of workspace.proposalLesionIds.entries()) {
    if (workspace.lesionIds.includes(id)) continue;
    changes.push({
      key: `removed:${id}`,
      label: `Původní ložisko ${index + 1}`,
      before: "v návrhu",
      after: "odebráno",
    });
  }
  for (const [index, id] of workspace.lesionIds.entries()) {
    if (workspace.proposalLesionIds.includes(id)) continue;
    changes.push({ key: `added:${id}`, label: `Ložisko ${index + 1}`, before: "—", after: "přidáno" });
  }

  return changes;
}

interface ReviewChangesProps {
  changes: ReviewChange[];
}
function ReviewChanges({ changes }: ReviewChangesProps) {
  return (
    <details className="rounded-box border border-base-300 p-4 text-sm">
      <summary className="review-disclosure font-medium">
        <Icon name="chevronDown" size="sm" />
        <span>
          Změny oproti návrhu <span className="ml-1 text-base-content/60">({changes.length})</span>
        </span>
      </summary>
      {changes.length === 0 && (
        <p className="mt-3 text-base-content/70">Záznam zatím odpovídá návrhu modelu.</p>
      )}
      {changes.length > 0 && (
        <ul className="mt-3 grid max-h-80 gap-3 overflow-y-auto">
          {changes.map((change) => (
            <li key={change.key} className="min-w-0">
              <p className="font-medium">{change.label}</p>
              <p className="wrap-anywhere text-base-content/70">
                <s>{change.before}</s>
              </p>
              <p className="wrap-anywhere">{change.after}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-base-content/70">
        Jistota a podklady patří k původnímu návrhu modelu. Lidská kontrola je zaznamenána samostatně.
      </p>
    </details>
  );
}

interface MappingCardProps {
  children: ReactNode;
}

function MappingCard({ children }: MappingCardProps) {
  return (
    <Card className="review-workspace min-w-0" variant="border">
      {children}
    </Card>
  );
}

interface RecordFieldsProps {
  fields: MappingFieldView[];
  lesionIndex?: number;
  onEvidence: (fieldName: string, lesionIndex?: number) => void;
  rowNote?: (field: MappingFieldView) => ReactNode;
  rowActions?: (field: MappingFieldView) => ReactNode;
}

function RecordFields({
  fields: fieldViews,
  lesionIndex,
  onEvidence,
  rowNote,
  rowActions,
}: RecordFieldsProps) {
  const fields = fieldViews.filter(
    (field) => field.reference.scope !== "collection" && field.lesionIndex === lesionIndex,
  );

  return (
    <dl className="divide-y divide-base-300 text-sm">
      {fields.map((fieldView) => {
        const field = fieldView.definition;
        if (field === null) return null;
        const display = formatMappingValue(fieldView.value, field.metadata.choices);

        return (
          <div
            key={field.name}
            className="grid gap-2 py-3 first:pt-0 last:pb-0 @2xl/mapping:grid-cols-[minmax(0,1fr)_fit-content(50%)] @2xl/mapping:gap-x-4"
          >
            <dt
              id={mappingFieldRowId(field.name, lesionIndex)}
              tabIndex={-1}
              className="flex scroll-mt-24 items-center gap-2 rounded-field font-medium text-base-content/80 focus:outline-2 focus:outline-primary"
            >
              {field.label}
              <EvidenceButton
                fieldName={field.name}
                label={field.label}
                onClick={() => onEvidence(field.name, lesionIndex)}
              />
            </dt>
            <dd className="min-w-0 @2xl/mapping:col-start-1">
              <span
                className={
                  display === "Neuvedeno v dokumentech"
                    ? "text-base-content/60"
                    : "font-medium wrap-anywhere whitespace-pre-wrap"
                }
              >
                {display}
              </span>
              {rowNote?.(fieldView)}
            </dd>
            <dd className="min-w-0 @2xl/mapping:col-start-2 @2xl/mapping:row-span-2 @2xl/mapping:row-start-1 @2xl/mapping:self-center">
              {rowActions?.(fieldView)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

interface EvidenceButtonProps {
  fieldName: string;
  label: string;
  onClick: () => void;
}

function EvidenceButton({ fieldName, label, onClick }: EvidenceButtonProps) {
  return (
    <Button
      size="xs"
      variant="ghost"
      shape="circle"
      type="button"
      aria-label={`Původ hodnoty: ${label}`}
      title="Otevřít původ hodnoty"
      className="rounded-full"
      onClick={onClick}
      data-evidence-field={fieldName}
    >
      <Icon name="scrollText" size="xs" />
    </Button>
  );
}

interface MarkStatusProps {
  status: string;
  index: number;
}
function MarkStatus({ status, index }: MarkStatusProps) {
  if (status === "assigned")
    return (
      <Badge size="sm" tone="success" variant="soft" icon="check">
        Ložisko {index + 1}
      </Badge>
    );
  if (status === "dismissed")
    return (
      <Badge size="sm" variant="soft">
        Odmítnuta
      </Badge>
    );

  return (
    <Badge size="sm" tone="warning" variant="soft">
      Vyžaduje přiřazení nebo odmítnutí
    </Badge>
  );
}
