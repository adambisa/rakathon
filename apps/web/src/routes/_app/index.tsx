import { createFileRoute } from "@tanstack/react-router";

import { CaseEntry } from "#components/case-entry";

export const Route = createFileRoute("/_app/")({ component: CaseEntry });
