import { useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import type { Address } from "viem";
import { dialogButtonVariants } from "@/components/ui/dialog";
import {
  discordCollectorMessage,
  DiscordCollectorError,
  getDiscordConnectionStatus,
  readDiscordStatusSession,
  requestDiscordWalletProof,
  startDiscordConnection,
  updateDiscordConnection,
  verifyDiscordConnectionStatus,
  type DiscordCollectorAction
} from "@/lib/discordCollector";

type Connection =
  | "checking"
  | "unknown"
  | "connected"
  | "disconnected"
  | "unavailable";

export function DiscordCollectorConnection({ wallet }: { wallet: Address }) {
  const { signMessageAsync } = useSignMessage();
  const [connection, setConnection] = useState<Connection>(() =>
    readDiscordStatusSession(wallet) ? "checking" : "unknown"
  );
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState<DiscordCollectorAction | null>(null);
  const [status, setStatus] = useState<{ message: string; error?: boolean }>();

  useEffect(() => {
    const session = readDiscordStatusSession(wallet);
    if (!session) return;
    const controller = new AbortController();
    void getDiscordConnectionStatus(session, controller.signal).then(
      (connected) => {
        if (!controller.signal.aborted)
          setConnection(
            connected === null
              ? "unknown"
              : connected
                ? "connected"
                : "disconnected"
          );
      },
      () => {
        if (!controller.signal.aborted) setConnection("unavailable");
      }
    );
    return () => controller.abort();
  }, [wallet, attempt]);

  async function run(action: DiscordCollectorAction) {
    setWorking(action);
    setStatus(undefined);
    try {
      const { request, message, verifier } = await requestDiscordWalletProof(
        wallet,
        action
      );
      const signature = await signMessageAsync({ account: wallet, message });
      if (action === "status") {
        const connected = await verifyDiscordConnectionStatus(
          wallet,
          request,
          signature
        );
        setConnection(connected ? "connected" : "disconnected");
        return;
      }
      if (action === "link") {
        if (!verifier)
          throw new Error("Discord authorization could not start.");
        await startDiscordConnection(wallet, request, signature, verifier);
        return;
      }
      const result = await updateDiscordConnection(action, request, signature);
      setConnection(
        result.status === "disconnected" ? "disconnected" : "connected"
      );
      setStatus({ message: discordCollectorMessage(result) });
    } catch (error) {
      if (error instanceof DiscordCollectorError && error.code === "not_linked")
        setConnection("disconnected");
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
      <p className="mt-1 text-sm text-muted" role="status">
        {connection === "checking" && "Checking your Discord connection…"}
        {connection === "unknown" &&
          "Sign a wallet message to check whether Discord is linked."}
        {connection === "unavailable" &&
          "Couldn’t check your Discord connection. Try again."}
        {connection === "connected" && "Discord connected"}
        {connection === "disconnected" &&
          "Connect Discord to display your collector role and leaderboard tier in the server."}
      </p>
      {connection === "unknown" && (
        <button
          type="button"
          className={dialogButtonVariants({ className: "mt-3" })}
          disabled={working !== null}
          onClick={() => void run("status")}
        >
          {working === "status" ? "Checking…" : "Check Discord connection"}
        </button>
      )}
      {connection === "unavailable" && (
        <button
          type="button"
          className={dialogButtonVariants({
            variant: "secondary",
            className: "mt-3"
          })}
          onClick={() => {
            setConnection("checking");
            setAttempt((count) => count + 1);
          }}
        >
          Try again
        </button>
      )}
      {connection === "disconnected" && (
        <button
          type="button"
          className={dialogButtonVariants({ className: "mt-3" })}
          disabled={working !== null}
          onClick={() => void run("link")}
        >
          {working === "link" ? "Connecting…" : "Connect Discord"}
        </button>
      )}
      {connection === "connected" && (
        <div className="mt-3 flex flex-wrap gap-2">
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
      )}
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
