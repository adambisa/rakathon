# Clinical record schema

The required REDCap target is project 64's repeating
`surgery_c61_resected_lesion` instrument. Active extraction, clinical review,
readiness checks and export cover its 14 lesion fields and lesion completeness.
The parent `surgery_c61` clinical fields are outside this scope.

`SurgeryRecord` in `packages/contracts/src/surgery.ts` keeps the existing envelope:
`lesions` holds one object per lesion described by the report, and `surgery` remains
readable for legacy artifacts. New mapping instructions leave every `surgery` field
null. Missing scalar findings are null. The report determines lesion count; sheet
marks only locate lesions.

`sur_prostate_regions` contains `RegionCode` values. `all_sgm` is boolean and requires
exactly the dictionary's 40 annotated regions when true, excluding urethra. Gleason
percentages require their corresponding grades and sum to at most 100.

`redcap-schema.ts` is the generated dictionary snapshot. It supplies field labels,
choices, validation bounds and branching rules; tests check the record's fields and
enums against it. The snapshot retains parent metadata for compatibility, but that
metadata does not add parent fields to the active target. Refresh manually with
`pnpm --filter @prostapaper/contracts redcap:dictionary` after configuring the gateway
session described in [the REDCap setup](../tools/redcap/README.md). Refresh is not part
of codegen or CI because it requires authenticated gateway access.

`MappingOutput` wraps the record and mapping diagnostics. `lesionsFromRecord` supplies
the sector diagram. New review assessments cover lesion fields and lesion count.
Saved review records preserve legacy parent values without applying new parent
text/date/count bounds; explicit legacy parent-edit commands remain bounded.
Review validation policy 2 checks lesion validity and export requirements. Workflow
policy 3 requires lesion and collection decisions/confirmations; workflow versions
1 and 2 remain readable, with old decisions reevaluated against the current policy.

`toRedcapRows` supplies the record identity and sequential repeating lesion instances
starting at 1. The prepared export contains an identity-only base row and lesion rows;
it omits parent clinical fields, parent lesion-count fields and `surgery_c61_complete`.
Only lesion rows receive `surgery_c61_resected_lesion_complete=2` on submission.
`prepareRedcapUpload` validates required lesion fields and conditional constraints,
so nullable extraction fields may still need reviewer input before export. Its generic
explicit-parent input remains supported for compatibility; production serialization
omits that input, so absent parent metadata cannot block approval or export.

The review screen uses dictionary labels and codes, persists corrections separately
from the proposal and exports the pinned approved revision. Existing ICCR mapping
objects are not supported; recreate demo cases for this deployment.
