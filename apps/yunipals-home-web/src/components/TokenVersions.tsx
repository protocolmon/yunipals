import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { environment } from "@/environment";
import { collectionChainDetails } from "@/data/chains";
import {
  fetchVersionCapabilities,
  fetchVersionSummaries,
  monsterAssetKey
} from "@/lib/monsterVersions";
import type { YunipalToken } from "@/lib/yunipalsIndexer";

/** Relationship reads are limited to an individual Base NFT's detail page. */
export function TokenVersionInfo({ token }: { token: YunipalToken }) {
  const enabled = environment.monsterVersionsEnabled && token.chain === "base";
  const capabilities = useQuery({
    queryKey: ["monster-version-capabilities"],
    queryFn: ({ signal }) => fetchVersionCapabilities(signal),
    enabled,
    staleTime: 60_000,
    retry: false
  });
  const key = monsterAssetKey(token);
  const summary = useQuery({
    queryKey: [
      "monster-version-summary",
      capabilities.data?.revision,
      key,
      token.lifecycle
    ],
    queryFn: ({ signal }) => fetchVersionSummaries([token], signal),
    enabled: enabled && Boolean(capabilities.data),
    staleTime: 30_000,
    retry: false
  });
  const info = enabled && capabilities.data ? summary.data?.[key] : undefined;
  const original = info?.versions.find(
    (version) => version.role === "original"
  );
  if (!enabled) return null;
  if (capabilities.isError || summary.isError)
    return (
      <p className="mt-5 text-sm text-muted">
        Original NFT information is temporarily unavailable.
      </p>
    );
  if (!original || info?.role !== "airdrop") return null;
  return (
    <section
      className="mt-5 rounded-card border border-line bg-white p-5"
      aria-label="Original NFT"
    >
      <h2 className="font-bold text-ink">Airdropped from an original NFT</h2>
      <p className="mt-2 text-sm text-muted">
        This Base monster was airdropped based on the original NFT on{" "}
        {collectionChainDetails[original.chain].label}. Each NFT has its own
        owner. Buying or transferring one does not include the other.
      </p>
      <Link
        to={`/collection/${original.chain}/${original.tokenId}`}
        className="mt-3 inline-flex rounded-full border border-line px-4 py-2 text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
      >
        View {collectionChainDetails[original.chain].label} original
        {original.chain !== "solana" && ` #${original.tokenId}`}
        {original.unavailable
          ? " · Ownership unavailable"
          : original.burned
            ? " · Burned"
            : ""}
      </Link>
    </section>
  );
}
