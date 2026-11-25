import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import {
  completeDiscordConnection,
  discordCollectorMessage
} from "@/lib/discordCollector";

export function DiscordCollectorCallbackPage() {
  usePageMetadata(
    "Connect Discord | Yunipals",
    "Connect your Yunipals collector wallet to Discord."
  );
  const [state, setState] = useState({
    wallet: "",
    message: "Connecting to Discord…",
    error: false
  });
  useEffect(() => {
    let mounted = true;
    void completeDiscordConnection().then(
      ({ wallet, result }) => {
        if (mounted)
          setState({
            wallet,
            message: discordCollectorMessage(result),
            error: false
          });
      },
      (error: unknown) => {
        if (mounted)
          setState({
            wallet: "",
            message:
              error instanceof Error
                ? error.message
                : "Discord connection failed.",
            error: true
          });
      }
    );
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <main className="mx-auto min-h-[60vh] max-w-xl px-5 py-16">
      <h1 className="display text-3xl text-ink">Connect Discord</h1>
      <p className="mt-4 text-muted" role={state.error ? "alert" : "status"}>
        {state.message}
      </p>
      <Link
        className="mt-6 inline-block font-bold text-ethereum"
        to={state.wallet ? `/collector/${state.wallet}` : "/leaderboard"}
      >
        {state.wallet ? "Back to your collection" : "Back to leaderboard"}
      </Link>
    </main>
  );
}
