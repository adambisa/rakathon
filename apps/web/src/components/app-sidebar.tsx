import type { LinkProps } from "@tanstack/react-router";

import { avatarForName } from "#lib/avatar";
import { buttonClass } from "#lib/button-class";
import { cx } from "#lib/cx";
import { useTheme } from "#lib/theme";
import { useSession } from "#lib/use-session";
import { Badge, Button, ButtonLink, Icon, type IconName, Link, Logo } from "#ui";

const RAIL_TOOLTIP = "is-drawer-close:tooltip is-drawer-close:tooltip-right";
const RAIL_ITEM = cx(
  "flex h-12 items-center gap-2",
  "is-drawer-close:w-12 is-drawer-close:justify-center is-drawer-close:px-0",
);

const NAV_ITEM = cx("font-medium no-underline", RAIL_TOOLTIP, RAIL_ITEM);
const NAV_ACTIVE = "bg-base-200 text-base-content hover:bg-base-300/60";
const ROLE_LABEL = { reviewer: "Recenzent", admin: "Administrátor" };

export interface AppSidebarProps {
  toggleId: string;
}

export function AppSidebar({ toggleId }: AppSidebarProps) {
  return (
    <aside className="relative flex min-h-full w-56 flex-col border-r border-base-300 bg-base-100 transition-[width] lg:will-change-auto! is-drawer-close:w-16">
      <div className="flex grow flex-col whitespace-nowrap is-drawer-open:overflow-hidden">
        <div className="flex h-16 shrink-0 items-center px-5 is-drawer-close:justify-center is-drawer-close:px-0">
          <Link to="/" className="text-lg no-underline">
            <Logo tailClassName="is-drawer-close:hidden" />
          </Link>
        </div>

        <div className="px-2 pt-4 pb-6">
          <ButtonLink
            to="/"
            tone="secondary"
            data-tip="Nový případ"
            className={cx(
              "w-full justify-start px-[calc(0.75rem-var(--border))] no-underline",
              RAIL_TOOLTIP,
              RAIL_ITEM,
            )}
          >
            <Icon name="plus" size="sm" />
            <span className="is-drawer-close:hidden">Nový případ</span>
          </ButtonLink>
        </div>

        <ul className="menu w-full grow flex-nowrap gap-1 px-2">
          <NavItem to="/ke-kontrole" icon="review" label="Ke kontrole" />
          <NavItem to="/pripady" icon="folderOpen" label="Případy" />
          <NavItem to="/dokumenty" icon="fileStack" label="Dokumenty" />
          <NavItem to="/exporty" icon="upload" label="Exporty" />
          <NavItem to="/dokumentace" icon="bookOpen" label="Dokumentace" />
        </ul>

        <div className="shrink-0 px-2 py-4">
          <SidebarSession />
        </div>
      </div>

      <label
        htmlFor={toggleId}
        aria-label="Přepnout postranní panel"
        className={cx(
          buttonClass({ shape: "circle", variant: "ghost", size: "xs" }, "drawer-button"),
          "absolute top-14 -right-3 z-30 -translate-y-1/2 border border-base-300 bg-base-100 shadow-md hover:bg-base-200",
        )}
      >
        <Icon name="chevrons" size="xs" className="is-drawer-close:rotate-180" />
      </label>
    </aside>
  );
}

interface NavItemProps {
  to: NonNullable<LinkProps["to"]>;
  icon: IconName;
  label: string;
}

function NavItem({ to, icon, label }: NavItemProps) {
  return (
    <li>
      <Link
        to={to}
        className={NAV_ITEM}
        activeOptions={{ exact: true }}
        activeProps={{ className: NAV_ACTIVE }}
        data-tip={label}
      >
        <Icon name={icon} size="sm" />
        <span className="is-drawer-close:hidden">{label}</span>
      </Link>
    </li>
  );
}

function SidebarSession() {
  const { session, isPending, signOut } = useSession();
  const { isDark, toggle } = useTheme();

  if (!session) {
    return null;
  }

  const { user } = session;
  let subtitle = user.displayEmail;
  let accountLabel = ROLE_LABEL[user.role];
  if (user.isAnonymous) {
    subtitle = "Hostovský přístup";
    accountLabel = "Host";
  }

  return (
    <details
      className="dropdown dropdown-top w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.removeAttribute("open");
        }
      }}
    >
      <summary
        className={cx(
          "cursor-pointer list-none rounded-field px-3 outline-none select-none hover:bg-base-200",
          RAIL_TOOLTIP,
          RAIL_ITEM,
        )}
        aria-label={`${user.name}, otevřít nabídku účtu`}
        data-tip={`${user.name} · ${subtitle}`}
      >
        <img
          src={avatarForName(user.name)}
          alt=""
          width={32}
          height={32}
          className="size-8 max-w-none shrink-0 rounded-full ring-2 ring-base-100 outline-1 outline-base-300"
        />
        <div className="flex min-w-0 flex-col items-start text-left is-drawer-close:hidden">
          <span className="w-full truncate text-xs leading-4 font-semibold" title={user.name}>
            {user.name}
          </span>
          <span className="w-full truncate text-[0.6875rem] leading-4 text-base-content/60" title={subtitle}>
            {subtitle}
          </span>
        </div>
      </summary>
      <div className="dropdown-content z-30 mb-1 w-full min-w-44 rounded-box border border-base-300 bg-base-100 p-1">
        <div className="px-2 pt-1 pb-2">
          <Badge size="xs" variant="outline">
            {accountLabel}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" className="flex w-full justify-start font-normal" onClick={toggle}>
          <Icon name={isDark ? "sun" : "moon"} size="sm" />
          {isDark ? "Světlý režim" : "Tmavý režim"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex w-full justify-start font-normal"
          disabled={isPending}
          onClick={signOut}
        >
          <Icon name="logOut" size="sm" />
          Odhlásit se
        </Button>
      </div>
    </details>
  );
}
