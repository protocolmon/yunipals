import { useAccountModal } from "@rainbow-me/rainbowkit";
import {
  ChevronDown,
  ClipboardList,
  Loader2,
  Settings,
  WalletCards
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";

import { useAnalyticsConnectModal } from "@/hooks/useAnalyticsConnectModal";
import { environment } from "@/environment";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

export function WalletCollectionButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { address, isConnected, status } = useAccount();
  const { openConnectModal } = useAnalyticsConnectModal("navigation");
  const { openAccountModal } = useAccountModal();
  const connectionRequested = useRef(false);
  const menuContainer = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!connectionRequested.current || !isConnected || !address) return;

    connectionRequested.current = false;
    navigate(`/collector/${address.toLowerCase()}`);
  }, [address, isConnected, navigate]);

  useEffect(() => setMenuOpen(false), [address, isConnected, pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    function dismissOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !menuContainer.current?.contains(event.target)
      )
        setMenuOpen(false);
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      menuTrigger.current?.focus();
    }

    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [menuOpen]);

  const connecting = status === "connecting" || status === "reconnecting";

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        onClick={() => {
          connectionRequested.current = true;
          openConnectModal?.();
        }}
        disabled={environment.fixtures || !openConnectModal || connecting}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-ink px-3 text-sm font-bold text-white shadow-cta transition hover:opacity-90 disabled:cursor-wait disabled:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 sm:px-4"
      >
        {connecting ? (
          <Loader2 aria-hidden="true" className="animate-spin" size={16} />
        ) : (
          <WalletCards aria-hidden="true" size={16} />
        )}
        <span className="sm:hidden">
          {connecting ? "Connecting" : "Connect"}
        </span>
        <span className="hidden sm:inline">
          {connecting ? "Connecting…" : "Connect wallet"}
        </span>
      </button>
    );
  }

  const collectionPath = `/collector/${address.toLowerCase()}`;
  const accountLinkClass = (active: boolean) =>
    cn(
      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge",
      active ? "bg-badge/10 text-badge" : "text-ink hover:bg-line/50"
    );

  return (
    <div ref={menuContainer} className="relative shrink-0">
      <div className="flex h-10 overflow-hidden rounded-full bg-ink text-white shadow-cta">
        <button
          type="button"
          onClick={() => navigate(collectionPath)}
          className="inline-flex min-w-0 items-center gap-2 px-3 text-sm font-bold transition hover:bg-white/10 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:px-4"
          aria-label={`View my collection for ${address}`}
        >
          <WalletCards aria-hidden="true" className="shrink-0" size={16} />
          <span className="hidden sm:inline">My collection</span>
          <span className="hidden font-mono text-xs text-white/65 lg:inline">
            {shortAddress(address)}
          </span>
        </button>
        <button
          ref={menuTrigger}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="grid w-9 shrink-0 place-items-center border-l border-white/15 transition hover:bg-white/10 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="wallet-account-menu"
        >
          <ChevronDown
            aria-hidden="true"
            size={15}
            className={cn("transition-transform", menuOpen && "rotate-180")}
          />
        </button>
      </div>

      {menuOpen && (
        <div
          id="wallet-account-menu"
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 rounded-2xl border border-line bg-white p-2 text-ink shadow-cardHover"
        >
          <p className="px-3 pb-2 pt-1 font-mono text-xs text-muted">
            {shortAddress(address)}
          </p>
          <Link
            to={collectionPath}
            role="menuitem"
            aria-current={
              pathname.toLowerCase() === collectionPath ? "page" : undefined
            }
            className={accountLinkClass(
              pathname.toLowerCase() === collectionPath
            )}
          >
            <WalletCards aria-hidden="true" size={17} />
            My collection
          </Link>
          <Link
            to="/orders"
            role="menuitem"
            aria-current={pathname.startsWith("/orders") ? "page" : undefined}
            className={accountLinkClass(pathname.startsWith("/orders"))}
          >
            <ClipboardList aria-hidden="true" size={17} />
            My orders
          </Link>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            disabled={!openAccountModal}
            onClick={() => {
              setMenuOpen(false);
              openAccountModal?.();
            }}
            className={cn(
              accountLinkClass(false),
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <Settings aria-hidden="true" size={17} />
            Wallet settings
          </button>
        </div>
      )}
    </div>
  );
}
