import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Layers3, Sparkles } from "lucide-react";
import { type Hex } from "viem";
import { useAccount } from "wagmi";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterTypes,
  visibleBoosterTypes
} from "@/lib/boosters";
import { formatInteger } from "@/lib/format";
import { environment } from "@/environment";
import { BoosterPurchaseOptions } from "./BoosterPurchaseOptions";
import { BoosterPackOpening } from "./BoosterPackOpening";
import { BoosterTransactions } from "./BoosterTransactions";
import { BoosterClaimPacks } from "./BoosterClaimPacks";

export function BoosterPackSection() {
  const { address } = useAccount();
  const [preview, setPreview] = useState<number | null>(null);
  const [opening, setOpening] = useState<{ wallet: string; hash: Hex } | null>(
    null
  );
  const onConfirmed = (hash: Hex) => {
    if (address) setOpening({ wallet: address, hash });
  };
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
      className="scroll-mt-24 border-b border-line bg-gradient-to-br from-lavender/30 via-white to-mint/20 px-4 py-12 sm:py-16"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-9 max-w-3xl">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-widest text-grape">
              Collect on Base
            </p>
            <h1 className="font-display text-3xl text-ink sm:text-5xl">
              Unwrap a little magic.
            </h1>
            <p className="mt-4 max-w-2xl font-semibold text-ink sm:text-xl">
              Open a pack. Meet your first Yunipal. Then mint another every day.
            </p>
            <p className="mt-3 max-w-2xl text-muted sm:text-lg">
              Each pack unlocks its own collection of 264 unique variants.
              Unused daily mints stack up, so you can claim them later.
            </p>
          </div>
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
        <div className="grid gap-8">
          {packs.map((pack) => (
            <article
              key={pack.id}
              className="grid overflow-hidden rounded-card border border-line bg-white shadow-card md:grid-cols-2"
            >
              <div className="relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-lavender/60 via-lavender/20 to-sky/40 px-8 py-10 sm:py-12">
                <div
                  className="pointer-events-none absolute inset-0 bg-soft-orbit"
                  aria-hidden="true"
                />
                <img
                  src="/images/boosters/yunipals-pack-v1.png"
                  alt="Sealed lavender Yunipals booster pack featuring a blue Yunidragon with a golden spiral horn"
                  width={1024}
                  height={1536}
                  fetchPriority="high"
                  draggable={false}
                  className="relative w-56 max-w-full drop-shadow-xl motion-safe:animate-float sm:w-72"
                />
              </div>
              <div className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
                <p className="mb-4 flex items-center gap-2 text-sm font-bold text-grape">
                  <Sparkles size={18} aria-hidden="true" />
                  Pack #{pack.packTypeId}
                </p>
                <h2 className="font-display text-2xl text-ink sm:text-3xl">
                  Yunipals booster pack
                </h2>
                <p className="mt-3 text-muted">
                  Your first Yunipal unlocks daily mints for its own collection.
                </p>
                <ul className="my-7 space-y-4 text-sm text-muted">
                  <li className="flex gap-3">
                    <Layers3
                      className="mt-0.5 shrink-0 text-grape"
                      size={19}
                      aria-hidden="true"
                    />
                    <span>
                      <strong className="text-ink">
                        {formatInteger(pack.totalVariants)} unique variants to
                        collect.
                      </strong>{" "}
                      Your first Yunipal counts as one. Each new mint adds a
                      variant you haven’t received from this pack before.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <Clock3
                      className="mt-0.5 shrink-0 text-grape"
                      size={19}
                      aria-hidden="true"
                    />
                    <span>
                      <strong className="text-ink">
                        {pack.mintsPerInterval} additional mint
                        {pack.mintsPerInterval === 1 ? "" : "s"} every{" "}
                        {Number(pack.intervalSeconds) / 3600} hours
                      </strong>{" "}
                      after reveal. Saved mints add up while you’re away. You
                      only pay ETH for randomness and network fees.
                    </span>
                  </li>
                </ul>
                <BoosterPurchaseOptions
                  pack={pack}
                  paused={Boolean(
                    pack.salesPaused || query.data?.requestsPaused
                  )}
                  onConfirmed={onConfirmed}
                  onPreview={setPreview}
                />
              </div>
            </article>
          ))}
        </div>
        {deployment && <BoosterClaimPacks onConfirmed={onConfirmed} />}
        {deployment && (
          <BoosterTransactions
            autoOpenHash={
              opening && opening.wallet === address ? opening.hash : null
            }
            onOpeningClosed={() => setOpening(null)}
          />
        )}
        {preview !== null && (
          <BoosterPackOpening
            mode="demo"
            metadataUri={`${environment.yunipalsIndexerUrl}/v1/boosters/art/base-mainnet-smoke-v1/73.json`}
            additionalCards={Array.from(
              { length: preview - 1 },
              (_, index) => ({
                collection: "",
                tokenId: "",
                metadataUri: `${environment.yunipalsIndexerUrl}/v1/boosters/art/base-mainnet-smoke-v1/${[80, 81, 82, 83][index % 4]}.json`
              })
            )}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </section>
  );
}
