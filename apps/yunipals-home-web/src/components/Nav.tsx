import { Menu, Search, Swords, X } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { WalletCollectionButton } from "@/components/WalletCollectionButton";
import { environment } from "@/environment";
import { isSolanaAddress } from "@/lib/solanaIndexer";
import { cn } from "@/lib/utils";
import { isOwnerInput } from "@/lib/yunipalsIndexer";

const navigation = [
  { label: "Collection", to: "/" },
  { label: "Leaderboard", to: "/leaderboard" }
];

type CollectorSearchProps = {
  onNavigate?: () => void;
};

function CollectorSearch({ onNavigate }: CollectorSearchProps) {
  const navigate = useNavigate();
  const inputId = useId();
  const [address, setAddress] = useState("");
  const [error, setError] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = address.trim();

    if (
      !isOwnerInput(value) &&
      !(environment.exomonEnabled && isSolanaAddress(value))
    ) {
      setError(true);
      return;
    }

    setError(false);
    onNavigate?.();
    navigate(
      isSolanaAddress(value)
        ? `/collector/solana/${encodeURIComponent(value)}`
        : `/collector/${encodeURIComponent(value)}`
    );
  }

  return (
    <form onSubmit={submit} className="min-w-0">
      <label htmlFor={inputId} className="sr-only">
        Collector wallet address or ENS name
      </label>
      <div
        className={cn(
          "flex items-center rounded-full border bg-white p-1 shadow-sm",
          error ? "border-red-400" : "border-line"
        )}
      >
        <Search aria-hidden="true" className="ml-2 text-muted" size={15} />
        <input
          id={inputId}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            setError(false);
          }}
          placeholder={
            environment.exomonEnabled
              ? "EVM or Solana address, or ENS"
              : "Address or ENS name"
          }
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm font-medium text-ink outline-none placeholder:text-muted/70"
          aria-invalid={error}
        />
        <button
          type="submit"
          className="rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          Find
        </button>
      </div>
      {error && (
        <p
          className="mt-1 px-3 text-xs font-semibold text-red-600"
          role="alert"
        >
          {environment.exomonEnabled
            ? "Enter a valid EVM or Solana wallet address, or ENS name."
            : "Enter a valid wallet address or ENS name."}
        </p>
      )}
    </form>
  );
}

export function Nav() {
  const { pathname, search } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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
          <span
            title="Battles are coming soon"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-line whitespace-nowrap bg-line/25 px-3 py-2 text-sm font-semibold text-muted"
          >
            <Swords aria-hidden="true" size={14} />
            Battles
          </span>
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            className="hidden items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-white shadow-cta transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 xl:flex"
            aria-expanded={searchOpen}
            aria-controls="desktop-collector-search"
          >
            <Search aria-hidden="true" size={15} />
            Find collector
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            className="hidden h-10 w-10 place-items-center rounded-full bg-ink text-white shadow-cta transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 lg:grid xl:hidden"
            aria-label="Find collector"
            aria-expanded={searchOpen}
            aria-controls="desktop-collector-search"
          >
            <Search aria-hidden="true" size={16} />
          </button>
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

      {searchOpen && (
        <div
          id="desktop-collector-search"
          className="hidden border-t border-line bg-white px-4 py-3 lg:block"
        >
          <div className="mx-auto max-w-lg">
            <CollectorSearch onNavigate={() => setSearchOpen(false)} />
          </div>
        </div>
      )}

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
            <div className="rounded-2xl bg-line/30 px-4 py-3 font-semibold text-muted">
              Battles · Coming soon
            </div>
            <div className="mt-2 border-t border-line pt-4">
              <CollectorSearch onNavigate={() => setMobileMenuOpen(false)} />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
