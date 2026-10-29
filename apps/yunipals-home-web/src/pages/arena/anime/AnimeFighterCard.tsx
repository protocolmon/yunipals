import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract
} from "wagmi";
import { BaseError, type Address } from "viem";
import { animeRegistryAbi } from "@protopals/yunipals-market-core/animeRegistryAbi";
import {
  ANIME_REASONS,
  type AnimeFighter,
  type AnimeManifest
} from "@protopals/yunipals-market-core/anime";
import { environment } from "@/environment";
import { arenaRequestAt } from "@/lib/arenaLive";
import { AnimeKitPreview } from "./AnimeKitPreview";

type FighterResponse = {
  fighter: AnimeFighter;
  registry: Address;
  applicationsOpen: boolean;
  assetsOrigin: string;
  manifest?: AnimeManifest | null;
  notePendingIndexing?: boolean;
  artworkState?: string;
};
export function AnimeFighterCard({
  tokenId,
  owner
}: {
  tokenId: string;
  owner: string;
}) {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["anime-fighter", tokenId],
    enabled: !!environment.animeArenaApiUrl,
    queryFn: ({ signal }) =>
      arenaRequestAt<FighterResponse>(
        environment.animeArenaApiUrl,
        `/fighters/${tokenId}`,
        undefined,
        signal
      ),
    refetchInterval: 15000
  });
  const data = query.data,
    fighter = data?.fighter;
  const owned = !!address && address.toLowerCase() === owner.toLowerCase();
  async function apply() {
    if (!data || !owned || !client) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (chainId !== 8453) await switchChainAsync({ chainId: 8453 });
      const hash = await writeContractAsync({
        chainId: 8453,
        address: data.registry,
        abi: animeRegistryAbi,
        functionName: "applyForArena",
        args: [BigInt(tokenId)]
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("The application transaction did not succeed.");
      setMessage(
        "Application confirmed. The public queue will update shortly."
      );
      await query.refetch();
    } catch (e) {
      setError(
        e instanceof BaseError
          ? e.shortMessage
          : e instanceof Error
            ? e.message
            : "Application unavailable. Try again."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="mt-6 space-y-3 rounded-card border border-line bg-panel-base p-5"
      aria-labelledby="anime-fighter-heading"
    >
      <h2 id="anime-fighter-heading" className="text-xl font-bold">
        Anime Arena
      </h2>
      <p className="text-sm text-muted">
        Turn this Base OG Yunipal into a reviewed anime fighter. Applying costs
        Base gas only. Approved entry costs 1 USDC.
      </p>
      {!environment.animeArenaApiUrl ? (
        <p>Applications are being prepared for launch.</p>
      ) : query.isPending ? (
        <div
          className="h-12 animate-pulse rounded-card bg-lavender/30"
          aria-label="Loading fighter status"
        />
      ) : query.error ? (
        <p role="alert">
          Fighter status is temporarily unavailable.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        fighter && (
          <>
            <p className="font-semibold">
              {fighter.status === "None" ? "Not applied" : fighter.status}
            </p>
            {fighter.status === "Applied" && (
              <p className="text-sm">
                Application #{fighter.applications}
                {fighter.queuePosition
                  ? ` · Queue position ${fighter.queuePosition}`
                  : ""}
                . Awaiting curator review.
              </p>
            )}
            {["Rejected", "Revoked"].includes(fighter.status) && (
              <div className="space-y-2 text-sm">
                <p>
                  {data?.notePendingIndexing
                    ? "The public reason and curator note are waiting for indexing."
                    : ANIME_REASONS[fighter.reasonCode ?? 0]}
                </p>
                {fighter.note && (
                  <p className="whitespace-pre-wrap break-words">
                    Curator note: {fighter.note}
                  </p>
                )}
                {fighter.status === "Revoked" && (
                  <p>Awaiting curator re-approval.</p>
                )}
              </div>
            )}
            {fighter.status === "Approved" && (
              <>
                {data?.manifest && (
                  <img
                    src={`${data.assetsOrigin}/fighters/v1/${tokenId}/${data.manifest.sprites.idle!.file}`}
                    alt={`${data.manifest.identity.species} anime fighter`}
                    className="h-48 w-full rounded-card object-contain"
                  />
                )}
                {data?.artworkState === "unavailable" && (
                  <p className="text-sm">
                    Approved artwork is awaiting a publication check.
                  </p>
                )}
                {data?.manifest?.kits && (
                  <div
                    className="grid gap-3 sm:grid-cols-3"
                    aria-label="Signature techniques"
                  >
                    {data.manifest.kits.map((kit) => (
                      <div
                        key={kit.id}
                        className="space-y-2 rounded-2xl border border-line p-3"
                      >
                        <AnimeKitPreview
                          kit={kit}
                          assetsOrigin={data.assetsOrigin}
                        />
                        <h3 className="font-semibold">{kit.name}</h3>
                        <p className="text-xs capitalize text-muted">
                          {kit.element}
                        </p>
                        <p className="text-sm">{kit.description}</p>
                      </div>
                    ))}
                  </div>
                )}
                <a
                  href={`${data?.assetsOrigin}/fighters/v1/${tokenId}/card.jpg`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-sm underline"
                >
                  View fighter card
                </a>
                <p className="text-sm">
                  This approval and its fighter art follow the NFT when it is
                  sold.
                </p>
                <Link
                  to="/arena/anime"
                  className="inline-block rounded-full bg-grape px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
                >
                  Enter the anime arena
                </Link>
              </>
            )}
            {owned && ["None", "Rejected"].includes(fighter.status) && (
              <button
                type="button"
                disabled={busy || !data?.applicationsOpen}
                onClick={() => void apply()}
                className="rounded-full bg-ink px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape disabled:opacity-50"
              >
                {busy
                  ? "Confirming application…"
                  : fighter.status === "Rejected"
                    ? "Reapply"
                    : "Apply"}
              </button>
            )}
            {data && !data.applicationsOpen && (
              <p className="text-sm text-muted">
                New applications are paused while the curator handles the queue.
              </p>
            )}
          </>
        )
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Link
        to="/arena/anime/studio"
        className="block text-sm font-semibold underline"
      >
        View the public queue
      </Link>
    </section>
  );
}
