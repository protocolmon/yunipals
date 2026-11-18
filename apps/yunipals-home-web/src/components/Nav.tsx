import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { WalletCollectionButton } from "@/components/WalletCollectionButton";
import { environment } from "@/environment";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Collection", to: "/" },
  ...(environment.boostersEnabled ||
  environment.boosterLaunchId === "base-ypal-v1"
    ? [{ label: "Packs", to: "/boosters" }]
    : []),
  ...(environment.portalsEnabled ? [{ label: "Grading", to: "/grading" }] : []),
  { label: "Leaderboard", to: "/leaderboard" },
  { label: "Arena", to: "/arena" }
];

export function Nav() {
  const { pathname, search } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isExomonView =
    environment.exomonEnabled &&
    (pathname === "/exomon" ||
      (pathname === "/" &&
        new URLSearchParams(search).getAll("chain").join(",") === "solana") ||
      pathname.startsWith("/collection/solana/") ||
      pathname.startsWith("/collector/solana/") ||
      (pathname === "/leaderboard" &&
        new URLSearchParams(search).get("chain") === "solana"));
  const isActive = (to: string) =>
    to === "/"
      ? pathname === "/" ||
        pathname.startsWith("/collection/") ||
        pathname === "/exomon"
      : to === "/leaderboard"
        ? pathname === "/leaderboard"
        : pathname === to || pathname.startsWith(`${to}/`);

  const navClass = (active: boolean) =>
    cn(
      "whitespace-nowrap rounded-full border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-2",
      active
        ? "border-badge/60 bg-badge/10 text-badge"
        : "border-line text-ink hover:bg-line/40"
    );

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link
          to="/"
          className="inline-flex shrink-0 items-center gap-2.5 rounded-xl text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
          aria-label="Yunipals home"
          onClick={() => setMobileMenuOpen(false)}
        >
          <img
            src="/images/yunipals-logo.webp"
            alt=""
            width={192}
            height={192}
            className="h-10 w-10"
          />
          <span className="display text-xl sm:text-2xl">Yunipals</span>
        </Link>

        <nav
          className="hidden items-center gap-2 lg:flex"
          aria-label="Primary navigation"
        >
          {navigation.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isActive(item.to) ? "page" : undefined}
              className={navClass(isActive(item.to))}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {!isExomonView && <WalletCollectionButton />}
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-2 lg:hidden"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-controls="mobile-navigation"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? (
              <X aria-hidden="true" size={19} />
            ) : (
              <Menu aria-hidden="true" size={19} />
            )}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav
          id="mobile-navigation"
          className="border-t border-line bg-white px-4 py-4 lg:hidden"
          aria-label="Mobile navigation"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-2">
            {navigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={isActive(item.to) ? "page" : undefined}
                className={cn(
                  "rounded-2xl px-4 py-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge",
                  isActive(item.to)
                    ? "bg-badge/10 text-badge"
                    : "text-ink hover:bg-line/40"
                )}
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
