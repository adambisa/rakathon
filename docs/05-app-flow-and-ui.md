# App flow & FE design

Status: product proposal, reconciled 2026-10-06. The deployed frontend currently has the API/session home screen, UI library and deferred route skeletons; The file drop and authenticated presigned S3 uploads are implemented in code but not deployed. Clinical review, export, eval and settings flows below are future work. The pipeline visualization is a separate open PR. Internal tool for one hospital department. Users: a pathologist / urologist / study nurse entering the COMPARE registry, plus us during the hackathon. Everything below is scoped to what the 24 h window can carry.

---

## 1. Users and roles

| Role           | Can                                                      | Hackathon reality     |
| -------------- | -------------------------------------------------------- | --------------------- |
| **Reviewer**   | upload, review/correct fields, approve records, export   | the MOÚ mentor and us |
| **Admin**      | everything + manage users, REDCap settings, delete cases | us                    |
| (later) Viewer | read-only, stats                                         | not built             |

Auth now: Better Auth runs inside the Hono process with a Drizzle adapter on our
Postgres, called through typed `auth.signUp`, `auth.signIn`, `auth.signInAsGuest` and
`auth.signOut` tRPC mutations. Its HTTP handler is not exposed. `createContextFactory` resolves `Session | null`
from the session cookie; `protectedProcedure` rejects unauthenticated calls and
narrows the session. Email+password registration with automatic sign-in; the admin plugin owns roles (`reviewer`,
`admin`) and `pnpm --filter @prostapaper/api seed:users` creates accounts through
its `createUser`. New registrations receive the reviewer role. The auth tRPC middleware checks the request origin and rate limits sign-in at 30
per minute per client IP; sign-up and guest sign-in at 5 per minute. Limits are process-local. Guest sign-in uses the
anonymous plugin: a reviewer row named `Host` with a `{id}@anonymous.placeholder.invalid`
address copied into `display_email` by an insert trigger, `is_anonymous = true` and an
ordinary session, so every judge gets an isolated workspace without registering. Guest rows are never cleaned up automatically. No role-gated procedure or
user-management UI exists yet.

The frontend root layout provides one `SessionProvider`. Components use
`useSession()` for the session, pending/error state and sign-in/up/out actions. The
provider and route loader share `sessionQueryOptions`; session fetching is defined
once, with no second copy in React state. Sign-in/up/out calls the typed tRPC client,
then cancels outstanding queries, resets cached data and reloads the active route.
Focus and reconnect refresh the session.

Email identity uses validator.js provider normalization on the server for registration,
sign-in and admin-created users. Better Auth's unique `email` stores the canonical
identity; server-owned `displayEmail` preserves the submitted address for display
and future email delivery. Gmail/Googlemail dots and plus tags, Yahoo/ymail/rocketmail
hyphen suffixes, Outlook-family and iCloud plus tags, and Yandex domain aliases use
the library's rules. Other domains retain their dots and tags. All identities are
lowercased, matching Better Auth's email handling. `z.email()` rejects surrounding
whitespace; neither the form nor the server trims email input. Normalization cannot discover
arbitrary forwarding addresses or relate a Yahoo disposable nickname to a different
primary account name. No email verification or approval gate is enabled.

The migration backfills display addresses and canonical identities. Existing accounts
whose identities collide cause migration to fail so they can be resolved explicitly;
accounts and their associated data are never silently merged.

The SPA and API share one origin via the ECS app and ALB, so the session cookie is
same-origin and no CORS setup is needed; the Vite dev server proxies `/api` for the
same reason. Google sign-in is a `socialProviders` entry away, but needs a Google
Cloud project. OIDC for a hospital IdP remains future work.

---

## 2. The human flow

```
/            Upload      named case + document upload drop-zone
/dokumenty   Documents   individual document cards and extraction status
/pripady     Cases       grouped documents and case status
/pripady/:id    Review      page image(s) | extracted text | fields with confidence → accept / correct → Approve
/export      Export      approved-but-not-exported records → REDCap CSV download or API push → marks exported
/eval        Eval        (us only) latest runs, per-field accuracy, provider comparison — the slide, live
/settings    Settings    REDCap URL + token, provider per pipeline, user management
```

### 2.1 Cases (`/pripady`)

- Implemented upload: multiple files create one owned case; documents are registered
  separately and retry the same document ID with fresh upload tickets. The S3 callback
  records upload time/version. The Případy tab groups documents in expandable case rows
  and shows separate case/document badges. A submitted case cannot gain documents;
  approved content is immutable. See [the model](11-case-document-design.md).
