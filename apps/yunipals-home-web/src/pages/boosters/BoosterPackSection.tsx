import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterTypes,
  visibleBoosterTypes
} from "@/lib/boosters";
import { formatInteger } from "@/lib/format";
import { BoosterActionButton } from "./BoosterActionButton";
import { BoosterTransactions } from "./BoosterTransactions";

export function BoosterPackSection() {
  const { address } = useAccount();
  const deployment = boosterAddresses();
  const query = useQuery({
    queryKey: [...boosterQueryKey, "types"],
    queryFn: ({ signal }) => fetchBoosterTypes(signal),
    enabled: deployment !== null,
    refetchInterval: 15_000
  });
  const packs =
    visibleBoosterTypes(query.data?.items ?? [], address).filter(
      (pack) =>
        pack.registry.toLowerCase() === deployment?.registry &&
        pack.engine.toLowerCase() === deployment.engine
    ) ?? [];
  return (
    <section
      id="booster-packs"
      className="scroll-mt-24 border-b border-line bg-gradient-to-br from-lavender/30 to-mint/30 px-4 py-12"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-widest text-muted">
              Collect on Base
            </p>
            <h2 className="font-display text-3xl text-ink">
              Yunipal booster packs
            </h2>
            <p className="mt-3 max-w-2xl text-muted">
              One original starts a collection. It earns more Yunipals over
              time, with unused days saved and no duplicate variants within its
              collection.
            </p>
          </div>
          <Link
            to="/boosters"
            className="rounded-full border border-ink px-5 py-3 text-sm font-bold text-ink focus-visible:ring-2 focus-visible:ring-ink"
          >
            Packs and daily mints
          </Link>
        </div>
        {!deployment && (
          <p className="rounded-card border border-line bg-white p-6 text-muted">
            Coming soon. Pack traits and artwork are being prepared.
          </p>
        )}
        {deployment && query.isPending && (
          <div
            role="status"
            className="h-40 animate-pulse rounded-card bg-white"
          >
            <span className="sr-only">Loading packs…</span>
          </div>
        )}
        {query.error && (
          <p role="alert" className="rounded-card bg-white p-6">
            {query.error.message}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void query.refetch()}
            >
              Try again
            </button>
          </p>
        )}
        {query.data && packs.length === 0 && (
          <p className="rounded-card bg-white p-6 text-muted">
            Public packs are coming soon. You can still explore your collection.
          </p>
        )}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {packs.map((pack) => (
            <article
              key={pack.id}
              className="rounded-card border border-line bg-white p-6 shadow-card"
            >
              <Sparkles
                className="mb-5 h-8 w-8 text-grape"
                aria-hidden="true"
              />
              <h3 className="text-xl font-bold">Pack #{pack.packTypeId}</h3>
              <p className="mt-2 text-sm text-muted">
                {formatInteger(pack.totalVariants)} possible variants.{" "}
                {pack.mintsPerInterval} additional mint
                {pack.mintsPerInterval === 1 ? "" : "s"} every{" "}
                {Number(pack.intervalSeconds) / 3600} hours after reveal.
              </p>
              <p className="mt-3 text-sm text-muted">
                Every remaining variant has the same chance on each draw. As
                variants are collected, the mix of remaining traits changes.
              </p>
              <p className="my-5 font-bold">
                {pack.paymentToken.toLowerCase() ===
                "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3"
                  ? `${formatUnits(BigInt(pack.price), 18)} PROTO`
                  : "See payment details in review"}{" "}
                <span className="font-normal text-muted">
                  + ETH for VRF and gas
                </span>
              </p>
              <BoosterActionButton
                action={{ kind: "open", packTypeId: pack.packTypeId }}
                disabled={pack.salesPaused || query.data?.requestsPaused}
              >
                {pack.salesPaused || query.data?.requestsPaused
                  ? "Openings paused"
                  : "Open pack"}
              </BoosterActionButton>
            </article>
          ))}
        </div>
        {deployment && <BoosterTransactions />}
      </div>
    </section>
  );
}
