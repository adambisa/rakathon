import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { DOCUMENT_ACCEPT, type DocumentKind, MAX_DOCUMENT_SIZE } from "@prostapaper/contracts";

import { PairingTable } from "#components/pairing-table";
import {
  type BatchCase,
  EMPTY_STAGED,
  isSubmittable,
  mergeStaged,
  pairFiles,
  sortFiles,
  type Staged,
  unstage,
} from "#lib/batch-pairing";
import { cx } from "#lib/cx";
import { documentFilename } from "#lib/document-filename";
import { eachLimited } from "#lib/each-limited";
import { errorMessage } from "#lib/error-message";
import { fileBasename } from "#lib/file-key";
import { countLabel, formatBytes } from "#lib/format";
import { toast } from "#lib/toast";
import { type CaseUpload, submitCase } from "#lib/upload-document";
import { useObjectUrl } from "#lib/use-object-url";
import { useSession } from "#lib/use-session";
import { trpcClient, useTRPC } from "#trpc";
import { Badge, Button, type DocumentSheet, Dropzone, Input, Join, Modal, StepMark, type Tone } from "#ui";

interface Slot {
  kind: DocumentKind;
  step: number;
  title: string;
  sheet: DocumentSheet;
  hint: string;
  required: boolean;
}

const SLOTS: Slot[] = [
  {
    kind: "text_description",
    step: 1,
    title: "Textový popis",
    sheet: "text",
    hint: "Naskenovaný nález. Přečteme z něj text a vyplníme pole záznamu.",
    required: true,
  },
  {
    kind: "sector_map",
    step: 2,
    title: "Sektorová mapa",
    sheet: "sectors",
    hint: "Ručně značený formulář. Přečteme z něj zasažené sektory prostaty.",
    required: false,
  },
];

const SAMPLE_CASES = (["0005"] as const).map((id) => ({
  id,
  title: `Rakathon ${Number(id)}`,
}));

const MODES = [
  { mode: "single", label: "Jeden případ" },
  { mode: "batch", label: "Batch" },
] as const;

type EntryMode = (typeof MODES)[number]["mode"];

const TITLE = "block h-auto w-full px-0 py-1 text-3xl font-semibold";
// The form fills the viewport and the slots take the height the switch, header and
// footer leave; below the minimum the page scrolls instead of squeezing the cards.
const FORM_CLASS =
  "grid h-[min(100dvh-2.5rem,72rem)] min-h-[40rem] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-8";
const SLOTS_CLASS = "grid min-h-0 auto-rows-[minmax(0,1fr)] gap-4 @md/main:grid-cols-2";
const SLOT_CLASS = "aspect-[1/1.414] max-h-full w-full self-start";
const SUBMIT_CONCURRENCY = 3;
const CASES = { one: "případ", few: "případy", other: "případů" };
const FILES = { one: "soubor", few: "soubory", other: "souborů" };

