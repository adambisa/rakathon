import { createFileRoute } from "@tanstack/react-router";

import { Documentation } from "#components/documentation";

export const Route = createFileRoute("/_app/dokumentace")({
  validateSearch: (search: Record<string, unknown>) => ({
    guide: search["guide"] === "pro-it-a-dpo" ? "pro-it-a-dpo" : "pro-lekare",
  }),
  component: DocumentationPage,
});

function DocumentationPage() {
  const { guide } = Route.useSearch();

  return <Documentation guide={guide} />;
}
