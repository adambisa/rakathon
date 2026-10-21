import { z } from "zod";

import { CaseId } from "@prostapaper/contracts";

export const MappingEvent = z.object({ caseId: CaseId });
export type MappingEvent = z.infer<typeof MappingEvent>;
