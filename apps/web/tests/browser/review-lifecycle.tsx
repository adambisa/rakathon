import { focusManager, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";

import type { AppRouter } from "@prostapaper/api";
import {
  type Case,
  ReviewDraftRecord,
  type ReviewMarkView,
  type ReviewWorkspace,
} from "@prostapaper/contracts";

import { AppLayout } from "#components/app-layout";
import { CaseDetail } from "#components/case-detail/case-detail";
import { emptyReviewLesion } from "#lib/review-edit";
import { SessionContext } from "#lib/use-session";
import { createTrpcOptions, TRPCProvider, useTRPC } from "#trpc";

const caseId = "00000000-0000-4000-8000-000000000091";
const lesionId = "lesion-1";
const initialRecord = ReviewDraftRecord.parse({
  surgery: {
    surgery_date: "2026-10-01",
    surgery_type: "2",
    lymphadenectomy: "2",
    node_no_surgery: null,
    node_positive_no_surgery: null,
    pt_surg: null,
    pn_surg: null,
    pm_surg: null,
    classify_r_surg: "1",
    classify_l_surg: "1",
    vascular_inv: "1",
    isup: "2",
    histol_post_surg: "1",
    histol_post_surg_specify: null,
    surgery_text: "Synthetic saved report",
  },
  lesions: [{ ...emptyReviewLesion(), lesion_x_mm: 10 }],
});
const initialCase: Case = {
  id: caseId,
  name: "Synthetic review lifecycle",
  ownerId: "local-reviewer",
  owner: {
    id: "local-reviewer",
    name: "Local Reviewer",
    email: "reviewer@example.test",
    image: null,
  },
  accessRole: "owner",
  status: "in_review",
  createdAt: "2026-10-01T10:00:00Z",
  mappedAt: "2026-10-01T10:00:00Z",
  reviewStartedAt: "2026-10-17T10:00:00Z",
  approvedAt: null,
  exportStartedAt: null,
  exportedAt: null,
  redcapRecordId: null,
  exportUnconfirmed: false,
  documents: [],
};
function initialWorkspace(): ReviewWorkspace {
  return {
    note: "",
    proposal: { record: structuredClone(initialRecord) },
    record: structuredClone(initialRecord),
    evidence: null,
    mappingIdentity: "mapping/local/record.json",
    baseline: { versionId: "local-v1", sha256: "a".repeat(64) },
    approvedRevision: null,
    revision: 1,
    snapshot: null,
    lesionIds: [lesionId],
    proposalLesionIds: [lesionId],
    issues: [],
    readOnly: false,
    workflow: { policyVersion: 3, decisions: [], confirmations: [] },
    marks: [],
    markHistory: [],
    workflowStatus: {
      fields: [],
      sections: [
        {
          reference: { scope: "lesion", lesionId },
          confirmed: false,
          blockingIssueCount: 0,
          unresolvedFieldCount: 0,
          unresolvedMarkCount: 0,
        },
        {
          reference: { scope: "collection", collection: "lesions" },
          confirmed: false,
          blockingIssueCount: 0,
          unresolvedFieldCount: 0,
          unresolvedMarkCount: 0,
        },
      ],
    },
  };
}
const markId = `mark-${"d".repeat(64)}`;
function syntheticMark(): ReviewMarkView {
  return {
    source: {
      id: markId,
      documentId: "synthetic-sheet",
      sourceVersion: "v1",
      extractionIdentity: "synthetic-sheet-v1",
      page: 1,
      focus: { sectors: [{ id: "apex_AS_L", share: 1, coverage: 1 }], marked: ["apex_AS_L"] },
      regions: ["as_apex_ls"],
      status: "unassigned",
      lesionId: null,
      candidateLesionIds: [lesionId],
      ruleVersion: 1,
    },
    status: "unassigned",
    lesionId: null,
    resolutionId: null,
    note: null,
  };
}
function previewWorkspace(): ReviewWorkspace {
  const workspace = initialWorkspace();
  workspace.record.lesions = [
    {
      ...emptyReviewLesion(),
      lesion_x_mm: 18,
      lesion_y_mm: 12,
      lesion_z_mm: 9,
      sur_prostate_regions: ["pzpl_mid_ls", "pzpm_mid_ls"],
      gleason_prim_grade: "3",
      gleason_prim_perc: 70,
      gleason_sec_grade: "4",
      gleason_sec_perc: 30,
    },
    { ...emptyReviewLesion(), lesion_x_mm: 7, lesion_y_mm: 5, sur_prostate_regions: ["as_apex_ls"] },
  ];
  workspace.proposal.record = structuredClone(workspace.record);
  workspace.lesionIds = [lesionId, "lesion-2"];
  workspace.proposalLesionIds = [...workspace.lesionIds];
  const assigned = syntheticMark();
  assigned.source.id = `mark-${"e".repeat(64)}`;
  assigned.source.regions = ["pzpl_mid_ls", "pzpm_mid_ls"];
  assigned.status = "assigned";
  assigned.lesionId = lesionId;
  assigned.note = "Přiřazení ověřeno podle syntetického schématu.";
  workspace.marks = [syntheticMark(), assigned];
  workspace.workflowStatus.fields = [
    {
      reference: { scope: "collection", collection: "lesions" },
      decisionRequired: true,
      noteRequired: false,
      resolved: false,
    },
    {
      reference: { scope: "lesion", lesionId, field: "lesion_x_mm" },
      decisionRequired: true,
      noteRequired: false,
      resolved: true,
    },
    {
      reference: { scope: "lesion", lesionId: "lesion-2", field: "sur_prostate_regions" },
      decisionRequired: true,
      noteRequired: true,
      resolved: false,
    },
  ];
  workspace.workflowStatus.sections = [
    {
      reference: { scope: "collection", collection: "lesions" },
      confirmed: false,
      blockingIssueCount: 0,
      unresolvedFieldCount: 1,
      unresolvedMarkCount: 1,
    },
    {
      reference: { scope: "lesion", lesionId },
      confirmed: false,
      blockingIssueCount: 0,
      unresolvedFieldCount: 0,
      unresolvedMarkCount: 1,
    },
    {
      reference: { scope: "lesion", lesionId: "lesion-2" },
      confirmed: false,
      blockingIssueCount: 0,
      unresolvedFieldCount: 1,
      unresolvedMarkCount: 0,
    },
  ];

  return workspace;
}
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  async function poll(): Promise<void> {
    if (predicate()) return;
    assert(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await poll();
  }
  await poll();
}
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === name || element.textContent.trim() === name,
  );
  assert(found !== undefined, `Missing button: ${name}`);

  return found;
}
function selectMarkAttention() {
  const panel = document.querySelector('[aria-labelledby="mapping-attention-title"]');
  assert(panel !== null, "Attention panel missing");
  const summary = panel.querySelector("summary");
  const details = panel.querySelector("details");
  assert(summary !== null && details !== null, "Attention disclosure missing");
  if (!details.open) summary.click();
  const markButton = [...panel.querySelectorAll("li button")].find((element) =>
    element.textContent.includes("Značka 1 · Schéma · strana 1"),
  );
  assert(markButton instanceof HTMLButtonElement, "Numbered mark attention item missing");
  assert(!markButton.textContent.includes(markId), "Mark hash leaked into attention label");
  markButton.focus();
  markButton.click();
}
async function enter(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  assert(input !== null, `Missing input: ${selector}`);
  const prototype =
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
}
async function mount(
  mode:
    | "saved"
    | "offline"
    | "invalid"
    | "legacy"
    | "marks"
    | "preview"
    | "note-failure"
    | "ready"
    | "ready-viewer"
    | "approved"
    | "approved-viewer" = "saved",
) {
  let item = structuredClone(initialCase);
  const workspace = mode === "preview" ? previewWorkspace() : initialWorkspace();
  if (mode === "offline" || mode === "invalid") workspace.revision = 0;
  if (mode === "legacy") workspace.record.surgery.surgery_date = "2026-10-02";
  if (mode === "marks") workspace.marks = [syntheticMark()];
  if (mode === "preview") {
    item = { ...item, name: "Ukázkový případ · kontrola ložisek" };
  }
  if (mode === "ready" || mode === "ready-viewer") {
    item = {
      ...item,
      status: "ready_for_review",
      reviewStartedAt: null,
      accessRole: mode === "ready-viewer" ? "viewer" : "reviewer",
    };
    workspace.readOnly = true;
    workspace.revision = 0;
  }
  if (mode === "approved" || mode === "approved-viewer") {
    item = {
      ...item,
      status: "approved",
      approvedAt: "2026-10-17T11:00:00Z",
      accessRole: mode === "approved-viewer" ? "viewer" : "owner",
    };
    workspace.readOnly = true;
  }
  const exporting = mode === "approved" || mode === "approved-viewer";
  let starts = 0;
  let sends = 0;
  const commands: { requestId: string; operations: unknown[]; note?: string }[] = [];
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        fetch: async (url, options) => {
          assert(typeof url === "string", "Expected a URL string");
          const body = await new Response(options?.body).text();
          const paths = url.split("/api/trpc/", 2)[1]?.split("?", 1)[0]?.split(",") ?? [];
          const replies = paths.map((path) => {
            if (path === "case.get") return { result: { data: item } };
            if (path === "case.startReview") {
              starts += 1;
              item = { ...item, status: "in_review", reviewStartedAt: "2026-10-17T10:00:00Z" };
              workspace.readOnly = false;

              return { result: { data: item } };
            }
            if (path === "case.sendToRedcap") {
              sends += 1;
              item = {
                ...item,
                status: "exported",
                exportedAt: "2026-10-17T12:00:00Z",
                redcapRecordId: "64-1",
              };

              return { result: { data: item } };
            }
            if (path === "case.reopen") {
              item = { ...item, status: "in_review", approvedAt: null };
              workspace.readOnly = false;

              return { result: { data: item } };
            }
            if (path === "case.review.get") return { result: { data: workspace } };
            if (path === "case.review.save") {
              const inputs = JSON.parse(body) as Record<
                string,
                { requestId: string; operations: unknown[]; note?: string }
              >;
              const command = inputs["0"];
              assert(command !== undefined, "Save command is missing");
              if (mode === "preview" && (command.note === undefined || command.operations.length > 0))
                throw new Error("Visual preview only saves notes in memory");
              commands.push(command);
              if (mode === "offline" && commands.length <= 2) throw new TypeError("Failed to fetch");
              if (mode === "invalid" || mode === "note-failure")
                return {
                  error: {
                    code: -32_600,
                    message: "Review draft contains invalid fields or too many lesions",
                    data: { code: "BAD_REQUEST", httpStatus: 400 },
                  },
                };
              if (command.note !== undefined) workspace.note = command.note;
              workspace.revision += 1;

              return { result: { data: workspace } };
            }
            throw new Error(`Unexpected API command: ${path}`);
          });

          return Response.json(replies, { headers: { "Content-Type": "application/json" } });
        },
      }),
    ],
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retryDelay: 0 } },
  });
  function Page() {
    const trpc = useTRPC();
    const result = useQuery(
      trpc.case.get.queryOptions({ caseId }, { staleTime: 30_000, refetchInterval: false }),
    );

    if (result.data === undefined) return null;

    if (mode === "preview")
      return (
        <AppLayout>
          <p className="mb-3 text-xs text-base-content/60">
            Náhled se syntetickými daty · poznámka se uchová jen do obnovení stránky
          </p>
          <CaseDetail case={result.data} />
        </AppLayout>
      );

    return <CaseDetail case={result.data} />;
  }
  const route = createRootRoute({ component: Page });
  const router = createRouter({ routeTree: route });
  const element = document.querySelector("#root");
  assert(element !== null, "Root missing");
  const root = createRoot(element);
  root.render(
    <QueryClientProvider client={cache}>
      <TRPCProvider trpcClient={client} queryClient={cache}>
        <SessionContext
          value={{
            session:
              mode === "preview"
                ? {
                    user: {
                      id: "local-reviewer",
                      name: "Ukázkový lékař",
                      email: "preview@example.invalid",
                      displayEmail: "preview@example.invalid",
                      role: "reviewer",
                      isAnonymous: false,
                    },
                  }
                : null,
            isPending: false,
            error: null,
            signIn: unexpectedAuth,
            signOut: unexpectedAuth,
            signUp: unexpectedAuth,
          }}
        >
          <RouterProvider router={router} />
        </SessionContext>
      </TRPCProvider>
    </QueryClientProvider>,
  );
  await until(() => {
    if (mode === "ready" || mode === "ready-viewer")
      return document.body.textContent.includes("Navržená ložiska");
    if (exporting) return document.body.textContent.includes("Ložisko 1");

    return document.querySelector('[aria-label="Upravit: Rozměr ložiska X (mm)"]') !== null;
  }, "Review did not load");

  return {
    commands,
    workspace,
    starts: () => starts,
    sends: () => sends,
    refresh: async (approve: boolean) => {
      if (approve) item = { ...item, status: "approved", approvedAt: "2026-10-17T11:00:00Z" };
      const trpc = createTrpcOptions(cache);
      cache.setQueryData(trpc.case.get.queryKey({ caseId }), (cached) => cached, {
        updatedAt: Date.now() - 31_000,
      });
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await until(() => cache.isFetching() === 0, "Focus refresh did not settle");
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
    close: () => {
      root.unmount();
      cache.clear();
      focusManager.setFocused(undefined);
    },
  };
}

