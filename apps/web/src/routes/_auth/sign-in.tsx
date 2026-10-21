import { createFileRoute, Navigate } from "@tanstack/react-router";

import { AuthForm } from "#components/auth-form";
import { useSession } from "#lib/use-session";
import { Link } from "#ui";

export const Route = createFileRoute("/_auth/sign-in")({ component: SignIn });

function SignIn() {
  const { session } = useSession();
  if (session) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthForm
      heading="Přihlášení"
      submitLabel="Přihlásit"
      passwordAutoComplete="current-password"
      onSubmit="sign-in"
      footer={
        <>
          Nemáte účet? <Link to="/sign-up">Zaregistrujte se</Link>.
        </>
      }
    />
  );
}
