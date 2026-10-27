import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterMonster,
  fetchBoosterOriginal,
  fetchMonsterArtwork
} from "@/lib/boosters";
import { BoosterPackSection } from "./BoosterPackSection";
import { BoosterArtwork } from "./BoosterCollection";
import { BoosterOriginalControls } from "./BoosterOriginalControls";
import { BoosterActionButton } from "./BoosterActionButton";
import { BoosterFAQ } from "./BoosterFAQ";
import { BoosterBirthDetails } from "./BoosterBirthDetails";
import { BoosterRecentOpenings } from "./BoosterRecentOpenings";

export function BoosterPage() {
  return (
    <main>
      <BoosterPackSection />
      <BoosterRecentOpenings />
      <BoosterFAQ />
    </main>
  );
}

export function BoosterMonsterPage() {
  const { collection = "", tokenId = "" } = useParams();
  const { address } = useAccount();
  const deployment = boosterAddresses();
  const enabled =
    deployment !== null &&
    isAddress(collection) &&
    collection.toLowerCase() === deployment.monsters &&
    /^(0|[1-9][0-9]{0,77})$/.test(tokenId);
  const query = useQuery({
    queryKey: [...boosterQueryKey, "monster", collection, tokenId],
    enabled,
    queryFn: ({ signal }) => fetchBoosterMonster(collection, tokenId, signal),
    refetchInterval: 10_000
  });
  const monster = query.data?.item;
  const artwork = useQuery({
    queryKey: [...boosterQueryKey, "artwork", monster?.metadataUri],
    enabled: Boolean(monster),
    queryFn: ({ signal }) => fetchMonsterArtwork(monster!.metadataUri, signal),
    staleTime: Infinity,
    retry: 1,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== "ready" ? 5000 : false
  });
  const original = useQuery({
    queryKey: [...boosterQueryKey, "original", collection, tokenId],
    enabled: Boolean(monster?.isOriginal),
    queryFn: ({ signal }) => fetchBoosterOriginal(collection, tokenId, signal),
    refetchInterval: 10_000
  });
  return (
    <main className="mx-auto min-h-[65vh] max-w-5xl px-4 py-12">
      <Link to="/boosters" className="text-sm font-bold underline">
        Back to booster packs
      </Link>
      {!enabled && (
        <p className="mt-5">Booster collection details are unavailable.</p>
      )}
      {enabled && query.isPending && (
        <p role="status" className="mt-5 animate-pulse">
          Loading Yunipal…
        </p>
      )}
      {query.error && (
        <p role="alert" className="mt-5">
          {query.error.message}{" "}
          <button
            className="underline"
            type="button"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {monster && (
        <div className="mt-7 grid gap-8 md:grid-cols-2">
          <BoosterArtwork
            uri={monster.metadataUri}
            label={`Yunipal #${monster.tokenId}`}
            interactive
          />
          <div>
            <h1 className="font-display text-3xl">
              Yunipal #{monster.tokenId}
            </h1>
            {artwork.data?.name && (
              <p className="mt-2 font-bold">{artwork.data.name}</p>
            )}
            <p className="mt-2 text-muted">
              Pack collection · Base ·{" "}
              {monster.isOriginal ? "Original" : "Offspring"}
              {monster.burned && " · Burned"}
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              {[
                ["Type", monster.monsterType],
                ["Color", monster.color],
                ["Horn", monster.horn],
                ["Glitter", monster.glitter],
                ["Variant", monster.variantId]
              ].map(([name, value]) => (
                <div key={name}>
                  <dt className="text-muted">{name}</dt>
                  <dd className="font-bold">
                    {artwork.data?.attributes[name.toLowerCase()]
                      ? `${
                          artwork.data.attributes[name.toLowerCase()]
                        } (${value})`
                      : value}
                  </dd>
                </div>
              ))}
            </dl>
            <BoosterBirthDetails
              collection={monster.collection}
              tokenId={monster.tokenId}
            />
            {!monster.burned && (
              <Link
                className="mt-5 block break-all text-sm underline"
                to={`/collector/${monster.owner}`}
              >
                Owner: {monster.owner}
              </Link>
            )}
            {original.data && (
              <BoosterOriginalControls original={original.data.item} />
            )}
            {original.error && (
              <p role="alert" className="mt-4">
                Mint-rights data is temporarily unavailable.
              </p>
            )}
            {!monster.isOriginal && (
              <Link
                className="mt-5 block text-sm underline"
                to={`/monsters/${monster.collection}/${monster.originalKey
                  .split(":")
                  .at(-1)}`}
              >
                View original
              </Link>
            )}
            {!monster.burned &&
              address?.toLowerCase() === monster.owner.toLowerCase() && (
                <div className="mt-8">
                  <BoosterActionButton
                    action={{ kind: "burn", tokenId: monster.tokenId }}
                    className="border border-line bg-white text-ink"
                  >
                    Burn Yunipal
                  </BoosterActionButton>
                </div>
              )}
          </div>
        </div>
      )}
    </main>
  );
}
