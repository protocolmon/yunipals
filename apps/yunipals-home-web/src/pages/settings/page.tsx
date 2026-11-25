import { useAccount } from "wagmi";

import { dialogButtonVariants } from "@/components/ui/dialog";
import { environment } from "@/environment";
import { useAnalyticsConnectModal } from "@/hooks/useAnalyticsConnectModal";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { DiscordCollectorConnection } from "./DiscordCollectorConnection";

export function SettingsPage() {
  const { address, isConnected, status } = useAccount();
  const { openConnectModal } = useAnalyticsConnectModal("navigation");
  const connecting = status === "connecting" || status === "reconnecting";
  usePageMetadata(
    "Settings | Yunipals",
    "Manage your Yunipals Discord connection."
  );

  return (
    <main className="mx-auto min-h-[65vh] max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-6 flex items-center gap-4">
        <img
          src="/images/yunipals-polygon-square.webp"
          alt=""
          width={64}
          height={64}
          className="size-16 rounded-2xl object-cover"
        />
        <h1 className="display text-4xl text-ink">Settings</h1>
      </header>
      {isConnected && address ? (
        <DiscordCollectorConnection key={address} wallet={address} />
      ) : (
        <section
          className="rounded-2xl border border-line p-5"
          aria-labelledby="discord-collector-title"
        >
          <h2 id="discord-collector-title" className="font-bold text-ink">
            Yunipals on Discord
          </h2>
          <p className="mt-1 text-sm text-muted">
            Connect your wallet to manage your Discord collector roles.
          </p>
          <button
            type="button"
            className={dialogButtonVariants({ className: "mt-3" })}
            disabled={environment.fixtures || !openConnectModal || connecting}
            onClick={openConnectModal}
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        </section>
      )}
    </main>
  );
}
