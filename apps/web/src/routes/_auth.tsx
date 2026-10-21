import { createFileRoute, Outlet } from "@tanstack/react-router";

import { AuthBackground } from "#components/auth-background";
import { ProductFooter } from "#components/product-footer";
import { Link, Logo, MouLogo } from "#ui";

export const Route = createFileRoute("/_auth")({ component: AuthLayout });

function AuthLayout() {
  return (
    <div className="relative isolate grid min-h-screen place-items-center bg-base-200 p-4 text-base-content">
      <AuthBackground />
      <div className="relative z-10 flex w-full max-w-sm flex-col gap-6">
        <Link to="/" className="self-center no-underline">
          <Logo className="text-4xl" />
        </Link>
        <Outlet />
        <div className="flex flex-col items-center gap-3">
          <span className="text-xs tracking-wide text-base-content/50 uppercase">Ve spolupráci s</span>
          <MouLogo className="h-16" />
        </div>
        <ProductFooter />
      </div>
    </div>
  );
}
