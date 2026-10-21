import { useState } from "react";

import type { ReviewWorkspace } from "@prostapaper/contracts";

import { reviewErrorMessage } from "#lib/review-errors";
import { Button, Icon, Modal, Textarea } from "#ui";

interface ReviewNoteProps {
  workspace: ReviewWorkspace;
  editable: boolean;
  open: boolean;
  disabled: boolean;
  pending: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSave: (note: string, base: ReviewWorkspace) => Promise<void>;
}

export function ReviewNote({
  workspace,
  editable,
  open,
  disabled,
  pending,
  onOpen,
  onClose,
  onSave,
}: ReviewNoteProps) {
  const closeNote = () => {
    onClose();
    requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>("#review-note-edit") ??
        document.querySelector<HTMLElement>("#review-note-heading");
      target?.focus();
    });
  };
  let editLabel = "Upravit";
  if (workspace.note === "") editLabel = "Přidat";

  return (
    <section className="rounded-box border border-base-300 p-4 text-sm" aria-labelledby="review-note-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 tabIndex={-1} id="review-note-heading" className="flex items-center gap-2 font-semibold">
          <Icon name="review" size="sm" />
          Poznámka k případu
        </h3>
        {editable && (
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={onOpen}
            id="review-note-edit"
            aria-label="Upravit poznámku k případu"
          >
            <Icon name="pencil" size="xs" />
            {editLabel}
          </Button>
        )}
      </div>
      {workspace.note === "" && <p className="mt-2 text-base-content/60">Bez poznámky.</p>}
      {workspace.note !== "" && (
        <p className="mt-3 max-h-64 overflow-y-auto leading-relaxed wrap-anywhere whitespace-pre-wrap">
          {workspace.note}
        </p>
      )}
      {open && (
        <NoteEditor
          workspace={workspace}
          editable={editable}
          pending={pending}
          onClose={closeNote}
          onSave={onSave}
        />
      )}
    </section>
  );
}

interface NoteEditorProps {
  workspace: ReviewWorkspace;
  editable: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (note: string, base: ReviewWorkspace) => Promise<void>;
}

function NoteEditor({ workspace, editable, pending, onClose, onSave }: NoteEditorProps) {
  const [base, setBase] = useState(workspace);
  const [note, setNote] = useState(workspace.note);
  const [error, setError] = useState<string | null>(null);
  const changedRevision = workspace.revision !== base.revision;
  const save = async () => {
    if (!editable || pending || changedRevision) return;
    try {
      await onSave(note.trim(), base);
      onClose();
    } catch (error_) {
      setError(reviewErrorMessage(error_));
    }
  };

  return (
    <Modal
      open
      title="Poznámka k případu"
      onClose={onClose}
      dismissible={false}
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Zahodit a zavřít
          </Button>
          <Button
            tone="primary"
            loading={pending}
            disabled={
              pending || !editable || changedRevision || note.trim() === base.note || note.length > 4000
            }
            onClick={() => void save()}
          >
            Uložit poznámku
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label="Poznámka"
          rows={7}
          maxLength={4000}
          value={note}
          disabled={pending || !editable}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Souvislosti, doplnění nebo poznámka pro dalšího kontrolujícího…"
        />
        <p className="text-xs text-base-content/60">{note.length} / 4 000 znaků</p>
        {!editable && (
          <p role="alert" className="text-sm text-warning">
            Případ už není otevřený pro úpravy. Rozepsaná poznámka zůstala zachována.
          </p>
        )}
        {changedRevision && (
          <div role="alert" className="space-y-2 rounded-box bg-warning/10 p-3 text-sm">
            <p>Případ se mezitím změnil. Před uložením porovnejte aktuální poznámku se svým textem.</p>
            <p className="wrap-anywhere whitespace-pre-wrap">
              Aktuálně uloženo: {workspace.note || "Bez poznámky."}
            </p>
            {editable && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setBase(workspace);
                  setError(null);
                }}
              >
                Použít můj text na aktuální revizi
              </Button>
            )}
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
