# Hackathon intake — 16 October 2026

## Inputs

Source download is in `~/Downloads/transfer_339591_files_2888814b`.
The FileSender listing and local outer ZIP both contain exactly two archives:

| Archive         | Contents                                      | Role                                |
| --------------- | --------------------------------------------- | ----------------------------------- |
| `scan_text.zip` | 40 JPEGs, `Scan_0001.jpg`–`Scan_0040.jpg`     | Scanned Czech pathology report text |
| `schema.zip`    | 40 JPEGs, `Schema_0001.jpg`–`Schema_0040.jpg` | Hand-annotated prostate diagrams    |

These are **40 paired cases**, each with a report image and a diagram image.
There are no separate TXT, DOCX or PDF files in either archive. Both folders are
now extracted. All 80 JPEGs decode successfully and have distinct SHA-256 hashes.
Reports measure 2435–2461 px wide; diagrams 2467–2469 px wide.

The filenames provide matching numeric keys. Printed case labels are `Rakathon1`
through `Rakathon40` in the contact sheets; the first pair was also inspected at
full size. Verify printed labels during ingestion; do not assume these are the
REDCap record IDs. Do not treat 80 images as 80 independent patient records.

Local, gitignored working artifacts:

- `.local/hackathon/input-manifest.json`: dimensions, paths, sizes and hashes.
- `.local/hackathon/pairs.json`: 40 report/diagram pairs; REDCap IDs unresolved.
- `.local/hackathon/scan_text-contact.jpg` and `schema-contact.jpg`: visual indexes.

## REDCap target

Authenticated browser access as `siposf` confirmed to **COMPARE pro Rakathon**,
project **64**, REDCap **17.3.7**, in development mode. The Codebook is accessible
without an API token and lists **363 fields in 9 instruments**.

Current scope, clarified on 17 October 2026: the required export target is
`surgery_c61_resected_lesion`, the **repeating** instrument for lesion-specific
regions, dimensions, histology, invasion and Gleason grades/percentages.
Parent `surgery_c61` clinical fields are outside active extraction, review,
readiness and export. The legacy `surgery` object remains readable; new mapping
instructions keep its values null. Missing parent metadata must not block the
lesion workflow. Historical parent-form observations below are retained as context.

The region field is `sur_prostate_regions` with checkbox export names such as
`sur_prostate_regions___pzpl_apex_rs`. Preserve laterality, apex/mid/base and each
lesion separately. Other instruments cover patient details, urology, biopsy,
laboratory markers, MRI, MRI quality and other procedures.

Observed examples of actual codes: `extracaps_ext` and `perineural_inv_sur` use
1=Yes, 2=Uncertain, 3=No, 4=Not specified. `classify_r_surg` uses 1=R0, 2=R1,
3=R2, 4=RX. Never apply a universal yes/no encoding across fields.

**Historical parent-field observation:** report 1 states `pT2`; `pt_surg` offers
pT2a, pT2b and pT2c, with no unsuffixed pT2 option visible. This field is outside
the current target and does not create a review or export requirement. The original
report remains available; no substage should be invented.

The API token is approved and stored with owner-only permissions. Direct API
access is now working through the read-only MCP using the browser's existing,
user-validated gateway session cookies. No REDCap login-session cookie is used.
Live MCP verification retrieved 354 metadata fields (363 Codebook fields including
9 generated completion fields), 9 instruments, 20 record IDs and a filtered
single-record export. The repeating-settings API returned HTTP 404; Codebook
still identifies which forms repeat. Gateway validation may require renewal.

## Local adapter

[`tools/redcap/README.md`](../tools/redcap/README.md) documents the implemented
stdio MCP server and equivalent CLI. It exposes configuration status, project
info, dictionary, instruments, events, repeating settings and filtered record
exports. Eight tests pass, including a real MCP subprocess handshake and tool call,
project mismatch rejection, mutation rejection, unfiltered-export rejection,
token redaction, gateway CAPTCHA detection, private cookie refresh and rejection
of login cookies/header injection.
No REDCap records or project definitions have been changed.

## Paired-input inspection and conversion plan