- Future processing: extraction, mapping, review and export workers; attempt history is step 2.
- Proposed case table columns: name, status (badge), ISUP, pT, margin, `fields reviewed / total`, created, actions. ISUP/pT/margin come from the approved record if present, else from the extraction (shown greyed with a dotted border to say "unreviewed").
- Filters: status, "has pending fields", "has invariant violations", provider. Sort by low confidence first — the review queue.
- Bulk: select → "Export selected" (only approved), "Re-run mapping" (`case.remap`).

### 2.2 Review (`/pripady/:id`) — the screen that wins or loses the demo

Three columns, fixed to the viewport, no page scroll:

```
┌──────────────────────┬──────────────────────┬────────────────────────────────┐
│ SOURCE               │ TEXT                 │ FIELDS                         │
│ page image, zoom/pan │ extracted text,      │ grouped like the ICCR form:    │
│ page thumbnails      │ schema rendering     │  Specimen · Tumour · Grade ·   │
│                      │ (evidence highlighted│  Extent · Margins · Nodes ·    │
│                      │  on field focus)     │  Staging · Sectors             │
│                      │                      │ each: value · conf badge ·     │
│                      │                      │  ✓ accept  ✎ correct           │
├──────────────────────┴──────────────────────┴────────────────────────────────┤
│ footer: invariant warnings (pt_stated vs pt_floor…) · 12/19 reviewed · [Approve] │
└────────────────────────────────────────────────────────────────────────────┘
```

Behaviour:

- **Focus a field → its evidence snippet highlights in the TEXT column and the page scrolls to that page.** This is the "work with data" moment for the jury; it's also how a reviewer verifies a field in two seconds.
- **Confidence badges:** ≥0.9 green, 0.7–0.9 amber, <0.7 red, `null` (not stated in report) grey "—". Red fields are expanded by default; green are collapsed to one line. Reviewer reads the reds, skims the ambers, trusts the greens — and the eval's calibration metric is what makes that trust honest.
- **Accept / correct:** `Enter` accepts the focused field, `e` edits, `j`/`k` move. Corrections use the same Zod enum/number constraints as the contract (TanStack Form). Each action writes a `field_reviews` row immediately; nothing is lost on refresh.
- **Derived fields are shown, not edited:** Gleason score, ISUP, pN derived, pT floor — rendered as computed chips next to the inputs they derive from. If `pt_stated ≠ pt_floor`, the footer shows the named rule in plain Czech and the Approve button explains why it's disabled.
- **Sectors:** a small SVG of the PI-RADS sector map (base/mid/apex × L/R × zones); sectors marked in the extraction are filled orange, click toggles, hover shows Gleason pattern / margin flags. The reviewer compares it visually with the hand-drawn schema on the left — that's exactly the comparison the registry exists for.
- **Approve:** disabled until all red fields are accepted/corrected and no invariant fails. On success: `records` insert, toast, "Next unreviewed case" link. On a DB constraint violation we didn't catch client-side: error banner naming the constraint, fields stay pending.
- **Re-run mapping** button (keeps the extraction, re-maps, diff view of what changed) — mostly for us during the event.

### 2.3 Final check and exports (`/pripady/$caseId`, `/exporty`)

Clicking **Schválit** opens a read-only final check with surgical fields, lesions and
sector diagram. Source documents are hidden. **Zpět ke kontrole** clears approval;
the case must be approved again before sending. **Odeslat do REDCap** creates a new
record with a REDCap-assigned ID and marks surgery and each repeating lesion form
Complete. No extra checkbox is required. Payload/schema validation remains active.

