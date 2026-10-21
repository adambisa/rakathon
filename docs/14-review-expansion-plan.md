# Review expansion: corrections, evidence and confidence

Planning proposal, 2026-10-17. Based on local commit `67f16d7` and [PR #61](https://github.com/rakathon26/rakathon/pull/61), head `fcfae2a7d113f9c5de0dcfcfb2601c0772863763`. No application changes or REDCap writes are part of this planning task.

Revised after the adversarial Sol review: separates draft and approval validation, tightens lesion-confidence denominators, adds explicit sector-mark assignments and decision invalidation, clarifies approval guarantees, and allows evidence/confidence to ship before persistent editing.

## Current scope — clarified 2026-10-17

The required target is **`surgery_c61_resected_lesion` only**. Active extraction,
review, readiness and export cover the 14 lesion fields plus lesion completeness.
Parent `surgery_c61` clinical fields are not requested review inputs or approval
requirements. `SurgeryRecord.surgery` remains readable for legacy records; new
mapping instructions leave those fields null. Production export contains an
identity-only base row and repeating lesion rows, and marks only the lesion form
complete. Missing parent metadata cannot block this workflow.

This correction supersedes the broader surgery-field scope in the original plan
and historical implementation notes below. They remain as implementation history.

## Recommended outcome

Turn the existing review stage into a persistent clinical review workspace for the current `SurgeryRecord`. Reviewers can correct every supported lesion field, inspect its source with a question-mark button, address the least reliable proposals first, confirm sections, and approve an immutable version that is also used by final review and export.

Keep three concepts separate throughout the data model and UI:

- **Evidence:** where the proposed value came from, including source text, image, or a documented transformation.
- **AI confidence:** the strength and limitations of that evidence and agreement between mapping passes.
- **Review decision:** what a person confirmed, corrected, cleared, or left unresolved.

Recommended first release includes all three, with qualitative confidence and real citations. Numeric probabilities and precise image highlights follow only when supported by data.

## 1. What exists and what must change

| Area               | Current implementation                                                                                                                            | Consequence for this work                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review UI          | `apps/web/src/components/case-detail/review/case-mapping.tsx` renders dictionary fields and a sector diagram.                                     | Replace read-only rows with reusable review rows; preserve the current record shape.                                                                |
| Lifecycle          | `review-actions.tsx` and `apps/api/src/cases/service.ts` start review and approve the case.                                                       | Approval currently checks lifecycle, not review completeness or a corrected record. Add server-side gates.                                          |
| Form               | `packages/contracts/src/surgery.ts`: 15 surgery fields and 14 fields per lesion.                                                                  | Use current REDCap codes and constraints, not the old prostatectomy schema.                                                                         |
| Dictionary         | `redcap-schema.ts` contains labels, codes, required flags, bounds and branching.                                                                  | Reuse it; maintain Czech display translations separately and test coverage. Do not hand-edit generated metadata.                                    |
| Mapping            | `packages/mapping/src/index.ts` runs three passes by default, configurable from 1–9.                                                              | Capture structured per-field agreement without requiring extra mapping calls.                                                                       |
| Consensus          | `consensus.ts` returns aggregate stability and human-readable disagreement strings. It can fall back to a complete pass or lesion array.          | Add typed field diagnostics and identify the actual selected value and selection method. Do not parse diagnostic strings in the frontend.           |
| Source material    | Extracted pages contain text, page number and source method; original JPEGs and extraction JSON are accessible through authorized presigned URLs. | Page/text evidence is feasible now. Persisted OCR text boxes are not currently part of the page contract.                                           |
| Source identity    | `CaseDocumentText` contains filename, kind and extraction; prompt assembly does not preserve explicit text-page identifiers.                      | Carry document IDs, artifact versions and page identifiers into mapping and citations.                                                              |
| Sector processing  | `applySectorMap` can add regions after consensus; diagnostics expose counts and unplaced regions.                                                 | Explain postprocessing and flag unresolved assignments. Pre-postprocessing agreement cannot be presented as confidence in the modified final value. |
| Persistence/export | Cases store mapping artifact keys; no review draft exists. `sendToRedcap` loads the original mapping.                                             | Introduce review revisions and change final display/export to the approved revision together.                                                       |
| Validation         | `SurgeryRecord` allows unknowns; `prepareRedcapUpload` also enforces required fields, dictionary bounds and branching.                            | Review must display both kinds of validation before approval.                                                                                       |

Some existing overview docs describe older implementation states. The code and current schema are the baseline for this plan. Live REDCap data is unnecessary for this planning task; use the checked-in dictionary snapshot. Any later dictionary refresh follows the read-only REDCap access instructions.

### How to use PR #61

Reuse its interaction patterns: Czech section labels, sticky section navigation, pencil-triggered modal editors, add/clear/restore, a before/after changes panel, explicit section confirmation/revocation, automatic reopening after meaningful edits, and locking after completion. Keep the original report available independently of section navigation.

Adapt its reducer and test ideas, especially preservation of zero/false, no-op saves and edit → confirm → revert. Port suitable components selectively after checking their current UI dependencies.

Do not copy its seven-section field registry, `RadicalProstatectomyRecord`, old cross-field rules, synthetic report, in-memory persistence, or preview-only completion. Its report dialog explicitly does not establish field-level provenance. Evidence and production persistence are new work.

## 2. Reviewer experience

### Layout and navigation

Keep the existing case lifecycle: ready for review → in review → approved → exporting → exported. Entering the page shows the proposal; “Zahájit kontrolu” starts or resumes the persisted review. Evidence remains readable before review starts and after approval.

Use a wide form with a compact supporting column for the sector diagram, source documents and changes. On narrow screens stack these panels. Sticky section navigation contains section links and small issue/status indicators; avoid an oversized dashboard above the form.

Recommended sections, covering every current field exactly once:

| Section               | Fields                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operace               | `surgery_date`, `surgery_type`                                                                                                                                  |
| Histologie            | `histol_post_surg`, `histol_post_surg_specify`, `isup`, `surgery_text`                                                                                          |
| Uzliny                | `lymphadenectomy`, `node_no_surgery`, `node_positive_no_surgery`                                                                                                |
| Staging a klasifikace | `pt_surg`, `pn_surg`, `pm_surg`, `classify_r_surg`, `classify_l_surg`, `vascular_inv`                                                                           |
| Ložiska               | One card per lesion: regions/all segments; histology/dimensions; extension/perineural invasion; primary, secondary and tertiary Gleason grades and percentages. |

Confirm the four surgery sections and each lesion card independently. Also confirm lesion count/completeness, including an empty lesion collection; an empty array must not silently count as reviewed. Display the derived lesion count, rather than making it a second editable truth.

Each field row has a label, formatted value, confidence indicator where relevant, a **?** button (“Původ hodnoty: …”), and a pencil button. Use Czech labels with exact REDCap labels/codes available in details. Show text and icons alongside color. Required blanks and flagged fields remain visible; optional undocumented fields can be collapsed locally, as in the prototype.

### Editing

- Use typed editors for dates, coded choices, counts, decimal measurements, percentages, long text and region selections. Normalize Czech decimal input while storing numbers consistently.
- Keep the modal editor from the prototype flow. Show original proposal and current value, with save, clear and restore actions. Clearing means unknown, never an implicit negative or zero.
- Persist on explicit save. Display saving, saved and failed states; retain unsaved modal input on failure. A no-op save does not invalidate confirmation.
- Show immediate field and cross-field errors. Persist drafts through a separate `ReviewDraftRecord` contract that enforces field types, allowed codes and individual bounds but permits temporary cross-field inconsistencies. Share those field definitions with `SurgeryRecord`; run semantic validation separately and require full validity for confirmation/approval as appropriate. For example, save an increased positive-node count before correcting the examined count without losing either edit. Never persist arbitrary malformed values.
- When a parent edit invalidates dependent values, show the affected values and offer an atomic clear/update. Do not silently hide stale node counts after changing lymphadenectomy.
- Add/remove lesions and restore deleted original lesions. Assign stable review-local IDs; array indices are insufficient for edits, citations and history. The first release preserves lesion order and avoids drag reordering. Export still generates sequential REDCap instances.
- Selecting “all segments” visibly applies exactly the annotated region set, excluding urethra. Unselecting a required region clears that flag atomically. Record this dependent change in history.
- Any real edit or restore reopens affected sections and dependent confirmations, and invalidates affected field resolutions. Lesion count changes also reopen the lesion-completeness decision. Changes to evidence, issue identity or mark-to-lesion assignments invalidate dependent decisions even if the displayed value stays the same. Server and UI share these dependency rules.

### Evidence modal

The question-mark button opens a cached, structured explanation; opening it does not call a model. Contents, in order:

1. Field name, current value, original AI proposal if changed, and review status.
2. Source filename/kind and page, with an exact excerpt and surrounding text; open the original image at the cited page. Distinguish extracted text from the original scan.
3. A short explanation of the mapping: directly stated, normalized to a REDCap code, converted units, derived from reviewed values, or added by sector processing.
4. Confidence label and concrete reasons, such as “2 ze 3 průchodů”, conflicting alternatives, unavailable source, or uncertain lesion assignment.
5. Reviewer correction and relevant history, when present.

For sector evidence show the source sheet, relevant mark/sector identifiers and mapped lesion. A generated sector diagram is a visualization of the interpretation; keep the original sheet one click away.

Preserve each sector mark's identity and explicit assignment status. Reviewers can assign a mark to a lesion, reassign it, or dismiss it with a reason. Ambiguous and unassigned marks remain attention items until explicitly resolved. A region appearing on some lesion does not establish that a particular mark belongs to it; two marks touching the same region remain separate evidence items. Removing a lesion reopens its mark assignments. Dismissing a mark does not erase its evidence or history.

For missing or unsupported values explain the actual state: not documented, no exact dictionary code, ambiguous source, evidence unavailable, or legacy output. Example: explicitly written `pT2` has no exact current dictionary choice; show the excerpt and the reason for leaving `pt_surg` empty. Do not invent a citation for null or for reviewer-entered information.

Evidence can support several fields and a field can have multiple evidence items, including conflicting ones. A verified quote proves the text exists, not that its clinical interpretation is correct. Show concise evidence-based explanations, not hidden model reasoning.

Reuse the native `Modal` primitive. Verify keyboard access, focus restoration, Escape, readable mobile layout and independence of edit/source dialogs; avoid stacked modal traps.

### Lowest-confidence worklist

Add a compact “Vyžaduje pozornost” panel with counts and direct links to fields. “Další ke kontrole” advances through unresolved items. Filtering by flagged fields must reveal their parent section and preserve navigation.

Order attention items by:

1. Invalid values and missing required values that prevent approval.
2. Conflicting evidence, ambiguous lesion alignment and unassigned sector marks.
3. Low-confidence proposals and missing/unverified evidence for populated fields.
4. Medium-confidence proposals.

Use stable form order to break ties initially. Do not manufacture low-confidence flags by always selecting a bottom percentage of fields. Optional, correctly absent data should not dominate the worklist.

Reviewers can accept a flagged proposal, correct it, clear it, or leave it unresolved. Accepting a low-confidence value records a human decision without upgrading the original AI confidence. Conflicts or unsupported manual resolutions require a short note; routine confirmations do not. Required missing data cannot be resolved with a note alone.

Section confirmation does not silently acknowledge unresolved high-priority flags. Require an explicit decision for those items. Remaining sections can be confirmed together only through their own section action.

## 3. Confidence model

### Initial policy: explainable categories

Compute confidence server-side from versioned rules. Do not ask the model for an uncalibrated percentage and label it accuracy. Agreement among repeated calls to the same model is useful but correlated, and all passes share the same extracted input.

| Label       | Initial proposed rule                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High        | At least three passes were run and every pass is comparable and supports the final selected value; evidence is verified; no conflict, repair uncertainty, fallback or unresolved transformation affects it. |
| Medium      | Support for the selected value is a strict majority of all passes run and of comparable passes, with verified evidence and no high-priority issue; one/two passes qualify only when all support it.         |
| Low         | Tie/no majority, contradictory source evidence, uncertain lesion assignment, unverified support for a populated value, or unexplained postprocessing/fallback affecting the value.                          |
| Unavailable | Legacy output, absent diagnostics, failed evidence analysis or insufficient information to assess. Never display as zero or high.                                                                           |

These are implementation defaults to evaluate, not validated clinical thresholds. Policy precedence: conflicts/uncertain transformations override vote agreement. Unresolved lesion-count disagreement caps all affected lesion assessments at Low; unresolved lesion identity/alignment makes affected field comparisons Unavailable. Explicit reviewer resolution clears the review blocker but does not retroactively increase the original AI confidence. Distinguish confidence from validation severity: a confidently absent required date still blocks approval.

Store votes for the **selected final value**, alternatives and counts, comparable pass count, total pass count, selection method, evidence status and reason codes. For example, two matching eligible lesion passes out of three total passes must not be displayed as three-pass unanimity. With one configured pass, do not show “100%”.

Do not silently remove excluded or failed passes from the denominator. Record requested/completed pass counts and assessment availability; incomplete runs cannot receive High. For nine completed passes with lesion counts distributed 3/2/2/2, unanimity among the three eligible passes is only 3/9 support and cannot establish Medium or High. Incomplete or noncomparable evidence must produce explicit Low/Unavailable reasons rather than a smaller, reassuring denominator.

Handle current consensus edge cases explicitly:

- Different lesion counts exclude some passes from per-lesion voting. Show count disagreement separately and propagate it to all affected lesion assessments using the caps above.
- Matching array positions/overlapping regions do not prove lesion identity. Treat ambiguous matching as a collection-level issue and avoid confident field comparisons across unmatched lesions.
- A `closest` fallback can choose a value different from the field winner. Recompute selected-value support after fallback.
- Sector enforcement happens after voting. Preserve before/after values and rule/source references, and recompute the affected field assessment.
- A repaired mapping pass currently has only a pass-level flag. Retain repair diffs to identify affected fields; until available, disclose conservative repair uncertainty rather than claiming precise attribution.
- `SectorFocus.share` and `coverage` measure geometry, not probability of correctness. Never display them as confidence percentages.
- `all_sgm: false` and `sur_prostate_regions: []` can be absence defaults. Keep a provenance availability state so defaults are not described as explicitly documented negatives.

Avoid a single average confidence score for the case. Show unresolved low-confidence count, unavailable-evidence count and blocking issues. Later add these summaries to the review queue, with server-side filtering/sorting; do not fetch every mapping artifact in the browser.

### Evaluation before numeric confidence

Create independently reviewed examples with field values, source spans and lesion identity. Split evaluation by case, not field, to avoid leakage. Measure field accuracy by confidence band, errors captured by the flagged set, false reassurance among high-confidence fields, citation correctness, flag volume, review time, cost and mapping latency. Existing OCR CER/WER evaluation is useful infrastructure but is not field-confidence validation.

Use held-out examples before choosing numeric thresholds. If calibrated probabilities are later added, version the calibration and report sample sizes/uncertainty; a small hackathon set is insufficient to claim general calibration.

## 4. Evidence and mapping architecture

Add a typed, versioned evidence sidecar to `MappingOutput`; retain `record: SurgeryRecord` unchanged for downstream compatibility. Existing outputs without the sidecar must still parse and render with confidence unavailable.

This mapping contract is distinct from the editable draft contract. Extract shared field/object definitions before applying cross-field refinements: `ReviewDraftRecord` validates editable structure and individual values, while `SurgeryRecord` adds the semantic constraints required of mapping output and approved records. Review snapshots store `ReviewDraftRecord` plus structured validation results; approved snapshots contain a successfully parsed `SurgeryRecord`. Section confirmation checks all semantic rules touching that section, including dependent sections, and approval checks the complete record and export readiness.

Proposed contract entities:

| Entity                 | Main contents                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mapping provenance     | Schema version, mapping run ID, model/prompt/dictionary versions, extraction identities, artifact hashes.                                                  |
| Field reference        | Surgery field name or stable lesion ID plus field name; explicit collection reference for lesion count/alignment.                                          |
| Evidence item          | Document ID, pinned source/extraction identity, page, exact quote and text offsets; or sector page/mark/region references; evidence verification status.   |
| Sector mark assignment | Stable mark ID bound to document/extraction identity and page, original sectors, target stable lesion ID, assignment status and resolution reason/history. |
| Transformation         | Rule ID/version, input references and before/after values for normalization, conversions, derived counts and sector changes.                               |
| Field assessment       | Selected-value votes, alternatives, pass counts, confidence label, reason codes, evidence references, availability state.                                  |
| Review snapshot        | Mapping identity, current record, stable lesion IDs, field decisions, section confirmations, revision number and validation issues.                        |
| Field decision         | Decision and actor, bound field/value fingerprint, evidence/issue identities and versions, dependency fingerprint, and active/invalidated status.          |

Recommended evidence generation approach:

1. Add stable document/page identifiers to mapping input. Keep canonical extracted text unchanged and compute offsets against that representation.
2. Extend each structured mapping pass with compact field citations and availability reasons alongside the record. Use a separate mapping-response schema so evidence never becomes a REDCap field.
3. Validate document/page references and locate exact excerpts deterministically. Never accept model-supplied offsets without checking the quoted text. Ambiguous repeated quotes remain ambiguous until disambiguated; unsupported citations become explicit issues.
4. Preserve supporting and conflicting citations through consensus. Bind final field evidence to the value actually selected, including closest-pass fallbacks.
5. Attach deterministic provenance for transformations and sector additions after consensus; do not generate explanations that attribute these values to text alone.
6. Persist the sidecar with the immutable mapping artifact. Serve it through authorized case reads. Bound citation counts/text lengths and render all extracted/model text as text.

Preserve mark objects through `sectorMapMarks` and `applySectorMap` instead of flattening them into region arrays. Current `unplacedRegions` only checks whether a region appears anywhere in the multi-lesion record; it cannot prove individual mark assignment. Produce explicit assigned/unassigned/ambiguous/dismissed states and bind any added regions to their source marks. Keep automatic matching conservative for the first release; improved automatic matching can follow, but mark identity and reviewer resolution are part of the initial contracts and workflow.

Run a small mapping-quality/latency comparison before committing to the enriched pass format. If it damages extraction accuracy or exceeds the worker budget, use one bounded evidence-attribution pass against the frozen result and original sources. Such a pass cannot change the result and its citations still require verification; mark them as retrospective attribution. Do not silently adopt extra per-field calls.

Initial UI highlights exact spans in extracted text and opens original images. Precise image-region highlights are a follow-up: preserve OCR word boxes and their reading-order mapping, image dimensions/orientation and sector geometry first. Never draw a guessed rectangle as if it were measured evidence.

## 5. Persistent review, approval and export

Recommended storage keeps clinical payloads in immutable private S3 artifacts, consistent with the existing mapping path, and uses PostgreSQL for revision pointers, decisions/audit metadata and queue summaries.

- Introduce a review row per case with mapping identity, current revision/artifact pointer, approved revision pointer and summary counts.
- Store review snapshots under a dedicated case/revision prefix. A snapshot contains the corrected record, lesion IDs, decisions and confirmations. History links successive immutable snapshots; before/after views can compare them.
- Add metadata-only review events for save, field decision, section confirmation/revocation, approval and reopen, identifying actor, revision and affected field references. Keep clinical values and excerpts out of general logs.
- Extend API storage capabilities and narrowly scoped task-role permissions to write/read review artifacts. Persist version/hash references; never rely on a mutable latest object for approval/export.

Suggested API surface:

- `case.review.get`: current proposal, draft, assessments, decisions, issues and revision.
- `case.review.save`: typed edits/lesion operations with expected revision and request ID.
- `case.review.decideField`: explicit decision on a flagged field, optional/required note according to reason, bound to the current value/evidence/issue/dependency fingerprints.
- `case.review.assignMark` / `dismissMark`: assign or reassign an identified source mark to a stable lesion ID, or dismiss it with a reason; update dependent values, issues and decisions atomically.
- `case.review.confirmSection` / `revokeSection`: explicit section decisions tied to the reviewed content.
- Extend `case.approve` to require the expected review revision. Reuse `case.reopen` with preserved correction history.

Every mutation verifies ownership, case state, field allowlist, mapping identity and expected revision. Use idempotency keys so retries after a lost response do not duplicate revisions. Never allow arbitrary object paths or untrusted clinical payloads to bypass server validation.

On each mutation, recompute affected issue/dependency fingerprints and invalidate resolutions whose inputs changed. Expected-revision checks alone do not prevent a resolution from becoming stale across sequential edits. Restoring an earlier value does not resurrect an invalidated decision automatically. Preserve the original decision in history and require a new explicit resolution. Approval verifies active decisions against current fingerprints, rather than checking only that a decision once existed.

For saving an S3-backed revision: build and validate the candidate; write a uniquely keyed immutable object; then atomically compare-and-swap the revision pointer and append the event under the existing case lock. A losing concurrent save produces a conflict and an unreferenced artifact, not a lost update. Retain the local draft and offer reload/compare. Define cleanup for unreferenced artifacts. Avoid holding database locks during object-storage I/O.

Approval atomically checks:

1. The expected saved revision is still current and belongs to the current mapping baseline.
2. `SurgeryRecord` and export-readiness validation pass, including current required fields, conditional fields and dictionary bounds.
3. All required sections and lesion completeness are confirmed for the relevant content.
4. High-priority attention items, including sector assignments, have active explicit resolutions bound to the current value, evidence, issue and dependencies.
5. The approved revision/artifact hash is pinned with approver and timestamp.

Refactor upload validation to return structured field references/messages shared by UI and API; today many export errors are strings. Separate local readiness checks from remote REDCap preflight/record allocation. Approval must perform no remote write.

The approving client disables approval while it has dirty input or pending saves and identifies the saved revision being approved. The server guarantees approval of that exact saved revision; it cannot detect unsaved input in another browser. A stale tab's later save must fail once approval has locked the case.

Final review and `sendToRedcap` read the same approved snapshot. Continue using `toRedcapRows` and existing submission/receipt handling, including export locks, timeouts and unconfirmed-export protection. Hash the actual approved export payload. Never fall back to the original mapping when a review revision is expected.

Reopening an approved case preserves edits/history and clears approval. Subsequent changes invalidate relevant confirmations; a new approval pins a new revision. Exporting/exported cases stay locked. Corrected values remain marked as reviewed values; original AI evidence/confidence stays attached to the original proposal.

Required source information absent from the report remains a blocker if REDCap requires it. Allow manual entry with an explicit reviewer-supplied origin/note. Do not force the reviewer to invent a value to finish a section.

## 6. Delivery sequence

| Slice                                      | Deliverables                                                                                                                                                                 | Exit condition                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Contracts and field registry            | Shared field definitions, separate draft/approved schemas, current-schema sections, stable lesion/mark IDs, structured validation, decision fingerprints and version policy. | Every field is covered; draft saves permit temporary cross-field issues; approval rules reject them.                                        |
| 2. Read-only evidence and confidence       | Structured consensus diagnostics, source identities/citations, verification, transformation/mark provenance, confidence policy, evidence modal and attention navigation.     | Every assessment explains its basis; count/alignment uncertainty propagates; unavailable evidence is explicit.                              |
| 3. Review persistence and export integrity | Revision storage, ownership/concurrency/idempotency, decisions/confirmations with invalidation, mark resolution, approval gates and approved-snapshot final display/export.  | A corrected value survives reload and is exactly the value exported by mocked integration tests; stale decisions cannot authorize approval. |
| 4. Production review UI                    | Adapt PR #61 interactions to current sections, lesion/mark management, change history, save/error states, explicit issue resolution and section confirmation.                | Reviewer can complete a current-schema workflow without JSON editing, including ambiguous marks.                                            |
| 5. Prioritized review and rollout          | Attention panel, explicit resolutions, queue summaries, accessibility checks, legacy behavior and evaluation fixtures.                                                       | Lowest-confidence/unresolved issues are discoverable and approval cannot bypass them.                                                       |
| Follow-up                                  | OCR image highlights, improved lesion matching, calibrated numeric scores, richer history comparison.                                                                        | Ship separately once the source data and evaluation support the claims.                                                                     |

After slice 1, the read-only evidence/confidence slice can ship independently and provide the requested question-mark modal and prioritized flags earlier. It keeps existing lifecycle behavior and does not imply new persisted decisions or approval gates until slices 3–4 are enabled. Those slices can develop against the same contracts while slice 2 proceeds. Release persistent editing, explicit resolutions, new approval gates and approved-snapshot export together, behind one coherent feature gate if needed. Do not expose editable fields while export still reads the original mapping. Queue summaries and broader rollout remain slice 5.

The smallest coherent demo is one persisted corrected case with two lesions, a verified text citation, a sector-derived field, a disagreement flag, section confirmation and approved-snapshot export through a fake REDCap adapter. Full field coverage and real missing-evidence states remain required; the demo should not use fabricated confidence.

## 7. Verification and acceptance criteria

### Contract and mapping tests

- Registry covers 15 surgery fields and 14 fields per lesion, with dictionary-backed choices and correct Czech labels.
- Distinguish `null`, zero, explicit negatives, explicit “not specified”, `false` defaults and empty regions.
- Validate lymphadenectomy/count dependencies, positive versus examined counts, dictionary count bounds, date bounds, Gleason percentages and all-segment invariants.
- Persist a shape-valid draft with positive nodes exceeding examined nodes, then correct the examined count in a later save; reject the intermediate record for section confirmation and approval. Invalid individual types/codes/bounds still fail draft validation.
- Verify citations against pinned document/page text; reject invented quotes, wrong cases/pages and ambiguous offsets.
- Exercise 1/2/3-pass agreement, ties, different lesion counts, swapped/ambiguous lesions, closest fallback, repairs and post-consensus sector changes.
- Exercise nine passes with lesion-count support 3/2/2/2: three eligible agreeing passes cannot yield Medium/High. Count disagreement propagates to affected lesion fields; unknown alignment prevents field comparisons; excluded/failed passes remain visible.
- Confidence reflects the final selected value. Missing legacy diagnostics do not become high confidence. Geometric coverage never becomes a probability.
- Two distinct marks touching the same region remain independently identified and unresolved without defensible lesion assignments, even when that region already appears on a lesion.

### Persistence/API integration tests

- Edits, clears, restores, added/deleted lesions and decisions survive reload with intact original proposal/history.
- Stable lesion IDs keep evidence/decisions attached after deletion or insertion; exported instance numbers remain sequential.
- No-op saves preserve confirmation; meaningful edits and dependent edits revoke appropriate confirmation.
- Accept → edit → restore does not revive an old field resolution. Accept → mark reassignment invalidates dependent resolutions even if the region set stays unchanged. Approval rejects stale value/evidence/issue/dependency fingerprints.
- Assign/reassign/dismiss a mark with history; removing its target lesion reopens the assignment and related confirmation.
- Two-tab saves conflict cleanly; stale confirmation/approval fails; retrying a successful request is idempotent.
- The approving client blocks while dirty/saving; approval pins the expected saved revision; a different tab cannot save after approval and receives a conflict without losing its local input.
- Storage failure leaves no advanced revision pointer; database failure leaves at most an unreferenced artifact.
- Direct API approval cannot bypass missing required data, unresolved flags or unconfirmed sections.
- Final display, approved snapshot, payload hash and fake REDCap submission contain identical reviewed values.
- Reopen/approve/export races preserve existing locking and unconfirmed-export protections; unauthorized access fails for evidence as well as mutations.

### UI/browser scenarios

- A reviewer locates a low-confidence field, opens **?**, sees its real excerpt and disagreement, corrects it and confirms the section.
- A required missing operation date is visible and blocks approval; an optional missing field does not flood the attention panel.
- A sector-derived region links to the correct sheet and lesion; unresolved marks remain visible.
- A reviewer resolves ambiguous mark assignment or dismisses a mark with a reason; field decisions and section confirmations reopen when reassignment changes their basis.
- Adding/removing a lesion updates the diagram, derived count, validation, changes and section state together.
- Keyboard-only review, modal focus restoration, mobile layout, long Czech text and long `surgery_text` values work without clipped controls.
- Expired presigned URLs refresh; source failures show a recoverable evidence error without losing edits; save failures do not show “saved”.
- Approved/exported views remain readable but locked; unknown confidence never looks like approval.

Use synthetic fixtures for automated tests and mocked REDCap export. Run affected package checks and the repository's required checks after implementation; consult installed Turbo docs before changing its commands/configuration. This planning-only change needs document formatting/link checks, not application test runs.

## 8. Compatibility and explicit boundaries

- Existing mapping artifacts are immutable and may lack citations. Load them with “Původ/Jistota nejsou k dispozici”; require manual review decisions rather than fabricated backfill.
- Initialize new review sessions from legacy mapped cases lazily. For already approved/exported cases, preserve their historical record; do not rewrite them or silently claim they completed the new workflow. An approved legacy case must either reopen into the new flow or use an explicitly retained legacy path before export.
- Add sidecars and review tables before enabling the new UI. Older readers can continue reading the original record, but new approved exports must never revert to the old mapping path during rollback. Gate mutations/exports if a rollback cannot honor approved revisions.
- The current source inputs are JPEG report/sheet pairs, not a new PDF ingestion project.
- Surgeon/pathologist identity fields, medical inference beyond the current mapping rules, multi-user review assignment, document reprocessing and correction of already exported REDCap records are outside this expansion.
- If future reprocessing changes the mapping identity, create a new review baseline and explicitly reconcile changes; never carry old confirmations onto new proposals automatically.

Recommended defaults requiring no blocker now: preserve the current start-review action; Czech UI; modal editing; qualitative confidence; explicit acknowledgment of high-priority flags; section confirmation; no automatic medical inference. The main later product decisions are numeric confidence after evaluation, whether to add calibrated clinical-priority ordering, and the desired depth of image highlighting.

## Implementation progress — foundations (2026-10-17)

Implemented in commit `b99f43c` on `feat/review-foundations`, based on `main` at `633335d`. The first implementation increment adds contracts and validation in `packages/contracts`:

- Shared surgery/lesion field schemas and a strict `ReviewDraftRecord` allow temporary cross-field inconsistencies while rejecting malformed fields, invalid codes and individual bounds violations. `SurgeryRecord` retains semantic checks; `ReviewReadyRecord` additionally requires local export readiness. Readiness is not workflow approval.
- The dictionary-backed Czech field registry covers all 15 surgery fields and 14 lesion fields. Stable review field/section references distinguish each lesion and the explicit lesion-completeness decision.
- Versioned snapshots validate a one-to-one relationship between lesions and stable review IDs; IDs stay outside the clinical payload and sequential export instances.
- Export validation now returns structured issue codes and field/instance references alongside the existing messages. Review validation converts these references to stable lesion IDs without parsing messages or contacting REDCap.
- Decision/fingerprint and dependency routines were initially prototyped, then removed after the architecture review because no production mutation consumed them. Their requirements and acceptance tests remain in sections 2, 5 and 7; implement them alongside real review mutations and approval checks. Current production contracts cover fields, stable references, drafts, snapshots and readiness.
- Snapshot and validation-policy versions remain explicit. Future persisted decision/dependency versions must be introduced with their actual storage/command consumers rather than as an independent workflow framework.

This increment does not activate persistent editing, workflow confirmation/approval gates or approved-snapshot export. Evidence/confidence generation and sector-mark assignment contracts remain subsequent work. The current lifecycle and export source remain in use until the persistence/UI slices can be released together. The readiness schema must not be used as a substitute for ownership, concurrency, confirmation or active-resolution checks in the future approval service.

Verification at the first-increment commit: all 47 contract tests passed, as did `pnpm check` (37 tasks) and the commit hooks. This is the contracts/validation foundation of slice 1, not completion of the entire expansion. The adversarial Luna review found two correctness issues, both addressed before increment 2 and committed in `de8871e`:

- Preserve the legacy `SurgeryRecord` decoder's original date/count/collection permissiveness so existing mapping artifacts remain readable. Apply stricter dictionary bounds at draft/readiness validation instead.
- Reject surrounding whitespace in opaque review IDs; use validated snapshot IDs when producing validation references so issues and persisted decisions cannot point to different identities.

The regression tests also exposed a readiness `safeParse` exception after a nonfatal draft-bound failure. The semantic refinement now skips malformed drafts, preserving Zod's normal validation result. The reviewer found no further concrete defects. These fixes deliberately keep the existing record decoder and the new review validation boundary separate.

## Implementation progress — read-only evidence/confidence (2026-10-17)

The second increment implements the read-only path from mapping to field explanations:

- Consensus now emits typed diagnostics for every selected field and the lesion collection: actual selected-value support, candidate values/counts, comparable/completed counts and selection/fallback reasons. Count disagreement propagates to lesion fields. Multi-lesion comparisons require conservative, unique, disjoint region identities; uncertain comparisons report zero comparable passes instead of positional certainty. A shared region-set comparator keeps votes and evidence binding consistent without changing displayed region order.
- The worker carries document IDs, source object versions and SHA-256 identities of the loaded extraction bytes. Pinned prompt pages preserve canonical text and explicit document/extraction/page identities. Legacy unpinned callers remain supported with unavailable provenance.
- A versioned `MappingReview` sidecar is embedded in `diagnostics.review` inside the existing immutable private mapping artifact. This reuses its authorized read path and avoids a separate storage/API workflow. It includes stable mapping-local lesion IDs, pinned pages, field assessments, verified/unverified/conflicting evidence, independent sector marks and deterministic before/after transformations. Invalid or missing sidecars do not prevent the clinical record from being displayed; failed evidence analysis does not fail an otherwise valid mapping.
- Exact quote verification rejects invented excerpts, wrong source versions/pages, bad offsets and ambiguous repeated quotes. Persisted verification claims are checked again against the pinned text. Quote verification establishes text existence, not clinical interpretation. Confidence is computed with a versioned qualitative policy; incomplete runs, repairs, count/alignment uncertainty, conflicts, invalid citations and sector processing prevent reassuring labels. Geometric coverage is never used as a probability.
- Every source mark retains a separate identity bound to its document, source version, extraction, page and position. Multi-lesion region overlap alone never establishes an assignment. Single-lesion enforcement retains source mark references; postprocessing recomputes support for the changed final value and records its previous value.
- The Czech review display adds field question-mark buttons, a native read-only evidence modal, concrete vote denominators/reasons, source-document links and a compact attention worklist. Blocking local validation issues come first, followed by conflict/alignment/mark issues and instrumented low-confidence values. Missing or deliberately uncollected provenance is summarized once as unavailable, rather than presented as per-field risk. Optional absent values and absence defaults do not flood the worklist. Evidence remains readable in final review; malformed, stale and legacy sidecars fall back to explicit unavailable states.

Citation generation is enabled in the production worker through the `MAPPING_CITATIONS` Lambda variable (`"true"` in `infra/environments/demo/case-mapping.tf`; the handler default is off). Before enabling it, `packages/mapping/scripts/evaluate-citations.ts` was run on 17 October 2026 against two pinned production cases with `gpt-5-mini`, three passes each, four runs in total. The single-lesion case cited 9–11 of 15 assessed fields with 27 verified and 0 rejected excerpts in every run; one of three runs moved an unstable Gleason percentage between secondary and tertiary, which the enriched artifact surfaced as medium/low confidence instead of hiding it. The five-lesion case produced no usable evidence because most fields carried lesion-alignment uncertainty, which is the same unavailable outcome as without citations. Enriched mapping took 50–85 s versus 25–54 s for the baseline and roughly 2.8× the output tokens, well inside the 600 s function timeout. The script runs baseline/enriched mappings sequentially, records latency, record differences, repairs and citation-verification counts, and writes a private evaluation artifact with mode `0600`. Example from `packages/mapping`: `pnpm evaluate:citations <pinned-documents.json> <private-output.json> [model] [passes]`. Artifacts mapped before this change remain immutable and keep disclosing uncollected provenance.

Persistent corrections, manual mark assignment/dismissal, explicit review resolutions, section confirmation, new approval gates and approved-snapshot export remain slices 3–4 and must still ship together. This read-only increment preserves the existing lifecycle and export source. Precise scan overlays and broader rollout remain deferred.

Verification at commit `94cec14` included 60 contract tests, 23 mapping tests and six web helper tests. Synthetic desktop browser checks covered a two-lesion case, exact excerpt/source/version display, deduplicated evidence, distinct ambiguous/unassigned marks, required-date prioritization, legacy unavailable states, and native modal Escape/focus restoration. Mobile browser layout and live source-link authorization/expiry scenarios still need rollout QA against a deployed test environment; unit checks and existing authorized source reads remain in place.

Repository verification: `pnpm check` passed all 37 tasks after integration. Citation generation remains gated pending the separate model-quality/latency evaluation described above.

## Architecture review and simplification (2026-10-17)

Two independent Luna reviews examined the implemented changes from `633335d` through `94cec14`: one focused on mapping/contracts and sources of truth, the other on UI/component reuse and unnecessary framework code. The following findings were addressed:

- **Valid long citations could discard the whole sidecar.** The quote limit was 2,000 characters, but the context schema allowed only 240 even though the verifier preserved the quote plus 80 characters on either side. The compatible bound is now 2,160, with a long-quote regression test. Evidence-build failures still preserve the clinical record and now report a nonclinical failure category rather than hiding every failure behind one warning.
- **Disabled instrumentation was being presented as low confidence.** Disabled citation collection now remains distinguishable from an enabled pass returning no usable citations. The former produces an explicit unavailable state and one neutral count in the UI. Actual conflicts, lesion count/alignment issues, unassigned marks, invalid/required fields and instrumented low confidence remain attention items. Citation generation stays disabled pending evaluation.
- **The same decisions were derived in multiple places.** Field enumeration, identity keys, region-value comparison and validation-to-field references now live in shared contracts. The UI consumes those helpers instead of reconstructing REDCap paths or maintaining another field registry. Zod's `keyof()` supplies field enums directly. Evidence status is derived once for construction and validation; confidence policy is checked centrally. Alternative vote counts must sum to comparable passes and agree with selected-value support, preventing contradictory summaries.
- **Citation parsing and view construction did unnecessary repeated work.** A reusable verifier validates/indexes pinned documents/pages once per artifact. The client validates the sidecar at the TanStack Query fetch boundary, so query caching handles reuse. The existing React Compiler handles derived field/attention calculations; no separate manual memoization layer is added.
- **The review page had become a mixed module.** Fetching/layout, attention navigation, the evidence modal and value formatting are now separate pieces. They continue to use the existing native `Modal`, `Button`, `Badge`, `Card` and `SectorDiagram`. The reviews found no existing field editor or medical formatter that had been wrongly replaced, and no justified need for a new dependency.
- **Future workflow code had no consumer.** Unused decision/fingerprint/invalidation and dependency-policy implementations and their implementation-only tests were removed. The custom general JSON canonicalizer was also removed; current field comparison uses native JSON serialization with the region ordering rule. Persistent review will introduce decision behavior together with commands that consume and enforce it.

Verification after the architecture fixes: `pnpm check` passed all 37 tasks, including 56 contract tests, 24 mapping tests and nine web helper tests. The web production build and mapper-module import smoke check also passed. Removed tests exercised the deferred framework rather than an active workflow; the historical totals above describe the earlier commits. No new browser QA, live model evaluation or REDCap access was performed during this cleanup.

## Implementation progress — saved review backend (2026-10-17)

The first part of the persistence slice now has real API/storage consumers, without enabling editable UI or inventing a separate workflow framework. `ReviewService` is injected through the existing application/request context alongside the case/document services:

- `case.review.get` verifies ownership and returns the immutable proposal, saved draft (if any), stable lesion IDs, current revision, local validation issues and read-only state. A read does not create database rows or rewrite legacy artifacts. Sidecar-to-record validation is shared by the API and web client.
- `case.review.save` accepts a bounded batch of typed surgery/lesion field updates and lesion insertions/deletions, the mapping identity, expected revision and request UUID. Unknown fields/paths and invalid individual values are rejected; explicit nulls and zeroes survive. Cross-field inconsistencies can be saved as drafts and remain visible as validation issues. Legacy proposals outside draft bounds stay readable; their first save must repair those bounds.
- Stable IDs from a valid mapping sidecar become the review baseline; legacy cases use deterministic mapping-local IDs. Surviving lesions retain IDs across deletion/insertion, and deleted IDs stay retired in the private snapshot so they cannot be assigned to new lesions. Original mapping values and evidence stay unchanged.
- `app.review_revisions` stores append-only metadata: actor/time, request ID/hash and the artifact key/version/SHA-256. `app.case_reviews` contains only the current-revision pointer, with a composite foreign key to its receipt. Sequential revisions preserve correction history without copying clinical values into database audit rows. Validation issues are derived using the shared validators rather than persisted as a second source of truth. Each successful save, including a no-op edit, currently creates a revision; future confirmation invalidation must compare actual inputs, not revision numbers alone.
- Saves validate a candidate and conditionally write a unique private `reviews/<case>/<revision>/<uuid>.json` object before taking the existing case-row lock. The transaction checks ownership, editable state, baseline and expected revision again, then appends the receipt and advances the pointer atomically. Storage I/O never holds the database lock. Reads request the exact S3 version and verify its byte checksum before decoding; a bad saved artifact fails without falling back to the proposal.
- Same-request retries return the original saved snapshot even after newer revisions exist; reusing an ID for different input conflicts. Competing saves cannot overwrite each other. Failed storage leaves the pointer unchanged; failed/conflicting database writes leave at most an unreferenced artifact. Metadata rows double as save audit and idempotency receipts, rather than introducing another event store.
- The migration adds database guards for append-only receipts, sequential/retained pointers, owner attribution and editability. Both the API and database reject legacy approval once a saved review exists: corrections must not silently export the original mapping. Unmodified/previously approved legacy cases retain the existing path. A save racing with legacy approval rechecks the locked state and fails if approval won.
- The existing API task policy now grants read/version-read/write only under `reviews/*`; no delete/list permission is added for review artifacts. This change does not deploy infrastructure or run migrations against a shared environment.

At commit `ccfb031`, decisions/confirmations and revision-based approval/export were still pending. Decisions and confirmations are implemented in the following increment. Interactive editing remains disconnected until source-mark resolution, revision-based approval and final-display/export pinning are complete. A case saved through the new API cannot use legacy approval while the remaining workflow is being built.

Orphan retention: keep all objects referenced by `app.review_revisions`, including historical/idempotency receipts. A future maintenance job may inventory `reviews/*` with separate administrative permissions, compare keys/versions against committed receipts and delete only unreferenced objects older than a generous in-flight-save grace period (at least 24 hours). Do not apply a blanket prefix-expiry policy: it would also remove committed history. No cleanup job or broad production delete permission is introduced here.

Verification includes new API/storage unit checks and synthetic PostgreSQL integration tests using a nonsuperuser application role and fake S3/REDCap implementations. Scenarios cover save/reload, clears/zeroes, two-tab conflicts, simultaneous identical retries, failed writes/transaction rollback, stable lesion IDs, immutable metadata, legacy repair, approval races and corrupt artifacts. The existing export integration test also runs against the new migration. `pnpm check` passed all 37 tasks, including the API build, 30 API unit tests, 56 contract tests, 24 mapping tests and nine web helper tests. The targeted review/export PostgreSQL run passed all 12 tests. This database-only harness is not a full container/HTTP test run. No live model calls, REDCap access or browser behavior changes are part of this increment.

## Implementation progress — decisions and section confirmation (2026-10-17)

A single adversarial Luna review of `ccfb031` found no concrete defect in save concurrency, idempotency, ownership, immutable review artifacts or approval races. It identified a prospective consistency gap: the mapping baseline was identified only by object key. This was addressed before binding workflow decisions to that baseline:

- New review revisions capture the mapping object's exact S3 version and SHA-256, retain that identity on subsequent revisions, and load the proposal using that pinned identity. An overwrite of the mapping key does not change a saved review's proposal or decision basis. Versioned reads reuse the existing bounded storage-read path. The existing private `mapping/*` version-read permission suffices.
- Older immutable review artifacts decode with an empty workflow and no invented decisions. Their next new mutation captures the currently available mapping version. This cannot retrospectively establish the bytes used by historical unpinned revisions; it establishes the baseline for new decisions. Workflow-bearing artifacts require a pinned baseline.

The next backend workflow step now has real mutation consumers:

- `case.review.decideField`, `confirmSection` and `revokeSection` use the same case ownership/state checks, expected revision, immutable artifact write, transactional pointer advance and idempotency receipt as `save`. Action-aware hashes prevent reusing a request ID across different commands; old save request hashes remain compatible. Decisions require an existing saved revision.
- Field decisions record the authenticated actor, event ID/time/revision, reference, note and server-derived accept/correct/clear action. Manual corrections/clears and source conflicts require a note. A note cannot resolve required blanks or other local validation failures. Human decisions do not upgrade original model confidence.
- A versioned workflow policy binds decisions to the current field/dependency values, local issues, validation policy and pinned evidence identity. Region order uses the shared semantic comparator. Surgery-text changes affect every field; node decisions depend on pN, staging/histology also depend on lesions, and lesion decisions include lesion completeness and relevant surgery histology/staging inputs. The grouping is intentionally conservative, while operation confirmation survives unrelated node edits.
- Every real mutation records invalidation when a binding changes. Invalidation is permanent history: restoring a value cannot revive an earlier decision/confirmation. No-op saves and reordered region arrays preserve valid bindings. Explicit replacement of a field decision reopens a section confirmation that depended on the old decision. Deleted-lesion bindings become inactive.
- Four surgery sections, each live lesion and the lesion-completeness collection have independent confirmation records. An empty collection is explicitly unconfirmed until reviewed. Confirmation checks relevant local errors, active explicit field decisions and unresolved source marks. Field acceptance cannot dismiss a source mark or substitute for mark assignment.
- The read API returns workflow history plus server-derived field requirements and section status. Fingerprints and confirmation eligibility are derived from the same policy used by mutations. Pinned evidence is parsed once per request and reused while checking/invalidation runs; clinical notes/history stay in private artifacts, with the existing revision rows providing metadata receipts.
- Workflow schemas reject duplicate event IDs, multiple active bindings for one reference, inconsistent invalidation metadata and events beyond the saved revision. Existing SQL revision/approval guards remain unchanged. There is no new table, framework, model call or UI workflow in this increment.

Verification covers saved decisions/confirmation reloads, no-op/unrelated edits, dependent pN edits, edit → restore, explicit revocation, required-data and note gates, empty lesion completeness, stale commands, cross-command request reuse, concurrent identical decision retries, a decision losing a race with an edit, region reordering, evidence identity changes, source-mark blockers, legacy decoding and mapping-key overwrite. The increment’s follow-up Luna review found one gate bug: a null optional field could bypass conflict resolution because uncertainty was checked only for populated values. Conflicts/high-priority flags now require a decision and remain in the attention list even for null values, with API and web regression coverage. `pnpm check` passed all 37 tasks, including 34 API unit tests and ten web helper tests; the targeted PostgreSQL review/export run passed all 15 tests. Luna verified the null-conflict fix and found no remaining concrete issue in that pass. No live REDCap access or writes are used.

## Implementation progress — source marks and approved-revision export (2026-10-17)

The remaining backend integrity path is implemented:

- Assignment/reassignment/dismissal commands address a pinned source mark and stable live lesion ID and require a note. Private immutable revision artifacts retain the independent event history. Source marks remain separate when they share a region. Deleted targets and explicit removal of assigned regions reopen the assignment.
- Region ownership separates original/manual regions from automatic mark contributions. Reassigning or dismissing one mark removes only its contribution, preserving other marks and manual additions. Manual region edits own their added delta, not unchanged automatic regions. Selecting all segments explicitly owns the entire annotated set; removing a region clears the all-segment flag atomically. Deleted original lesions can be explicitly restored in original order with their identity/history, while prior decisions and mark assignments remain reopened.
- Workflow policy 2 binds relevant decisions/confirmations to effective mark state, the latest resolution identity and manual-region ownership, including value-neutral reassignment. Policy-1 history remains readable but cannot masquerade as current confirmation; it is invalidated on the next mutation. No-op semantic region reordering still preserves confirmation.
- `case.approve` accepts an expected saved revision. The server reads the pinned artifact/evidence, checks local readiness, all section/completeness confirmations and active field/mark resolutions, then rechecks ownership/state/revision under the case lock. Approval atomically pins that revision in `app.case_reviews`; an exact retry is idempotent. The existing legacy path remains available only for cases with no saved review.
- Migration `0017_review_approval` adds a same-case approved-revision foreign key and guarded approval/reopen transitions. Approved heads cannot advance. Reopening clears the approval pointer while preserving revisions/history. The read service selects the approved pointer after approval/export starts and fails closed if it is missing.
- Export claims the exact approved artifact key/version/hash under the existing lock, validates that identity and sends that record through the existing serializer/hash/REDCap client. It never falls back to original mapping for a saved review. Existing export locking, receipt retention, unconfirmed-result handling and legacy export behavior remain in use.
- Initial clients can send the baseline identity returned by `review.get`, so a mapping-key overwrite between the first read and first save cannot change their selected baseline. Subsequent saves reject a conflicting baseline identity. Older save requests remain compatible.

A Luna review found an all-segments ownership edge case: dismissing a mark could remove a region already present when the reviewer selected all segments. The explicit-all ownership fix and value-neutral ownership binding were added with regression tests; Luna verified the fix and reported no remaining concrete defect in that pass. Targeted integration proves corrected two-lesion save → source resolution → field decisions → section confirmation → exact approval → reopen/reapproval → final read/fake export/hash, including original-key overwrite and shared-mark contributions. `pnpm check` passed all 37 tasks, including 38 API unit tests; the targeted nonsuperuser PostgreSQL review/export run passed all 16 tests. No live REDCap access was used.

## Implementation progress — editable reviewer UI (2026-10-17)

The reviewer page now reads the authoritative saved workspace for both review and final display. The UI connects typed field editing (Czech decimal input, incomplete-date guard, clear/restore and cross-field previews), stable lesion add/delete/restore, field decisions, source-mark resolution, independent section confirmations, the current unresolved worklist, a changes-against-proposal panel and revision-pinned approval. Original proposal values and decision history remain visible beside current values; approval is disabled while an editor or mutation is active. The existing modal, field rows, evidence view, sector diagram and source-document panel are reused; three thin daisyUI wrappers (`Checkbox`, `Select`, `Textarea`) were added to `src/ui` and their raw classes to the lint map.

Workflow mechanics decided in this increment:

- Entering an editable review at revision 0 saves the unchanged proposal as revision 1 without a toast. Decisions and confirmations therefore always have a saved baseline, and a failed first command cannot present a self-caused revision change as a conflict. The save contract accepts an empty operation batch only at revision 0.
- Review actions capture the revision, baseline and a request ID per command; a lost response is replayed once with the same request ID so the server deduplicates it. Mutation failures refresh only the review workspace, so an editor with typed input is not unmounted by a case-stage switch. Server rejections are translated by message to Czech; conflicts tell the reviewer the input is preserved rather than asking for a reload.
- Editors disable save when the parsed value equals the saved value, because every save mints a revision and an unchanged `all_sgm: true` save would re-own the whole region set and invalidate confirmations. The unchanged check compares against the revision being saved, also after a rebase.
- The mark dialog starts from the mark's current assignment and requires an explicit choice; dismissal is never the default. Closing any editor or dialog returns keyboard focus to the field row, the lesion-completeness heading or the marks heading. Non-dismissible dialogs reopen when Chromium's close-watcher bypasses the cancel handler on a repeated Escape.

Verification. Synthetic desktop browser checks against the API-backed harness (fake S3, real PostgreSQL, no REDCap) covered: automatic first revision, edit → toast → changes panel and per-row original value, disabled no-op save, double-Escape keeping input, decision with required note, mark assignment through the explicit selector, bulk decisions and confirmations through the API, approval of the pinned revision from the page, read-only final display with the corrected value, reopen, and focus restoration. Mobile layout was deliberately not checked. Unit checks: 16 web helper tests (numeric parsing, editor operations including the lymphadenectomy dependent clear, change detection, Czech error mapping), 56 contract tests, 38 API tests, 24 mapping tests; web, API and contracts lint and typecheck, Prettier, knip, root typecheck and Turbo boundaries pass. `pnpm check` at the root only fails on the gitignored harness files under `.local/`, which ESLint parses; lint was run with those ignored.

An Opus review of the increment reported thirteen findings. Addressed: misleading error wording for input and service rejections; editor input lost when a failed mutation switched the case stage; the mark dialog defaulting to dismissal; no-op saves enabled; the double-Escape bypass; focus loss after add/delete/restore/mark dialogs; the false conflict after a failed bootstrapped first command; request-ID reuse never applying after a lost response; "Další ke kontrole" skipping items after the list shrinks; the unchanged hint comparing against the opening value after a rebase; incomplete dates silently clearing the field; the lymphadenectomy clear not naming the affected counts; empty saves accepted at any revision; unused exports, duplicated change checks and the missing lint-map entries. Left as follow-ups: moving the `all_sgm` normalisation into contracts so the editor preview matches the server for region edits, and the `case.get` focus refetch, which can still switch the stage under an open editor if another tab approves (the editor then shows the read-only error but is unmounted).

The increment was committed as `515b2e5`.

## Whole-implementation review and hardening (2026-10-17)

The single whole-implementation review (Opus) covered the branch from `main` through the committed UI increment. It found no server-side concurrency or idempotency defect but reported fifteen items; the following were addressed in the next commit:

- **Revision-0 deadlock.** The automatic first save is rejected when the proposal violates draft bounds (for example a node count above the dictionary maximum). Field editing now stays enabled at revision 0 so the first real save carries the repair; decisions, confirmations, mark resolution and approval wait for revision 1, and the page explains this when the bootstrap fails.
- **Approval bypass.** `case.approve` now requires the expected saved revision; the legacy path that approved an in-review case without any review check is no longer reachable through the API.
- **Rollback export guard.** Migration `0018_review_export_guard` adds `cases.export_review_revision`, set by the export claim to the approved revision, and a trigger that rejects any export claim on a case with a saved review unless it names the approved revision. An older API image rolled back to the original-mapping export path can no longer export uncorrected data. The approved-case immutability guard whitelists the new bookkeeping column. Integration coverage replays such a claim and expects rejection.
- **Prompt gating.** Document/extraction/page headers are added to the mapping prompt only when citations are enabled, so the production prompt is unchanged from `main` and the citation evaluation's baseline arm measures the real baseline.
- **Decision policy with citations off.** Decision requirements are now derived by one shared contracts helper used by the API workflow and the web worklist. Conflicts and alignment uncertainty always require a decision; low confidence requires one for populated values; provenance that was deliberately not collected (the production default) or is absent on legacy artifacts is covered by section confirmation rather than one decision per field. Fields of an added lesion count as corrections only when they hold a value, so empty fields no longer demand a note each.
- **Stored artifacts decode permissively.** Saved revisions are read with a versioned envelope and a record schema without dictionary date/count bounds, so a dictionary refresh cannot make history or approved exports unreadable; new writes still validate strictly and bound violations surface as issues.
- Smaller items: restored original lesions seed their manual regions from the sector transformation so a later mark dismissal still removes its contribution; the evidence modal numbers lesions by the current workspace; `surgery_text` and `histol_post_surg_specify` are bounded and the tRPC endpoint has a 1 MB body limit; fail-closed tRPC errors are logged with path and code only; `review.get` no longer ships the evidence twice; the empty-workflow literal and the conflict reason list live in contracts; stale comments were removed.

Left as follow-ups: reason codes remain bounded strings rather than an enum; `ReviewService.mutate` should be split into a pure command application and a storage shell; approval audit rows do not carry the approved revision; review errors are translated by server message rather than stable codes; server-computed attention and a slimmer workspace view remain possible; the `all_sgm` normalisation could move into contracts for the editor preview. Mobile layout stays out of scope by decision.

Verification after hardening: all package lints, typechecks and unit tests pass (contracts, mapping, db, API, web, case-mapping), as do Prettier, knip, root typecheck and Turbo boundaries with the gitignored harness files excluded from lint. The nonsuperuser PostgreSQL review/export integration run passes all 16 tests against migration 0017. Committed as `99a7a91`. Citation generation remains gated on the separate model-quality/latency evaluation; live REDCap writes remain excluded.

## Implementation progress — review queue summaries (2026-10-17)

Slice 5's queue summaries are persisted rather than derived in the browser. Every successful review mutation writes four counts next to the revision pointer in `app.case_reviews` (migration `0019_review_queue_summary`): blocking validation issues, fields still requiring a decision, unassigned or ambiguous source marks, and unconfirmed sections. They are computed from the same workflow view the server uses for confirmation and approval gates, so the queue and the workspace cannot disagree. `case.reviewQueue` joins the pointer row and returns the counts with the current and approved revision; cases in review without a saved revision report no summary. The queue page shows "Bez uložené revize", the open counts as badges, or "Připraveno ke schválení" when nothing remains. No review artifact is read to build the list. The integration test checks the persisted counts against the workspace view after a section confirmation.

The branch was then rebased onto `main` (batch upload and the pill switch, #84 and #89). The workspace adopted main's card-level container query, so the form and sidebar sit side by side only when the card is wide enough and the sidebar comes first otherwise. The web unit tests moved to `apps/web/tests/`, which is the directory main's test script now runs. A small accessibility pass added a visible focus ring on the field rows that receive focus after a dialog closes, `aria-invalid` and `aria-describedby` on editor inputs with an error, and a tooltip on the disabled approval button naming what is still missing.

Remaining slice 5 work: evaluation fixtures for the confidence policy. The follow-ups listed after the whole-implementation review remain open. The branch is otherwise ready for a pull request; migrations 0016–0019 run at API startup on deployment.

## Scope correction and PR review fixes (2026-10-17)

The active UI and workflow now expose lesion fields and lesion completeness only.
`toRedcapRows` omits parent clinical and lesion-count fields; submission adds
`surgery_c61_resected_lesion_complete=2` only to lesion rows. Generic explicit-parent
upload validation remains available for compatibility, while the production path
omits it. Parent blanks, legacy long text and parent dictionary bounds therefore
cannot block a lesion correction or readiness. Explicit legacy parent-edit commands
still enforce their input bounds.

Validation policy 2 and workflow policy 3 bind decisions to this scope. Stored
workflow versions 1 and 2 remain readable, and prior decisions/confirmations are
reevaluated against the current policy. New mapping evidence covers lesion and
collection references; legacy complete parent-plus-lesion evidence remains readable.
Count disagreement now requires a collection decision even when consensus selects
zero lesions with citations disabled. A citation conflicting with a losing pass's
value no longer counts as a conflict with the selected value.

## Integration with case sharing (2026-10-17)

Review migrations are numbered 0016–0019 after main’s 0015 sharing migration. Their timestamps are later than 0015 so an existing deployment applies them. Shared reviewers can read, save, decide, confirm and approve; viewers can read the workspace but cannot mutate or replay review commands. Both the service and revision trigger enforce this access. Export remains owner-only, and audit events retain the acting reviewer.
