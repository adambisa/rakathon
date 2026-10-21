import type { ReactNode } from "react";

import { AppSidebar } from "#components/app-sidebar";
import { ProductFooter } from "#components/product-footer";
import { buttonClass } from "#lib/button-class";
import { cx } from "#lib/cx";
import { DrawerToggle, Icon } from "#ui";

const DRAWER_ID = "app-drawer";

export interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="drawer lg:drawer-open">
      <DrawerToggle id={DRAWER_ID} />

      <div className="drawer-content flex min-h-screen flex-col bg-base-200 text-base-content">
        <label
          htmlFor={DRAWER_ID}
          aria-label="Otevřít postranní panel"
          className={cx(
            buttonClass({ shape: "circle", variant: "ghost", size: "sm" }, "drawer-button"),
            "fixed top-14 left-0 z-0 -translate-x-1/2 -translate-y-1/2 border border-base-300 bg-base-100 pr-1 shadow-md lg:hidden",
          )}
        >
          <Icon name="chevrons" size="xs" className="ml-1 rotate-180" />
        </label>

        <main className="@container/main mx-auto w-full max-w-[1440px] grow p-4 pt-6 sm:px-6">
          {children}
        </main>

        <div className="py-3">
          <ProductFooter />
        </div>
      </div>

      <div className="drawer-side z-20 overflow-visible!">
        <label htmlFor={DRAWER_ID} aria-label="Zavřít postranní panel" className="drawer-overlay" />
        <AppSidebar toggleId={DRAWER_ID} />
      </div>
    </div>
  );
}
