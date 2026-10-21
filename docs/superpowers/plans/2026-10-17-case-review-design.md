# Case review redesign implementation plan

Goal: make the Czech case review workspace calm, legible and action-oriented while preserving every clinical review gate and saved-data contract.

Base: origin/main at 08c8d0e. Worktree: case-review-design. Existing React, Tailwind, daisyUI and native details; no new dependencies.

1. Shell: 1440px max width, compact wrapping metadata, readable contrast and keyboard/hover states. Own app-layout.tsx, case-layout.tsx, styles.css.
2. Review workspace: compact heading and revision; summary worklist with collapsed issues; readable bordered field rows with value, concise decision state, source/edit actions. Fields remain rendered for focus navigation. Supporting documents/diagram follow fields on narrow screens. Technical proposal history disclosed on demand. Own case-mapping.tsx and mapping-attention.tsx.
3. Evidence and marks: numbered labels aligned to workspace marks; anatomical region display via existing SECTORS dictionary, unknown code fallback. Preserve raw IDs internally and optional technical detail. Route unresolved mark tasks to assignment dialog, and read-only tasks to evidence. Own mapping-format.ts, review-attention.ts, review-command-modal.tsx, mapping-evidence-modal.tsx.
4. Verify formatting, unit/type/lint/build and browser lifecycle regressions; inspect real screen and synthetic states at desktop/mobile, light/dark. Independent reviewer checks regression risks.

Constraints: no clinical values or decision rules changed, no auto approval/export, no new external data transmission. Keep existing accessible action names and draft/concurrency handling. Null/empty values are neutral; false and zero remain meaningful. Missing confidence is never relabeled as missing document. Mark labels stay consistent across current workspace and original evidence.

Review focus: stale revisions and unsaved drafts; read-only final state; unresolved marks navigation; null versus false/zero; keyboard focus restoration and narrow-screen overflow.

## Verification completed

- 33 web unit tests passed.
- 8 real-component browser lifecycle scenarios passed, including direct mark assignment and read-only evidence.
- Web TypeScript, ESLint, Prettier and production build passed (existing large-chunk warning remains).
- Visual inspection: desktop, 390px mobile with no horizontal overflow, light and dark themes, mark dialog.
- Independent reviews caught and resolved narrow-screen start-action placement and mark-dialog focus restoration.
- Local preview uses synthetic fixtures because the local guest account has no cases. Production case was not available through that account. No production data changed.
- Latest main API runs on 6768; web runs on 6767 using ignored node_modules/.cache/review-dev.config.ts. The original root checkout and its pending changes are preserved.

## Case notes

Added a shared case note in the supporting sidebar with an explicit save/cancel editor and a 4,000-character limit. Notes use existing versioned review artifacts in S3, remain separate from REDCap, and preserve revision conflict and permission checks. Approved cases retain a readable note.

Verification: 33 web unit tests, 43 API unit tests, 18 isolated review integration tests, and 12 browser lifecycle scenarios passed. Typecheck, changed-file lint, and web production build passed. Note save/reopen and editor layout inspected in the synthetic preview; no production write performed.