Reviewed both 40-case contact sheets and report/diagram pairs 1, 2 and 27 at
readable resolution on 16 October 2026. This is a scope review, not a complete
annotation of all 40 cases. Treat each pair as one case with separate report and
diagram document roles. Both sources may contribute to the same lesion.

The template contains longitudinal views, Base/Mid/Apex sector views, seminal
vesicles and urethra. Marks include coloured outlines, handwritten measurements
and P/L orientation labels. Orientation differs between views; image-left alone
does not identify patient-left. One lesion can appear in several views, so do not
count outlines as independent lesions. Pair 2 demonstrates distinct dimensions
and Gleason percentages for different lesions, alongside a case-level conclusion.
Preserve the scope of each finding and flag disagreements between sources.

Conversion order:

1. Define a report/diagram coverage matrix for `surgery_c61_resected_lesion`.
   Record direct evidence, source scope, exact REDCap choice mapping, missing
   information and mapping gaps.
2. Extract per-lesion regions, dimensions, histology, invasion and Gleason findings.
   Preserve supplementary findings in the source documents without adding parent
   fields to the target. Keep unsupported values nullable with diagnostics.
3. Version the Zod mapping/reference contracts and update codegen and fixtures.
   Do not copy global grades or invasion findings to every lesion automatically.
4. Serialize the record identity to one base row and the agreed lesion fields to
   stable numbered repeating lesion rows. Expand region checkboxes to exact dictionary codes.
   New REDCap records will be created for the input cases. Record-ID allocation
   is deferred; do not attempt to match these inputs to the existing records.
5. Compare reviewed outputs against a verified reference set. Existing project
   records do not currently establish such a reference set. Upload implementation
   remains separate from the read-only MCP and requires explicit write authorization.

## Existing REDCap records audit

Read-only inspection on 16 October 2026 found 20 record IDs with `CMP-` prefixes,
not the printed `Rakathon1`–`Rakathon40` labels. No crosswalk has been established.
There are 20 base rows and 20 surgical lesion instance-1 rows. Only one base row
has populated surgical data. All surgical lesion dimensions, histology-type and
Gleason fields are blank. One lesion row selects all 41 region checkboxes and
contains invasion codes; the others have no selected regions or invasion values.
Calculated segment values alone are not evidence of annotated lesions.

The populated surgical record is `CMP-0000634`. Its historical narrative concerns
post-treatment disease and states 32 examined nodes, while the structured field
stores 20 (the dictionary maximum). Do not treat this as validated ground truth
or assume why the discrepancy occurred. No match to the input pairs is established.

Other exported forms contain 49 laboratory rows, 16 MRI rows, 5 urology rows,
4 biopsy-lesion rows, 20 MRI-quality rows and 1 other-procedure row. These are row
counts, not distinct patient counts. MRI-quality rows have no non-calculated
findings populated. Source provenance and correspondence to the JPEG dataset
remain unverified; the records are useful for transport/shape checks, not yet
accuracy scoring.

The server now accepts a private `REDCAP_API_TOKEN`. Its SecureString is
`/prostapaper/demo/REDCAP_API_TOKEN` in Frankfurt. Terraform references the ARN
for ECS injection. The demo stack installs the dedicated execution-role permission
before creating the task definition. Configuration alone does not enable imports.
MOÚ gateway access from ECS and the token's import permissions remain unverified.

## Upload preparation

Current implementation, updated 17 October: `apps/api/src/redcap/client.ts` prepares
submission from the approved review revision. `toRedcapRows` supplies an identity-only
base row and lesion rows using
`redcap_repeat_instrument=surgery_c61_resected_lesion` with sequential positive
`redcap_repeat_instance` strings. It omits parent clinical fields and derived parent
lesion-count fields. `prepareRedcapUpload` checks lesion requirements without requiring
parent metadata; the helper still supports an explicit parent input for compatibility.
Submission marks only `surgery_c61_resected_lesion_complete=2` and leaves parent
completion unchanged. The transport allocates a new record through REDCap's automatic
numbering and exports the approved snapshot.

### Original transport preparation (16 October)

