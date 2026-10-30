import { Clapperboard, ScrollText, Swords, Wallet } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useArenaDeployment } from "@/lib/arenaDeployment";
import { cn } from "@/lib/utils";

export type ArenaSection = "join" | "battles" | "rewards";

export function ArenaNavigation({ section }: { section?: ArenaSection }) {
  const deployment = useArenaDeployment();
  const { pathname } = useLocation();
  return (
    <div className="mb-8 mt-7">
      <nav
        aria-label="Arena navigation"
        className="grid grid-cols-3 gap-1 rounded-2xl bg-line/60 p-1"
      >
        {[
          {
            href: deployment.basePath,
            label: "Join a battle",
            key: "join",
            Icon: Swords
          },
          {
            href: `${deployment.basePath}/me`,
            label: "My battles",
            key: "battles",
            Icon: Clapperboard
          },
          {
            href: `${deployment.basePath}/rewards`,
            label: "Rewards & claims",
            key: "rewards",
            Icon: Wallet
          }
        ].map(({ href, label, key, Icon }) => {
          const active = section ? section === key : pathname === href;
          return (
            <Link
              key={href}
              to={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-center text-xs font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape sm:flex-row sm:gap-2 sm:text-sm",
                active
                  ? "bg-ink text-white shadow-sm"
                  : "text-muted hover:bg-white hover:text-ink"
              )}
            >
              <Icon size={17} aria-hidden="true" /> {label}
            </Link>
          );
        })}
      </nav>
      <nav
        aria-label="Arena information"
        className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-muted sm:text-sm"
      >
        <Link
          to={`${deployment.basePath}/watch`}
          aria-current={pathname.endsWith("/watch") ? "page" : undefined}
          className="rounded hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
        >
          Watch battles
        </Link>
        <Link
          to={`${deployment.basePath}/rules`}
          aria-current={pathname.endsWith("/rules") ? "page" : undefined}
          className="inline-flex items-center gap-1.5 rounded hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
        >
          <ScrollText size={14} aria-hidden="true" /> How it works
        </Link>
        {deployment.kind === "anime" && (
          <Link
            to="/arena/anime/studio"
            aria-current={pathname.endsWith("/studio") ? "page" : undefined}
            className="rounded hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
          >
            Fighter approvals
          </Link>
        )}
      </nav>
    </div>
  );
}
