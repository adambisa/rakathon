import type { ErrorComponentProps } from "@tanstack/react-router";

import { errorMessage } from "#lib/error-message";
import { Button } from "#ui";

export function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <div role="alert" className="m-4 alert alert-error">
      <span>{errorMessage(error)}</span>
      <Button size="sm" variant="outline" onClick={reset}>
        Zkusit znovu
      </Button>
    </div>
  );
}
