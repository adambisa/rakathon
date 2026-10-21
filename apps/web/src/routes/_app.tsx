import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";

import { AppLayout } from "#components/app-layout";
import { sessionQueryOptions } from "#lib/session-query";

export const Route = createFileRoute("/_app")({ component: App });

function App() {
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  if (session === null) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
