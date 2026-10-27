import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { isAddress } from "viem";
import { ArrowUpRight, UserRound } from "lucide-react";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterMonster,
  fetchBoosterOriginal,
  fetchMonsterArtwork
} from "@/lib/boosters";
import { shortAddress } from "@/lib/format";
import { BoosterPackSection } from "./BoosterPackSection";
import { BoosterArtwork } from "./BoosterCollection";
import { BoosterOriginalControls } from "./BoosterOriginalControls";
import { BoosterFAQ } from "./BoosterFAQ";
import { BoosterBirthDetails } from "./BoosterBirthDetails";
import { BoosterRecentOpenings } from "./BoosterRecentOpenings";

export function BoosterPage() {
  const [search] = useSearchParams();
  const original = search.get("original");
  const deployment = boosterAddresses();
  if (
    deployment &&
    original &&
    /^(0|[1-9][0-9]{0,77})$/.test(original) &&
    !search.has("opening")
  )
    return (
      <Navigate replace to={`/monsters/${deployment.monsters}/${original}`} />
    );
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
      <Link
        to="/collection?edition=tcg#collection"
        className="text-sm font-bold underline"
      >
        Back to collection
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
              <div className="mt-5 text-sm">
                <p className="mb-2 text-muted">Owner</p>
                <Link
                  className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-bold transition-colors hover:border-grape/30 hover:bg-lavender/20 focus-visible:ring-2 focus-visible:ring-grape"
                  to={`/collector/${monster.owner}`}
                  title={monster.owner}
                  aria-label={`View collection owned by ${monster.owner}`}
                >
                  <UserRound
                    size={16}
                    className="text-grape"
                    aria-hidden="true"
                  />
                  {shortAddress(monster.owner)}
                  <ArrowUpRight
                    size={16}
                    className="text-muted"
                    aria-hidden="true"
                  />
                </Link>
              </div>
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
          </div>
        </div>
      )}
    </main>
  );
}