const tests: [string, () => Promise<void>][] = [
  [
    "approved case shows export screen and sends to REDCap",
    async () => {
      const app = await mount("approved");
      try {
        assert(
          document.querySelector('[aria-label="Upravit: Rozměr ložiska X (mm)"]') === null,
          "Approved case exposes editor",
        );
        assert(!button("Zpět k revizi").disabled, "Reopen is unavailable");
        button("Odeslat do REDCap").click();
        await until(() => document.body.textContent.includes("64-1"), "Export result missing");
        assert(app.sends() === 1, "Export must be sent exactly once");
        assert(document.body.textContent.includes("Odesláno do REDCap"), "Exported heading missing");
        assert(
          ![...document.querySelectorAll("button")].some((element) =>
            element.textContent.includes("Odeslat do REDCap"),
          ),
          "Exported case can be sent again",
        );
        assert(app.commands.length === 0, "Export screen mutated review");
      } finally {
        app.close();
      }
    },
  ],
  [
    "returning from the export screen reopens the editor",
    async () => {
      const app = await mount("approved");
      try {
        button("Zpět k revizi").click();
        await until(
          () => document.querySelector('[aria-label="Upravit: Rozměr ložiska X (mm)"]') !== null,
          "Reopening did not show editor",
        );
        assert(!document.body.textContent.includes("Odeslání do REDCap"), "Export screen remains");
      } finally {
        app.close();
      }
    },
  ],
  [
    "viewer sees export screen without send or reopen controls",
    async () => {
      const app = await mount("approved-viewer");
      try {
        assert(document.body.textContent.includes("Odeslání do REDCap"), "Viewer export screen missing");
        assert(
          ![...document.querySelectorAll("button")].some((element) =>
            ["Odeslat do REDCap", "Zpět k revizi"].includes(element.textContent.trim()),
          ),
          "Viewer can send or reopen",
        );
        assert(app.sends() === 0 && app.commands.length === 0, "Viewer export screen mutated case");
      } finally {
        app.close();
      }
    },
  ],
  [
    "ready case shows summary and opens editor only after starting review",
    async () => {
      const app = await mount("ready");
      try {
        assert(
          document.querySelector('[aria-label="Upravit: Rozměr ložiska X (mm)"]') === null,
          "Ready case exposes editor",
        );
        assert(app.commands.length === 0 && app.starts() === 0, "Summary must not mutate review");
        const summary = [...document.querySelectorAll("section")].find((section) =>
          section.textContent.includes("Souhrn před revizí"),
        );
        assert(summary?.querySelector("dd")?.textContent === "1", "Lesion count missing");
        button("Zahájit revizi").click();
        await until(
          () => document.querySelector('[aria-label="Upravit: Rozměr ložiska X (mm)"]') !== null,
          "Starting review did not open editor",
        );
        assert(app.starts() === 1, "Review must start exactly once");
        assert(
          !document.body.textContent.includes("Souhrn před revizí"),
          "Summary remains after starting review",
        );
      } finally {
        app.close();
      }
    },
  ],
  [
    "viewer sees ready summary without start or editor controls",
    async () => {
      const app = await mount("ready-viewer");
      try {
        assert(document.body.textContent.includes("Souhrn před revizí"), "Viewer summary missing");
        assert(
          ![...document.querySelectorAll("button")].some((element) =>
            element.textContent.includes("Zahájit revizi"),
          ),
          "Viewer can start review",
        );
        assert(
          document.querySelector('[aria-label="Upravit: Rozměr ložiska X (mm)"]') === null,
          "Viewer sees editor",
        );
        assert(app.commands.length === 0 && app.starts() === 0, "Viewer summary mutated review");
      } finally {
        app.close();
      }
    },
  ],
  [
    "case note saves without field operations and reopens from the queried workspace",
    async () => {
      const app = await mount();
      try {
        button("Upravit poznámku k případu").click();
        await until(
          () => document.querySelector("dialog[open] textarea") !== null,
          "Note editor did not open",
        );
        await enter("dialog[open] textarea", "  Porovnat rozsah s přiloženým schématem.  ");
        button("Uložit poznámku").click();
        await until(() => document.querySelector("dialog[open]") === null, "Saved note did not close");
        assert(
          app.workspace.note === "Porovnat rozsah s přiloženým schématem.",
          "Saved note missing from workspace",
        );
        assert(
          app.commands.length === 1 && app.commands[0]?.operations.length === 0,
          "Note save must not edit clinical fields",
        );
        assert(app.workspace.revision === 2, "Note save must advance revision");
        await app.refresh(false);
        button("Upravit poznámku k případu").click();
        await until(
          () =>
            document.querySelector<HTMLTextAreaElement>("dialog[open] textarea")?.value ===
            app.workspace.note,
          "Reopened note did not match queried workspace",
        );
      } finally {
        app.close();
      }
    },
  ],
  [
    "case note draft survives revision refresh and requires explicit comparison",
    async () => {
      const app = await mount();
      try {
        button("Upravit poznámku k případu").click();
        await until(
          () => document.querySelector("dialog[open] textarea") !== null,
          "Note editor did not open",
        );
        await enter("dialog[open] textarea", "Můj rozepsaný text");
        app.workspace.note = "Poznámka jiného kontrolujícího";
        app.workspace.revision = 2;
        await app.refresh(false);
        assert(
          document.querySelector<HTMLTextAreaElement>("dialog[open] textarea")?.value ===
            "Můj rozepsaný text",
          "Refresh discarded note draft",
        );
        assert(button("Uložit poznámku").disabled, "New revision must block note save");
        assert(
          document.querySelector("dialog[open]")?.textContent.includes(app.workspace.note) === true,
          "Current server note must be shown for comparison",
        );
        button("Použít můj text na aktuální revizi").click();
        await until(
          () => !button("Uložit poznámku").disabled,
          "Explicit comparison did not unlock note save",
        );
        assert(app.commands.length === 0, "Comparing notes must not save automatically");
        button("Uložit poznámku").click();
        await until(() => document.querySelector("dialog[open]") === null, "Rebased note did not save");
        assert(app.workspace.note === "Můj rozepsaný text", "Rebased note was not retained");
      } finally {
        app.close();
      }
    },
  ],
  [
    "read-only case retains the note without exposing its editor",
    async () => {
      const app = await mount();
      try {
        app.workspace.note = "Schválená poznámka";
        app.workspace.readOnly = true;
        await app.refresh(false);
        const note = document.querySelector('[aria-labelledby="review-note-heading"]');
        assert(note?.textContent.includes("Schválená poznámka") === true, "Read-only note is missing");
        assert(
          note.querySelector('[aria-label="Upravit poznámku k případu"]') === null,
          "Read-only case exposes note editing",
        );
        assert(app.commands.length === 0, "Read-only note must not save");
      } finally {
        app.close();
      }
    },
  ],
  [
    "failed case note save preserves the draft for recovery",
    async () => {
      const app = await mount("note-failure");
      try {
        button("Upravit poznámku k případu").click();
        await until(
          () => document.querySelector("dialog[open] textarea") !== null,
          "Note editor did not open",
        );
        await enter("dialog[open] textarea", "Text musí zůstat při chybě");
        button("Uložit poznámku").click();
        await until(
          () => document.querySelector('dialog[open] [role="alert"]') !== null,
          "Save failure was not shown",
        );
        assert(
          document.querySelector<HTMLTextAreaElement>("dialog[open] textarea")?.value ===
            "Text musí zůstat při chybě",
          "Failed save lost note draft",
        );
        assert(app.workspace.note === "", "Failed save mutated stored note");
        assert(app.commands.length === 1, "Validation rejection must not retry automatically");
      } finally {
        app.close();
      }
    },
  ],
  [
    "mark attention opens numbered assignment directly and keeps field actions reachable",
    async () => {
      const app = await mount("marks");
      try {
        const details = document.querySelector<HTMLDetailsElement>(
          '[aria-labelledby="mapping-attention-title"] details',
        );
        assert(details !== null && !details.open, "Issue list must begin collapsed");
        selectMarkAttention();
        await until(
          () => document.querySelector("dialog[open] select") !== null,
          "Mark attention did not open assignment",
        );
        const title = document.querySelector("dialog[open] h2")?.textContent ?? "";
        assert(title.includes("Značka 1"), "Mark dialog must use its human-readable number");
        assert(!title.includes(markId), "Mark hash leaked into dialog title");
        assert(button("Potvrdit").disabled, "Unchosen assignment must not be confirmable");
        button("Zrušit").click();
        await until(() => document.querySelector("dialog[open]") === null, "Mark dialog did not close");
        await until(
          () => document.activeElement?.textContent.includes("Značka 1 · Schéma · strana 1") === true,
          "Closing assignment must return focus to its attention item",
        );
        button("Upravit: Rozměr ložiska X (mm)").click();
        await until(
          () => document.querySelector("dialog[open] input") !== null,
          "Field edit must remain reachable",
        );
        button("Zahodit a zavřít").click();
        await until(() => document.querySelector("dialog[open]") === null, "Field editor did not close");
        button("Zkontrolovat: Rozměr ložiska X (mm)").click();
        await until(
          () => document.querySelector("dialog[open] textarea") !== null,
          "Field decision must remain reachable",
        );
        assert(app.commands.length === 0, "Opening review dialogs must not save");
      } finally {
        app.close();
      }
    },
  ],
  [
    "read-only mark attention opens evidence without assignment controls",
    async () => {
      const app = await mount("marks");
      try {
        app.workspace.readOnly = true;
        await app.refresh(false);
        selectMarkAttention();
        await until(() => document.querySelector("dialog[open]") !== null, "Read-only evidence did not open");
        assert(document.querySelector("dialog[open] select") === null, "Read-only mark exposed assignment");
        assert(document.querySelector("dialog[open] textarea") === null, "Read-only mark exposed a decision");
        assert(
          document.querySelector("dialog[open]")?.textContent.includes("Aktuální hodnota") === true,
          "Expected source evidence",
        );
        assert(app.commands.length === 0, "Read-only attention must not mutate");
      } finally {
        app.close();
      }
    },
  ],
  [
    "legacy parent surgery corrections stay outside the lesion review and final summary",
    async () => {
      const app = await mount("legacy");
      try {
        assert(!document.body.textContent.includes("Datum operace"), "Parent surgery leaked into review");
        await app.refresh(true);
        assert(
          !document.body.textContent.includes("Datum operace"),
          "Parent surgery leaked into export screen",
        );
      } finally {
        app.close();
      }
    },
  ],
  [
    "revision refresh preserves a field draft and requires explicit comparison before saving",
    async () => {
      const app = await mount();
      try {
        button("Upravit: Rozměr ložiska X (mm)").click();
        await until(() => document.querySelector("dialog[open] input") !== null, "Editor did not open");
        await enter("dialog[open] input", "27");
        app.workspace.revision = 2;
        const lesion = app.workspace.record.lesions[0];
        assert(lesion !== undefined, "Synthetic lesion missing");
        lesion.lesion_x_mm = 18;
        await app.refresh(false);
        assert(
          document.querySelector<HTMLInputElement>("dialog[open] input")?.value === "27",
          "Revision refresh discarded the field draft",
        );
        assert(button("Uložit hodnotu").disabled, "A newer revision must block saving");
        assert(
          document.querySelector("dialog[open]")?.textContent.includes("Aktuálně na serveru: 18") === true,
          "The editor must show the current server value",
        );
        button("Použít můj vstup na aktuální revizi").click();
        await until(() => !button("Uložit hodnotu").disabled, "Explicit rebase did not unlock save");
        assert(app.commands.length === 0, "Comparing a revision must not save automatically");
      } finally {
        app.close();
      }
    },
  ],
  [
    "approval refresh replaces the editor with the export screen without saving a draft",
    async () => {
      const app = await mount();
      try {
        button("Upravit: Rozměr ložiska X (mm)").click();
        await until(() => document.querySelector("dialog[open] input") !== null, "Editor did not open");
        await enter("dialog[open] input", "27");
        assert(!button("Uložit hodnotu").disabled, "Draft should be saveable before approval");
        await app.refresh(true);
        assert(document.body.textContent.includes("Odeslání do REDCap"), "Export screen missing");
        assert(document.querySelector("dialog[open]") === null, "Editor remains open after approval");
        assert(app.commands.length === 0, "Approval refresh must not save the draft");
      } finally {
        app.close();
      }
    },
  ],
  [
    "case focus refresh preserves a decision note and locks confirmation",
    async () => {
      const app = await mount();
      try {
        button("Zkontrolovat: Rozměr ložiska X (mm)").click();
        await until(() => document.querySelector("dialog[open] textarea") !== null, "Decision did not open");
        await enter("dialog[open] textarea", "Keep this unsaved reason");
        app.workspace.readOnly = true;
        await app.refresh(false);
        assert(
          document.querySelector<HTMLTextAreaElement>("dialog[open] textarea")?.value ===
            "Keep this unsaved reason",
          "Focus refresh discarded the decision note",
        );
        assert(button("Potvrdit").disabled, "Approved workspace must lock confirmation");
      } finally {
        app.close();
      }
    },
  ],
  [
    "failed initialization can retry the same command and unlock review",
    async () => {
      const app = await mount("offline");
      try {
        await until(
          () => app.commands.length === 2 && document.querySelector('[role="alert"]') !== null,
          "Initial transport attempts did not fail",
        );
        assert(
          !document.body.textContent.includes("Návrh obsahuje hodnoty mimo povolený rozsah"),
          "Transport failure was incorrectly reported as invalid clinical values",
        );
        const retry = button("Zkusit založit revizi znovu");
        retry.click();
        await until(
          () => !button("Zkontrolovat: Rozměr ložiska X (mm)").disabled,
          "Retry did not unlock decisions",
        );
        assert(app.commands.length === 3, "Manual retry must issue one save");
        assert(
          new Set(app.commands.map((command) => command.requestId)).size === 1,
          "Manual retry must retain the original idempotency key",
        );
        assert(
          app.commands.every((command) => command.operations.length === 0),
          "Initialization must save an unchanged proposal",
        );
      } finally {
        app.close();
      }
    },
  ],
  [
    "validation rejection does not create an automatic initialization loop",
    async () => {
      const app = await mount("invalid");
      try {
        await until(
          () => document.querySelector('[role="alert"]') !== null,
          "Validation error did not render",
        );
        await app.refresh(false);
        assert(app.commands.length === 1, "Validation rejection must wait for an explicit user action");
        assert(
          button("Zkontrolovat: Rozměr ložiska X (mm)").disabled,
          "Unsaved revision cannot accept decisions",
        );
      } finally {
        app.close();
      }
    },
  ],
];
const results = document.querySelector<HTMLElement>("#results");
assert(results !== null, "Results missing");
if (new URLSearchParams(location.search).get("preview") === "1") {
  await import("#styles.css");
  document.documentElement.lang = "cs";
  document.documentElement.dataset["theme"] =
    new URLSearchParams(location.search).get("theme") === "dark" ? "mou-dark" : "mou";
  document.title = "Náhled kontroly · syntetická data";
  document.querySelector("body > h1")?.remove();
  results.textContent = "Náhled se syntetickými daty · poznámka se uchová jen do obnovení stránky";
  results.hidden = true;
  const element = document.querySelector("#root");
  assert(element !== null, "Root missing");
  element.className = "";
  await mount("preview");
} else {
  results.textContent = "";
  await tests.reduce(async (previous, [name, run]) => {
    await previous;
    try {
      await run();
      results.textContent += `PASS ${name}\n`;
    } catch (error) {
      results.textContent += `FAIL ${name}: ${String(error)}\n`;
    }
  }, Promise.resolve());
  results.textContent += "DONE\n";
}

function unexpectedAuth(): never {
  throw new Error("Authentication is outside this synthetic review test");
}