After confirmed submission, show the REDCap ID and timestamp. The case appears in
**Exporty**, newest first, and remains permanently read-only. Prevent duplicate
sends on the server as well as in the UI. An unconfirmed outcome stays locked
until an operator reconciles it with REDCap. See [submission and recovery](../apps/api/README.md#redcap-submission).

### 2.4 Eval (`/eval`, us only)

Read-only view of `evals/` runs: dataset, provider/model, per-field accuracy table, critical-field accuracy, invariant violations, cost/doc. Run diff selector. This is the slide for the pitch, live.

---

## 3. FE design

Principles: **dense, calm, fast, Czech.** No marketing surfaces, no hero sections, no illustrations. The orange is used for exactly three things: primary actions, "marked" sectors, and active focus. Everything else is greyscale.

| Topic                  | Decision                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language               | **UI in Czech** (jury, mentors and users are Czech; labels follow ICCR terminology in Czech as used in MOÚ reports). Code, routes, field ids in English. i18n via a flat `cs.ts` object, no library; EN toggle only if time permits. |
| Theme                  | daisyUI 5 `mou` theme, light only. `--color-primary: #f04600`; base greys neutral, not warm. No dark mode.                                                                                                                           |
| Type                   | system stack (see `03`), 14 px base in tables, 13 px in dense field lists, tabular numerals for mm/g/PSA.                                                                                                                            |
| Density                | tables `table-sm`, inputs `input-sm`, 4 px grid. The review screen must fit 1366×768 without scrolling the layout.                                                                                                                   |
| Components             | daisyUI only: `table`, `badge`, `btn`, `input`/`select`, `tooltip`, `drawer` (settings), `toast`, `steps` (case status), `tabs` (page thumbnails). No component library beyond that.                                                 |
| Status colours         | created/extracting/mapping = neutral with a spinner; done = success; failed = error; approved = primary outline; exported = primary solid.                                                                                           |
| Confidence             | badge colours above; always paired with the number (`0.82`), never colour alone.                                                                                                                                                     |
| Icons                  | lucide-react, 16 px, only where text alone is ambiguous.                                                                                                                                                                             |
| Page image viewer      | pre-rendered PNGs per page from the extraction step (stored under `derived/{documentId}/pages/`), shown in a pan/zoom container (`react-zoom-pan-pinch`). No pdf.js in the browser.                                                  |
| Empty/loading          | skeleton rows; never a blank screen. Errors show the tRPC message and a retry.                                                                                                                                                       |
| Responsiveness         | desktop only (≥1280). Not a mobile product.                                                                                                                                                                                          |
| Accessibility baseline | keyboard-complete review flow, visible focus ring (orange), contrast checked for the red/amber/green badges on white.                                                                                                                |

---

## 4. Decisions for Filip

| #   | Decision                           | Options                                                                                                                                                                                                                                                                                                                              | My pick                                                                                                                                               |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Auth provider (post-hackathon)** | (a) **Better Auth**, self-hosted in the Hono process, Drizzle adapter on our Postgres, email+password or magic link, OIDC plugin later for a hospital IdP; (b) Clerk — hosted, 10 min to wire, but another vendor and a hosted login page in an internal hospital tool; (c) WorkOS — only if hospital SSO/SAML becomes a requirement | **(a)**, implemented 2026-10-07: email+password, self-service reviewer registration and seeded accounts.                                              |
| 2   | UI language                        | Czech / English / both                                                                                                                                                                                                                                                                                                               | **Czech**, EN toggle only if time permits                                                                                                             |
| 3   | Review granularity                 | per-field accept (as designed) vs whole-record "looks fine → approve"                                                                                                                                                                                                                                                                | **per-field**, but with "Accept all green" one-click so a clean report is 3 keystrokes                                                                |
| 4   | Who may approve                    | any reviewer vs admin only                                                                                                                                                                                                                                                                                                           | **any reviewer**; audit via `reviewed_by`                                                                                                             |
| 5   | Export mode on demo day            | CSV download only vs also live API push                                                                                                                                                                                                                                                                                              | **both built; CSV is the demo path** unless MOÚ gives us a sandbox REDCap project                                                                     |
| 6   | Sector map in the UI               | interactive SVG (as designed) vs plain list of sector ids                                                                                                                                                                                                                                                                            | **SVG**, it's the single most convincing visual for this challenge                                                                                    |
| 7   | Page viewer                        | pre-rendered PNGs vs pdf.js in browser                                                                                                                                                                                                                                                                                               | **PNGs** from the extraction step                                                                                                                     |
| 8   | Evidence highlighting              | text-span highlighting in the TEXT column (designed) vs bounding boxes on the image                                                                                                                                                                                                                                                  | **text spans**; boxes only if the extraction provider returns layout coordinates                                                                      |
| 9   | Dark mode / mobile                 | —                                                                                                                                                                                                                                                                                                                                    | **neither**                                                                                                                                           |
| 10  | Keyboard shortcuts                 | yes / no                                                                                                                                                                                                                                                                                                                             | **yes** (`j`/`k`/`Enter`/`e`/`a` accept-all-green) — cheap, and reviewers love it                                                                     |
| 11  | Audit trail                        | `field_reviews` history (append-only) vs last-write                                                                                                                                                                                                                                                                                  | **append-only** rows with `reviewed_at`; the current state is the latest row per field — gives us an undo and a story for the jury about traceability |
