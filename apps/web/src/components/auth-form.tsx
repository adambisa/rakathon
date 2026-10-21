import { type ReactNode, useState } from "react";

import { useSession } from "#lib/use-session";
import { Button, Card, Input, Link } from "#ui";

export interface AuthFormProps {
  heading: string;
  submitLabel: string;
  passwordAutoComplete: "current-password" | "new-password";
  onSubmit: "sign-in" | "sign-up";
  footer: ReactNode;
}

export function AuthForm({ heading, submitLabel, passwordAutoComplete, onSubmit, footer }: AuthFormProps) {
  const { signIn, signUp, isPending } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const registering = onSubmit === "sign-up";
  let minLength: number | undefined;
  let maxLength: number | undefined;
  if (registering) {
    minLength = 8;
    maxLength = 128;
  }

  return (
    <Card heading={heading} className="w-full [&>.card-body]:gap-4 [&>.card-body]:p-6 sm:[&>.card-body]:p-8">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (registering) {
            signUp({ name: name.trim(), email, password });
          } else {
            signIn({ email, password });
          }
        }}
      >
        {registering && (
          <Input
            label="Jméno"
            name="name"
            autoComplete="name"
            required
            pattern={String.raw`.*\S.*`}
            disabled={isPending}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
        <Input
          label="E-mail"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="jmeno@nemocnice.cz"
          required
          disabled={isPending}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Input
          label="Heslo"
          type="password"
          name="password"
          autoComplete={passwordAutoComplete}
          minLength={minLength}
          maxLength={maxLength}
          placeholder="••••••••"
          required
          disabled={isPending}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button type="submit" tone="primary" disabled={isPending} className="mt-4">
          {submitLabel}
        </Button>
      </form>

      <p className="text-sm text-base-content/60">{footer}</p>
      <p className="text-sm text-base-content/60">
        Chcete se jen podívat?{" "}
        <Link to="/host" preload={false}>
          Pokračovat jako host
        </Link>
        .
      </p>
    </Card>
  );
}
