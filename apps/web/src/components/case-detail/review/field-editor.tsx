import { useId, useState } from "react";

import {
  type ReviewFieldValue,
  type ReviewOperation,
  reviewValidationIssues,
  reviewValueKey,
  type ReviewWorkspace,
} from "@prostapaper/contracts";

import { formatMappingValue } from "#lib/mapping-format";
import type { MappingFieldView } from "#lib/mapping-review";
import { editorOperation, fieldValueOf } from "#lib/review-edit";
import { reviewErrorMessage } from "#lib/review-errors";
import { Button, Checkbox, Input, Modal, Select, Textarea } from "#ui";

function choiceOptionLabel(code: string, choices: readonly { code: string; label: string }[]): string {
  const label = formatMappingValue(code, choices);
  if (label === code) return label;

  return `${code} · ${label}`;
}

function inputMode(validation: string): "decimal" | undefined {
  if (validation === "integer" || validation === "number") return "decimal";

  return undefined;
}

interface FieldEditorProps {
  field: MappingFieldView;
  original: MappingFieldView | undefined;
  workspace: ReviewWorkspace;
  pending: boolean;
  onSave: (operations: ReviewOperation[], base: ReviewWorkspace) => Promise<void>;
  onClose: () => void;
}
export function FieldEditor({ field, original, workspace, pending, onSave, onClose }: FieldEditorProps) {
  const [base, setBase] = useState(workspace);
  const [value, setValue] = useState<ReviewFieldValue>(field.value);
  const [clearNodes, setClearNodes] = useState(false);
  const [dateIncomplete, setDateIncomplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const definition = field.definition;
  if (definition === null) return null;
  const metadata = definition.metadata;
  const reference = field.reference;
  const changedRevision = base.revision !== workspace.revision;
  const baseValue = fieldValueOf(base.record, base.lesionIds, reference) ?? null;
  const currentValue = fieldValueOf(workspace.record, workspace.lesionIds, reference) ?? null;
  const nodesPresent =
    base.record.surgery.node_no_surgery !== null || base.record.surgery.node_positive_no_surgery !== null;
  const clearingNodes = definition.name === "lymphadenectomy" && value !== "1" && nodesPresent && clearNodes;
  let operation: ReviewOperation | null = null;
  let inputError: string | null = null;
  if (dateIncomplete) inputError = "Doplňte celé datum nebo pole vymažte.";
  else
    try {
      operation = editorOperation({ reference, validation: metadata.validation, value, clearNodes });
    } catch (error_) {
      inputError = reviewErrorMessage(error_);
    }
  let describedBy: string | undefined;
  if (inputError !== null) describedBy = errorId;
  let parsedValue: ReviewFieldValue = value;
  if (operation?.kind === "update_surgery" && reference.scope === "surgery")
    parsedValue = operation.changes[reference.field] ?? null;
  if (operation?.kind === "update_lesion" && reference.scope === "lesion")
    parsedValue = operation.changes[reference.field] ?? null;
  const unchanged =
    operation !== null &&
    reviewValueKey(definition.name, parsedValue) === reviewValueKey(definition.name, baseValue);
  const preview = structuredClone(base.record);
  if (operation?.kind === "update_surgery") Object.assign(preview.surgery, operation.changes);
  if (operation?.kind === "update_lesion") {
    const lesion = preview.lesions[base.lesionIds.indexOf(operation.lesionId)];
    if (lesion !== undefined && definition.name !== "all_sgm" && definition.name !== "sur_prostate_regions")
      Object.assign(lesion, operation.changes);
  }
  const previewIssues = reviewValidationIssues(preview, base.lesionIds);
  const save = async () => {
    if (operation === null || workspace.readOnly || changedRevision) return;
    try {
      await onSave([operation], base);
      onClose();
    } catch (error_) {
      setError(reviewErrorMessage(error_));
    }
  };
  const clear = () => {
    setDateIncomplete(false);
    if (definition.name === "all_sgm") setValue(false);
    else if (definition.name === "sur_prostate_regions") setValue([]);
    else setValue(null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={false}
      title={`Upravit: ${definition.label}`}
      size="lg"
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Zahodit a zavřít
          </Button>
          <Button
            tone="primary"
            loading={pending}
            disabled={
              pending ||
              changedRevision ||
              inputError !== null ||
              workspace.readOnly ||
              (unchanged && !clearingNodes)
            }
            onClick={() => void save()}
          >
            Uložit hodnotu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {workspace.readOnly && (
          <p role="alert" className="text-sm text-warning">
            Kontrola už není otevřená pro úpravy. Váš vstup zůstal zachován, ale nelze jej uložit.
          </p>
        )}
        <p className="text-sm">
          Ukládáte revizi {base.revision}. Původní návrh:{" "}
          {formatMappingValue(original?.value ?? null, metadata.choices)}
        </p>
        {definition.name === "sur_prostate_regions" && (
          <fieldset className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            <legend className="mb-2 font-medium">Oblasti prostaty</legend>
            {metadata.choices.map((choice) => (
              <Checkbox
                key={choice.code}
                label={formatMappingValue(choice.code, metadata.choices)}
                disabled={pending}
                checked={Array.isArray(value) && value.includes(choice.code)}
                onChange={(event) => {
                  let selected: string[] = [];
                  if (Array.isArray(value)) selected = value;
                  if (event.target.checked) setValue([...selected, choice.code]);
                  else setValue(selected.filter((item) => item !== choice.code));
                }}
              />
            ))}
          </fieldset>
        )}
        {definition.name === "all_sgm" && (
          <Checkbox
            label="Postiženy všechny segmenty"
            checked={value === true}
            disabled={pending}
            onChange={(event) => setValue(event.target.checked)}
          />
        )}
        {metadata.choices.length > 0 &&
          definition.name !== "sur_prostate_regions" &&
          definition.name !== "all_sgm" && (
            <Select
              label={definition.label}
              disabled={pending}
              value={String(value ?? "")}
              onChange={(event) => setValue(event.target.value || null)}
            >
              <option value="">Neuvedeno / neznámé</option>
              {metadata.choices.map((choice) => (
                <option key={choice.code} value={choice.code}>
                  {choiceOptionLabel(choice.code, metadata.choices)}
                </option>
              ))}
            </Select>
          )}
        {metadata.choices.length === 0 && metadata.type === "notes" && (
          <Textarea
            label={definition.label}
            rows={8}
            disabled={pending}
            value={String(value ?? "")}
            onChange={(event) => setValue(event.target.value || null)}
          />
        )}
        {metadata.choices.length === 0 && metadata.type !== "notes" && metadata.validation === "date_dmy" && (
          <Input
            label={definition.label}
            type="date"
            aria-invalid={inputError !== null}
            aria-describedby={describedBy}
            disabled={pending}
            value={String(value ?? "")}
            onChange={(event) => {
              setDateIncomplete(event.target.validity.badInput);
              if (!event.target.validity.badInput) setValue(event.target.value || null);
            }}
          />
        )}
        {metadata.choices.length === 0 && metadata.type !== "notes" && metadata.validation !== "date_dmy" && (
          <Input
            label={definition.label}
            type="text"
            inputMode={inputMode(metadata.validation)}
            aria-invalid={inputError !== null}
            aria-describedby={describedBy}
            disabled={pending}
            value={String(value ?? "")}
            onChange={(event) => setValue(event.target.value || null)}
          />
        )}
        {definition.name === "lymphadenectomy" && value !== "1" && nodesPresent && (
          <Checkbox
            label={`Současně vymazat závislé počty uzlin (vyšetřené: ${formatMappingValue(base.record.surgery.node_no_surgery)}, pozitivní: ${formatMappingValue(base.record.surgery.node_positive_no_surgery)})`}
            checked={clearNodes}
            disabled={pending}
            onChange={(event) => setClearNodes(event.target.checked)}
          />
        )}
        {inputError !== null && (
          <p id={errorId} role="alert" className="text-sm text-error">
            {inputError}
          </p>
        )}
        {previewIssues.length > 0 && (
          <div className="text-sm">
            <p>Chyby v rozepsaném záznamu (návrh lze uložit; schválení vyžaduje opravu):</p>
            <ul className="list-disc pl-5">
              {previewIssues.map((issue, index) => (
                <li key={JSON.stringify([issue.reference, issue.code, index])}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={clear}>
            {definition.name === "all_sgm" ? "Zrušit příznak všech segmentů" : "Vymazat / neuvedeno"}
          </Button>
          {original !== undefined && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setDateIncomplete(false);
                setValue(original.value);
              }}
            >
              Obnovit původní návrh
            </Button>
          )}
        </div>
        {definition.name === "all_sgm" && (
          <p className="text-sm">
            Zaškrtnutí nastaví celý soubor oblastí; odebrání jednotlivé oblasti příznak zruší.
          </p>
        )}
        {changedRevision && (
          <div role="alert" className="rounded-box bg-warning/10 p-3 text-sm">
            <p>Na serveru je novější revize {workspace.revision}. Váš vstup zůstal zachován.</p>
            <p>Hodnota při otevření: {formatMappingValue(baseValue, metadata.choices)}</p>
            <p>Aktuálně na serveru: {formatMappingValue(currentValue, metadata.choices)}</p>
            <Button
              className="mt-2"
              size="sm"
              disabled={pending}
              onClick={() => {
                setBase(workspace);
                setError(null);
              }}
            >
              Použít můj vstup na aktuální revizi
            </Button>
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <p className="text-xs text-base-content/70">
          {unchanged && !clearingNodes
            ? "Hodnota se nezměnila; není co uložit."
            : "Neuložená změna. Po uložení bude potřeba odůvodnit opravu a znovu potvrdit dotčené sekce."}
        </p>
      </div>
    </Modal>
  );
}
