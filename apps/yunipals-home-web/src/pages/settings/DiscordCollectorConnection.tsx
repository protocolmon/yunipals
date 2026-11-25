import { useState } from "react";
import { useSignMessage } from "wagmi";
import type { Address } from "viem";
import { dialogButtonVariants } from "@/components/ui/dialog";
import {
  discordCollectorMessage,
  requestDiscordWalletProof,
  startDiscordConnection,
  updateDiscordConnection,
  type DiscordCollectorAction
} from "@/lib/discordCollector";

export function DiscordCollectorConnection({ wallet }: { wallet: Address }) {
  const { signMessageAsync } = useSignMessage();
  const [working, setWorking] = useState<DiscordCollectorAction | null>(null);
  const [status, setStatus] = useState<{ message: string; error?: boolean }>();

  async function run(action: DiscordCollectorAction) {
    setWorking(action);
    setStatus(undefined);
    try {
      const { request, message, verifier } = await requestDiscordWalletProof(
        wallet,
        action
      );
      const signature = await signMessageAsync({ account: wallet, message });
      if (action === "link" && verifier) {
        await startDiscordConnection(wallet, request, signature, verifier);
        return;
      }
      if (action === "link")
        throw new Error("Discord authorization could not start.");
      const result = await updateDiscordConnection(action, request, signature);
      setStatus({ message: discordCollectorMessage(result) });
    } catch (error) {
      const rejected =
        error instanceof Error && /reject|denied/i.test(error.message);
      setStatus({
        message: rejected
          ? "Wallet signature canceled."
          : error instanceof Error && error.message.length < 180
            ? error.message
            : "Discord connection failed. Try again.",
        error: true
      });
    } finally {
      setWorking(null);
    }
  }

  return (
    <section
      className="rounded-2xl border border-line p-5"
      aria-labelledby="discord-collector-title"
    >
      <h2 id="discord-collector-title" className="font-bold text-ink">
        Yunipals on Discord
      </h2>
      <p className="mt-1 text-sm text-muted">
        Connect Discord to display your collector role and leaderboard tier in
        the server. Your wallet will ask for a signature.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={dialogButtonVariants()}
          disabled={working !== null}
          onClick={() => void run("link")}
        >
          {working === "link" ? "Connecting…" : "Connect Discord"}
        </button>
      </div>
      <details className="mt-3 text-sm text-muted">
        <summary className="w-fit cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-grape">
          Manage existing connection
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={dialogButtonVariants({ variant: "secondary" })}
            disabled={working !== null}
            onClick={() => void run("refresh")}
          >
            {working === "refresh" ? "Refreshing…" : "Refresh roles"}
          </button>
          <button
            type="button"
            className={dialogButtonVariants({ variant: "secondary" })}
            disabled={working !== null}
            onClick={() => void run("unlink")}
          >
            {working === "unlink" ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </details>
      {status && (
        <p
          className="mt-3 text-sm text-ink"
          role={status.error ? "alert" : "status"}
        >
          {status.message}
        </p>
      )}
    </section>
  );
}