export function CaseEntry() {
  const { session } = useSession();
  const isGuest = session?.user.isAnonymous ?? true;
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<EntryMode>("single");
  const [name, setName] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [staged, setStaged] = useState(EMPTY_STAGED);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [sampleModalOpen, setSampleModalOpen] = useState(false);
  const isSubmitting = progress !== undefined;
  const total = Object.values(staged).flat().length;
  const manyFiles =
    staged.text_description.length > 1 || staged.sector_map.length > 1 || staged.unknown.length > 0;
  const isSingle = mode === "single" && !manyFiles;
  const pairing = pairFiles(staged, names);
  const missingRequired = SLOTS.find((slot) => slot.required && staged[slot.kind].length === 0);
  const [report] = staged.text_description;

  let queue: BatchCase[] = [];
  if (isSingle && report !== undefined) {
    queue = [{ stem: "", name, report, sheet: staged.sector_map[0] }];
  } else if (!isSingle && isSubmittable(pairing)) {
    queue = pairing.cases;
  }

  const stage = (incoming: Partial<Staged>) =>
    setStaged((current) => mergeStaged(current, { ...EMPTY_STAGED, ...incoming }));
  const remove = (...files: (File | undefined)[]) => setStaged((current) => unstage(current, files));
  const clear = () => {
    setStaged(EMPTY_STAGED);
    setNames({});
  };

  const process = async (entries: BatchCase[]) => {
    if (isGuest || isSubmitting || entries.length === 0) return;
    setProgress({ done: 0, total: entries.length });
    const submitted: { entry: BatchCase; caseId: string }[] = [];
    const failed: string[] = [];
    await eachLimited(entries, SUBMIT_CONCURRENCY, async (entry) => {
      try {
        submitted.push({ entry, caseId: await submitCase(entry.name.trim(), uploadsOf(entry)) });
      } catch (error) {
        failed.push(`${entry.name} (${errorMessage(error)})`);
      }
      setProgress((current) => current && { ...current, done: current.done + 1 });
    });
    remove(...submitted.flatMap(({ entry }) => [entry.report, entry.sheet]));
    setProgress(undefined);
    await Promise.all([
      queryClient.invalidateQueries(trpc.case.list.pathFilter()),
      queryClient.invalidateQueries(trpc.document.list.pathFilter()),
    ]);
    if (failed.length > 0) {
      toast.error(`${countLabel(failed.length, CASES)} se nepodařilo odeslat: ${failed.join(", ")}`);

      return;
    }
    setName("");
    setNames({});
    if (submitted.length === 1 && submitted[0] !== undefined) {
      toast.success("Případ byl odeslán ke zpracování.");
      await navigate({ to: "/pripady/$caseId", params: { caseId: submitted[0].caseId } });

      return;
    }
    toast.success(`Odesláno ke zpracování: ${countLabel(submitted.length, CASES)}.`);
    await navigate({ to: "/pripady" });
  };

  const trySample = async (sample: (typeof SAMPLE_CASES)[number]) => {
    if (isSubmitting) return;
    setSampleModalOpen(false);
    setProgress({ done: 0, total: 1 });
    try {
      const created = await trpcClient.case.createSample.mutate({ sampleId: sample.id });
      toast.success("Případ byl odeslán ke zpracování.");
      await navigate({ to: "/pripady/$caseId", params: { caseId: created.id } });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setProgress(undefined);
      await Promise.all([
        queryClient.invalidateQueries(trpc.case.list.pathFilter()),
        queryClient.invalidateQueries(trpc.document.list.pathFilter()),
      ]);
    }
  };

  let sampleTone: Tone | undefined;
  if (isGuest) sampleTone = "primary";

  let submitLabel = "Zahájit zpracování";
  if (progress !== undefined) {
    submitLabel = progress.total === 1 ? "Nahrávám…" : `Odesílám ${progress.done}/${progress.total}…`;
  } else if (missingRequired !== undefined) {
    submitLabel = `Nahrajte ${missingRequired.title.toLowerCase()}`;
  } else if (!isSingle) {
    submitLabel = `Zahájit zpracování (${countLabel(pairing.cases.length, CASES)})`;
  }

  return (
    <>
      <form
        className={FORM_CLASS}
        onSubmit={(event) => {
          event.preventDefault();
          void process(queue);
        }}
      >
        <Join
          role="radiogroup"
          aria-label="Režim nahrávání"
          className="justify-self-center rounded-full border border-base-300 bg-base-200 p-1 focus-within:outline-0 has-focus-visible:outline-2"
        >
          {MODES.map((option) => {
            const active = option.mode === (isSingle ? "single" : "batch");

            return (
              <Button
                key={option.mode}
                size="md"
                variant={active ? "solid" : "ghost"}
                role="radio"
                aria-checked={active}
                active={active}
                // Several files staged are a batch; "one case" comes back once they are removed.
                disabled={isGuest || isSubmitting || (option.mode === "single" && manyFiles)}
                className="join-item rounded-full"
                onClick={() => setMode(option.mode)}
              >
                {option.label}
              </Button>
            );
          })}
        </Join>

        <header className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide uppercase opacity-60">
            {isSingle ? "Nový případ" : "Nový batch"}
          </p>
          <h1>
            {isSingle && (
              <Input
                aria-label="Název případu"
                placeholder="Jméno pacienta nebo název případu"
                name="name"
                variant="ghost"
                required={!isGuest}
                pattern={String.raw`.*\S.*`}
                value={name}
                maxLength={255}
                disabled={isGuest || isSubmitting}
                className={cx("case-title", TITLE)}
                onChange={(event) => setName(event.target.value)}
              />
            )}
            {!isSingle && <span className={cx(TITLE, "border-y border-transparent")}>Hromadné nahrání</span>}
          </h1>
          <p className="text-sm opacity-70">
            {isGuest
              ? "Jako host můžete zpracovávat pouze ukázkové případy. Vyberte je tlačítkem Vyzkoušet vzorek. Pro nahrání vlastních souborů se přihlaste nebo zaregistrujte."
              : "Nahrávejte jen syntetické nebo anonymizované skeny."}
          </p>
        </header>

        {isSingle && (
          <ul className={SLOTS_CLASS}>
            {SLOTS.map((slot) => (
              <li key={slot.kind} className={SLOT_CLASS}>
                <UploadSlot
                  slot={slot}
                  files={staged[slot.kind]}
                  caseName={name}
                  disabled={isGuest || isSubmitting}
                  onAdd={(files) => {
                    stage({ [slot.kind]: files });
                    const [first] = files;
                    if (first !== undefined && name === "") setName(fileBasename(first.name));
                  }}
                  onRemove={remove}
                />
              </li>
            ))}
          </ul>
        )}
        {!isSingle && (
          <div className={SLOTS_CLASS}>
            <div className={SLOT_CLASS}>
              <Dropzone
                size="xl"
                folders
                hint="Soubory se třídí podle názvu (scan/report = textový popis, schema = sektorová mapa) a párují podle čísla na konci."
                badge={
                  <Badge size="sm" variant="soft" tone="primary">
                    {slotBadge(total, true)}
                  </Badge>
                }
                sheet="text"
                onFiles={(files) => stage(sortFiles(files))}
                accept={DOCUMENT_ACCEPT}
                maxSize={MAX_DOCUMENT_SIZE}
                minSize={1}
                disabled={isGuest || isSubmitting}
                className="h-full"
              />
            </div>
            <div className={SLOT_CLASS}>
              {total > 0 && (
                <PairingTable
                  pairing={pairing}
                  disabled={isGuest || isSubmitting}
                  onRemove={remove}
                  onRename={(stem, value) => setNames((current) => ({ ...current, [stem]: value }))}
                  className="h-full"
                />
              )}
              {total === 0 && (
                <div className="flex h-full items-center justify-center rounded-box border border-dashed border-base-300 p-8 text-center text-sm opacity-60">
                  Zde se objeví případy: jeden řádek na každý textový popis, se sektorovou mapou stejného
                  čísla.
                </div>
              )}
            </div>
          </div>
        )}

        <footer className="flex justify-end gap-2 border-t border-base-300 pt-6">
          {SLOTS.some((slot) => staged[slot.kind].length === 0) && (
            <Button
              tone={sampleTone}
              variant={isGuest ? "solid" : "ghost"}
              disabled={isSubmitting}
              loading={isGuest && isSubmitting}
              onClick={() => setSampleModalOpen(true)}
            >
              Vyzkoušet vzorek
            </Button>
          )}
          {total > 0 && (
            <Button variant="ghost" disabled={isGuest || isSubmitting} onClick={clear}>
              Odebrat vše
            </Button>
          )}
          {!isGuest && (
            <Button
              tone="primary"
              type="submit"
              disabled={isSubmitting || queue.length === 0}
              loading={isSubmitting}
            >
              {submitLabel}
            </Button>
          )}
        </footer>
      </form>
      <Modal
        open={sampleModalOpen}
        onClose={() => setSampleModalOpen(false)}
        title="Vyberte ukázkový případ"
        size="md"
      >
        <p className="mb-4 text-sm opacity-70">
          Načteme textový nález a odpovídající ručně značené schéma a rovnou zahájíme zpracování.
        </p>
        <ul className="grid gap-2">
          {SAMPLE_CASES.map((sample) => (
            <li key={sample.id}>
              <Button
                variant="outline"
                className="h-auto w-full justify-start py-3 text-left"
                disabled={isSubmitting}
                onClick={() => void trySample(sample)}
              >
                <span className="flex flex-col items-start gap-1">
                  <span className="font-medium">{sample.title}</span>
                  <span className="text-xs opacity-70">Textový nález + zakreslené schéma</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function uploadsOf({ report, sheet }: BatchCase): CaseUpload[] {
  const uploads: CaseUpload[] = [{ kind: "text_description", file: report }];
  if (sheet !== undefined) uploads.push({ kind: "sector_map", file: sheet });

  return uploads;
}

function slotBadge(count: number, required: boolean): string {
  if (count > 0) return countLabel(count, FILES);

  return required ? "Povinné" : "Volitelné";
}

interface UploadSlotProps {
  slot: Slot;
  files: File[];
  caseName: string;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (file: File) => void;
}

function UploadSlot({ slot, files, caseName, disabled, onAdd, onRemove }: UploadSlotProps) {
  const [file] = files;
  let badgeTone: Tone | undefined;
  if (file !== undefined || slot.required) badgeTone = "primary";
  const badge = (
    <Badge size="sm" variant="soft" tone={badgeTone}>
      {slotBadge(files.length, slot.required)}
    </Badge>
  );

  if (file !== undefined) {
    return (
      <StagedDocument
        slot={slot}
        badge={badge}
        file={file}
        filename={documentFilename(caseName, file.name)}
        disabled={disabled}
        onAdd={onAdd}
        onRemove={() => onRemove(file)}
      />
    );
  }

  return (
    <Dropzone
      size="xl"
      step={slot.step}
      title={slot.title}
      hint={slot.hint}
      badge={badge}
      sheet={slot.sheet}
      onFiles={onAdd}
      accept={DOCUMENT_ACCEPT}
      maxSize={MAX_DOCUMENT_SIZE}
      minSize={1}
      disabled={disabled}
      className="h-full"
    />
  );
}

interface StagedDocumentProps {
  slot: Slot;
  badge: ReactNode;
  file: File;
  filename: string;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: () => void;
}

function StagedDocument({ slot, badge, file, filename, disabled, onAdd, onRemove }: StagedDocumentProps) {
  const preview = useObjectUrl(file);

  return (
    <Dropzone
      onFiles={onAdd}
      accept={DOCUMENT_ACCEPT}
      maxSize={MAX_DOCUMENT_SIZE}
      minSize={1}
      disabled={disabled}
      className="flex h-full flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4"
    >
      {(open) => (
        <>
          <header className="flex items-center gap-2">
            <StepMark>{slot.step}</StepMark>
            <h2 className="text-base font-medium">{slot.title}</h2>
            {badge}
            <Button size="xs" variant="ghost" disabled={disabled} className="ml-auto" onClick={open}>
              Přidat další
            </Button>
            <Button size="xs" variant="ghost" disabled={disabled} onClick={onRemove}>
              Odebrat
            </Button>
          </header>
          <div className="relative min-h-0 flex-1">
            <img ref={preview} alt="" className="absolute inset-0 size-full object-contain" />
          </div>
          <div className="flex items-center gap-3 text-xs opacity-60">
            <span className="truncate">{filename}</span>
            <span className="ml-auto shrink-0 tabular-nums">{formatBytes(file.size)}</span>
          </div>
        </>
      )}
    </Dropzone>
  );
}
