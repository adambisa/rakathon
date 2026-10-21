import { useRouter } from "@tanstack/react-router";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { ButtonLink, Icon } from "#ui";

export interface PageHeaderBackProps {
  fallback: NonNullable<ComponentProps<typeof ButtonLink>["to"]>;
  "aria-label": string;
}

export function PageHeaderBack({ fallback, "aria-label": ariaLabel }: PageHeaderBackProps) {
  const router = useRouter();
  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || isModifiedClick(event)) return;
    if (!router.history.canGoBack()) return;
    event.preventDefault();
    router.history.back();
  };

  return (
    <ButtonLink
      to={fallback}
      onClick={goBack}
      size="sm"
      variant="ghost"
      shape="square"
      aria-label={ariaLabel}
      className="shrink-0"
    >
      <Icon name="arrowLeft" size="sm" />
    </ButtonLink>
  );
}

function isModifiedClick(event: MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export interface PageHeaderProps {
  children: ReactNode;
  back?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ children, back, status, actions }: PageHeaderProps) {
  return (
    <header className="flex items-start gap-3 py-2">
      {back}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 text-2xl font-semibold wrap-anywhere">{children}</h1>
        {status}
      </div>
      {actions !== undefined && actions !== null && actions !== false && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
