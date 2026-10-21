import { createFileRoute, Navigate } from "@tanstack/react-router";

import { AuthForm } from "#components/auth-form";
import { useSession } from "#lib/use-session";
import { Link } from "#ui";

export const Route = createFileRoute("/_auth/sign-up")({ component: SignUp });

function SignUp() {
  const { session } = useSession();
  if (session) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthForm
      heading="Registrace"
      submitLabel="Vytvořit účet"
      passwordAutoComplete="new-password"
      onSubmit="sign-up"
      footer={
        <>
          Máte už účet? <Link to="/sign-in">Přihlaste se</Link>.
        </>
      }
    />
  );
}