The protocol and rollout plan below describe the initial transport foundation;
they are historical, not the current integration status. In particular, the current
transport uses `forceAutoNumber=true` and is connected to the approved-review export.

`RedcapClient.upload` first verifies that the token belongs to project 64, then
sends an HTTPS form-encoded POST with the following parameters:

```text
token=<server-only environment secret>
content=record
action=import
format=json
type=flat
overwriteBehavior=normal
forceAutoNumber=false
dateFormat=YMD
returnContent=ids
returnFormat=json
data=<JSON array of reviewed raw-code rows>
```

The method accepts success only when REDCap returns the expected record ID.
Redirects are rejected, requests time out after 15 seconds and imports are never
automatically retried. If an import response fails or cannot be verified, the
caller must reconcile with REDCap before retrying: the first request may already
have committed. Raw response bodies and tokens are not included in errors.
`normal` ignores blank values but still overwrites existing nonblank values when
nonblank replacements are submitted. It is not a create-only or merge-conflict policy.
Checkbox `0` values can clear selections. Review must show these changes explicitly.
Protocol reference: [PyCap record import](https://redcap-tools.github.io/PyCap/api_reference/records/).

The transport is intentionally not called from startup, a route, a command or the
UI. Tests use synthetic rows and injected fetch responses. No live import was
performed. The MCP remains independently read-only.

To deliver the eventual **Upload to REDCap** button:

1. Confirm whether project 64 is shared across teams, or whether organizers assign
   distinct projects or Data Access Groups. The project title/notes only establish
   a COMPARE copy for Rakathon; they do not establish team isolation. An API token
   alone is not a separate dataset. New records are the chosen product direction;
   do not map these cases onto the existing records. ID allocation is deferred.
2. Use the confirmed `surgery_c61_resected_lesion` subset. Preserve unresolved
   lesion findings alongside their source text. Reviewers resolve lesion discrepancies
   before the final raw-code rows are validated for upload; parent findings do not
   create blocking requirements.
3. From ECS, verify read-only project access through MOÚ's gateway and confirm
   API Import/Update rights through the project administrator. Local MCP gateway
   cookies are not deployed or treated as a durable service credential.
4. Add an authenticated, owner-scoped preview showing the target project, new-record
   destination, lesion instances and extracted findings with their source evidence.
   Persist the approved mapping
   version, target identity and payload hash. Do not accept arbitrary client rows.
5. Add an owner-scoped upload mutation for an approved case. Atomically claim the
   export, invoke this transport with the stored reviewed payload and record the
   response. Reconcile uncertain outcomes and preserve stable lesion-instance IDs
   across retries. Re-read the target fields to verify the resulting values.
6. Connect the button to that mutation and surface mapping errors, upload progress
   and verified completion. Exercise the workflow on an organizer-approved test
   record before enabling it for the dataset.

### Review is where mapping discrepancies are resolved

Extraction must succeed even when the input conflicts with the dictionary or with
the other image. Preserve the exact source value and represent the problem next
to that finding. Keep these draft review issues separate from transport failures.
Only the reviewed export payload needs to satisfy the agreed REDCap rules.

Each review item should show:

- A readable field label and the lesion it belongs to, or the lesion-completeness decision.
- The original wording or diagram crop, with a link to the relevant JPEG and region.
- The proposed REDCap value, using a readable label rather than a raw numeric code.
- A short, specific explanation when information is missing, conflicting, outside
  the allowed range or unavailable among the REDCap choices.
- An editable selection/value. Optional findings may be left blank explicitly;
  required decisions follow the agreed upload policy.

For example, a lesion's Gleason percentage without its corresponding grade is a
review issue: show the source wording and the missing grade together. The reviewer
can inspect the evidence and correct or clear the percentage. Do not infer a grade
to satisfy validation. Parent staging findings such as pT2 are outside this workflow.

Show a compact count of unresolved items and let the reviewer jump directly to
them. Keep the source and proposed value visible together. Preserve the original
extraction and record the reviewed correction separately. The eventual Upload
button sends the approved snapshot; edits after approval require a new approval.
This is the review design for follow-up implementation, not a review UI shipped
by the transport-preparation PR.
