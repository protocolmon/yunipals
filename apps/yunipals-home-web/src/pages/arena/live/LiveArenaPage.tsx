import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatUnits, type Hex } from "viem";
import { useAccount } from "wagmi";
import type {
  ArenaPublicTournament,
  ArenaSeat
} from "@protopals/yunipals-market-core/arena";
import { environment } from "@/environment";
import {
  arenaRequest,
  fetchArenaTournament,
  type ArenaConfig
} from "@/lib/arenaLive";
import { cn } from "@/lib/utils";
import { fetchOwnerTokens, type IndexedChain } from "@/lib/yunipalsIndexer";
import { ArenaFilm } from "./ArenaFilm";
import {
  ArenaCardsLoading,
  ArenaLoading,
  ArenaTransactionFeedback
} from "./ArenaFeedback";
import { useArenaWallet } from "./useArenaWallet";
import { useArenaClock } from "./useArenaClock";

const action =
  "rounded-full bg-ink px-6 py-3 font-semibold text-white transition hover:bg-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-40";
const phases = {
  open: "Gathering fighters",
  strategies: "Choose your strategy",
  resolving: "The referee is deciding",
  settled: "Battle decided",
  expired: "Entry refunds available"
};
const chains: Record<number, IndexedChain> = {
  1: "ethereum",
  8453: "base",
  137: "polygon",
  56: "bnb"
};
type Context = {
  rules: { combat: Record<string, unknown> };
  island: {
    tokenId: string;
    name: string;
    image: string;
    traits: Record<string, string>;
    profile: Record<string, unknown>;
  } | null;
  roster: Array<{
    id: string;
    name: string;
    image: string;
    identity: string;
    locomotion: "ground" | "flight";
  } | null>;
  tiePriority: string[];
  ready: boolean;
};

function FighterSeat({
  seat,
  fighter,
  number,
  strategyStatus
}: {
  seat?: ArenaSeat;
  fighter?: Context["roster"][number];
  number: number;
  strategyStatus: string;
}) {
  return (
    <article className="rounded-card border border-line bg-white p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">
        Fighter {number + 1} · Semifinal {number < 2 ? "1" : "2"}
      </div>
      {seat ? (
        <>
          {fighter?.image ? (
            <img
              src={fighter.image}
              alt={fighter.name}
              className="aspect-square w-full rounded-card object-cover"
            />
          ) : (
            <div className="aspect-square rounded-card bg-lavender/30" />
          )}
          <Link
            className="mt-3 block font-bold hover:underline"
            to={`/collection/${chains[seat.nftChainId]}/${seat.tokenId}`}
          >
            {fighter?.name ?? `Yunipal #${seat.tokenId}`}
          </Link>
          {fighter ? (
            <details className="mt-2 text-sm text-muted">
              <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape">
                {fighter.locomotion === "flight" ? "Flies" : "Ground movement"}{" "}
                · Fighter details
              </summary>
              <p className="mt-2">{fighter.identity}</p>
            </details>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Fighter reference is loading.
            </p>
          )}
          <p className="mt-1 text-sm text-muted">{strategyStatus}</p>
        </>
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-card border border-dashed border-line text-muted">
          Open seat
        </div>
      )}
    </article>
  );
}

function StrategyEditor({
  tournament,
  seat,
  busy,
  submit
}: {
  tournament: ArenaPublicTournament;
  seat: ArenaSeat;
  busy: boolean;
  submit: (
    id: string,
    seat: number,
    text: string,
    incarnation?: Hex
  ) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const locked = tournament.submittedSeats.includes(seat.seat);
  const now = useArenaClock();
  const closed = now >= tournament.deadline;
  return (
    <section className="rounded-card border border-line p-5">
      <h3 className="font-bold">Your strategy · Yunipal #{seat.tokenId}</h3>
      {locked ? (
        <p className="mt-3 text-muted">
          Locked. All four strategies will appear together after confirmation.
        </p>
      ) : closed ? (
        <p role="status" className="mt-3 text-muted">
          The strategy deadline has passed. An automatic legal attack will be
          assigned; your entry stays in the pool.
        </p>
      ) : (
        <>
          <label
            htmlFor={`strategy-${seat.seat}`}
            className="my-3 block text-sm text-muted"
          >
            Describe your attacks, defenses and conditional plan for the final.
          </label>
          <textarea
            id={`strategy-${seat.seat}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2400}
            rows={6}
            disabled={busy}
            className="w-full rounded-card border border-line p-4 focus-visible:outline-grape"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted">
              {text.length}/2400 · Submission is final
            </span>
            <button
              className={action}
              disabled={busy || !text.trim()}
              onClick={() =>
                void submit(
                  tournament.id,
                  seat.seat,
                  text,
                  tournament.incarnation
                )
              }
            >
              Sign & lock strategy
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function LiveArenaPage() {
  const { id } = useParams<{ id: string }>();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const configured = !!environment.arenaApiUrl;
  const config = useQuery({
    queryKey: ["arena-live", "config"],
    queryFn: ({ signal }) =>
      arenaRequest<ArenaConfig>("/config", undefined, signal),
    enabled: configured,
    staleTime: 60_000
  });
  const list = useQuery({
    queryKey: ["arena-live", "list"],
    queryFn: ({ signal }) =>
      arenaRequest<{ items: ArenaPublicTournament[] }>(
        "/tournaments",
        undefined,
        signal
      ),
    enabled: configured,
    refetchInterval: 15000
  });
  const detail = useQuery({
    queryKey: ["arena-live", "tournament", id],
    queryFn: ({ signal }) => fetchArenaTournament(id!, signal),
    enabled: configured && !!id,
    refetchInterval: 10000
  });
  const tournament = id
    ? detail.data
    : (list.data?.items.find((t) => t.phase === "open") ?? list.data?.items[0]);
  const showResults = revealedId === tournament?.id;
  const context = useQuery({
    queryKey: [
      "arena-live",
      "context",
      tournament?.id,
      tournament?.islandId,
      tournament?.seats
        .map((s) => `${s.nftChainId}/${s.collection}/${s.tokenId}`)
        .join(",")
    ],
    queryFn: ({ signal }) =>
      arenaRequest<Context>(
        `/tournaments/${tournament!.id}/context`,
        undefined,
        signal
      ),
    enabled: configured && !!tournament?.id,
    staleTime: 60000,
    refetchInterval: 15000
  });
  const session = useQuery({
    queryKey: ["arena-live", "session", address],
    queryFn: ({ signal }) =>
      arenaRequest<{ wallet: string; claimable: string }>(
        "/me",
        undefined,
        signal
      ),
    enabled: configured && !!address,
    retry: false,
    refetchInterval: 30000
  });
  const wallet = useArenaWallet(config.data, () =>
    queryClient.invalidateQueries({ queryKey: ["arena-live"] })
  );
  const inventory = useInfiniteQuery({
    queryKey: ["arena-inventory", address],
    queryFn: ({ pageParam, signal }) =>
      fetchOwnerTokens(address!, { limit: 24, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: configured && !!address && tournament?.phase === "open"
  });
  const ownedSeats =
    tournament?.seats.filter(
      (s) => s.player.toLowerCase() === address?.toLowerCase()
    ) ?? [];
  const error = config.error ?? detail.error ?? list.error;
  const claimable =
    session.data?.wallet.toLowerCase() === address?.toLowerCase()
      ? (session.data?.claimable ?? null)
      : null;
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-12 text-ink">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-grape">
            Yunipals Arena
          </p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl">
            Four fighters. One champion.
          </h1>
          <p className="mt-4 max-w-2xl text-muted">
            Study your opponents and island. Submit your own strategy. Watch two
            semifinals and a final decide the champion.
          </p>
        </div>
        <ConnectButton />
      </header>
      <section
        aria-label="Entry and payouts"
        className="my-8 grid grid-cols-2 gap-4 rounded-card bg-panel-base p-6 md:grid-cols-4"
      >
        {[
          ["Entry", "2 USDC"],
          ["Champion", "6 USDC"],
          ["Island owner", "0.40 USDC"],
          ["Operations", "1.60 USDC"]
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 text-xl font-bold">{value}</p>
          </div>
        ))}
      </section>
      {!configured && (
        <p role="status" className="rounded-card border border-line p-6">
          Mainnet tournaments are being prepared. Paid entry is not open yet.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-card border border-line p-5">
          {error.message}
        </p>
      )}
      {configured &&
        !error &&
        !tournament &&
        (list.isPending ? (
          <ArenaCardsLoading label="Loading tournaments" />
        ) : (
          <p role="status" className="rounded-card bg-lavender/20 p-6">
            The next lobby is being prepared.
          </p>
        ))}
      {wallet.error && (
        <p
          role="alert"
          className="my-4 break-words rounded-card border border-line p-5"
        >
          {wallet.error}
        </p>
      )}
      {wallet.busy && (
        <div className="my-4">
          <ArenaLoading label={`${wallet.busy}…`} />
        </div>
      )}
      {wallet.operation ? (
        <ArenaTransactionFeedback
          operation={wallet.operation}
          busy={!!wallet.busy}
          onCheck={() => void wallet.checkStatus()}
        />
      ) : null}
      {address && configured && (
        <section className="my-6 flex flex-wrap items-center gap-4">
          <button
            className={action}
            disabled={!!wallet.busy}
            onClick={() => void wallet.signIn()}
          >
            Sign in to Arena
          </button>
          {session.isPending ? (
            <ArenaLoading label="Loading available USDC…" />
          ) : claimable === null ? (
            <span className="text-sm text-muted">
              Sign in to view your available USDC.
            </span>
          ) : (
            <span>Claimable: {formatUnits(BigInt(claimable), 6)} USDC</span>
          )}
          <button
            className={action}
            disabled={
              !!wallet.busy ||
              wallet.pendingTransaction ||
              claimable === null ||
              claimable === "0"
            }
            onClick={() => void wallet.claim()}
          >
            Claim USDC
          </button>
        </section>
      )}
      {tournament && (
        <>
          <section className="my-8">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">
                  Tournament #{tournament.id}
                </h2>
                <p className="mt-1 text-muted">{phases[tournament.phase]}</p>
              </div>
              <p className="text-sm text-muted">
                {tournament.deadline === 0
                  ? "7-day joining window starts with the first entry"
                  : ["open", "strategies", "resolving"].includes(
                        tournament.phase
                      )
                    ? `Deadline: ${new Date(tournament.deadline * 1000).toLocaleString()}`
                    : "Completed"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[0, 1, 2, 3].map((seat) => (
                <FighterSeat
                  key={seat}
                  number={seat}
                  seat={tournament.seats[seat]}
                  fighter={context.data?.roster?.[seat]}
                  strategyStatus={
                    ((tournament.automaticStrategyMask ?? 0) & (1 << seat)) !==
                    0
                      ? "Automatic attack assigned"
                      : tournament.submittedSeats.includes(seat)
                        ? "Strategy locked"
                        : tournament.phase === "open"
                          ? "Waiting for the roster and island"
                          : "Waiting for strategy"
                  }
                />
              ))}
            </div>
          </section>
          <section className="my-8 rounded-card border border-line p-6">
            <h2 className="text-2xl font-bold">Your arena</h2>
            {context.isPending ? (
              <div
                className="mt-5 grid gap-6 md:grid-cols-2"
                role="status"
                aria-label="Loading arena details"
                aria-busy="true"
              >
                <div
                  className="aspect-square rounded-card bg-line/60 motion-safe:animate-pulse"
                  aria-hidden="true"
                />
                <ArenaLoading label="Loading your arena…" />
              </div>
            ) : context.isError ? (
              <p role="alert" className="mt-4 text-muted">
                Arena details could not be loaded.{" "}
                <button
                  className="font-semibold underline"
                  onClick={() => void context.refetch()}
                >
                  Try again
                </button>
              </p>
            ) : context.data?.island ? (
              <div className="mt-5 grid gap-6 md:grid-cols-2">
                <img
                  className="w-full rounded-card"
                  src={context.data.island.image}
                  alt={context.data.island.name}
                />
                <div>
                  <h3 className="text-xl font-bold">
                    {context.data.island.name}
                  </h3>
                  <dl className="mt-4 grid grid-cols-2 gap-4">
                    {Object.entries(context.data.island.traits).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt className="text-sm text-muted">
                            {key
                              .replace(/([A-Z])/g, " $1")
                              .replace(/^./, (letter) => letter.toUpperCase())}
                          </dt>
                          <dd className="font-semibold">{value}</dd>
                        </div>
                      )
                    )}
                  </dl>
                  <details className="mt-5">
                    <summary className="cursor-pointer font-semibold">
                      Combat terrain and resident details
                    </summary>
                    <p className="mt-3 text-sm text-muted">
                      {String(context.data.island.profile.geometry ?? "")}
                    </p>
                    <p className="mt-3 text-sm text-muted">
                      {String(context.data.rules.combat.terrainPolicy ?? "")}
                    </p>
                  </details>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-muted">
                {tournament.requestId
                  ? "The island draw is awaiting confirmation."
                  : "The first entry requests the island draw. Each Genesis island has three tickets; each Personal island has one."}
              </p>
            )}
          </section>
          {tournament.phase === "open" && address && (
            <section className="my-8">
              <h2 className="text-2xl font-bold">Choose your fighter</h2>
              <p className="my-3 text-muted">
                Your NFT stays in your wallet. Each different NFT can occupy one
                active seat.
              </p>
              {inventory.isPending && (
                <ArenaCardsLoading label="Loading your Yunipals…" />
              )}
              {inventory.error && <p role="alert">{inventory.error.message}</p>}
              {inventory.isSuccess &&
              !inventory.hasNextPage &&
              inventory.data.pages
                .flatMap((p) => p.items)
                .filter((n) => !n.burned).length === 0 ? (
                <p role="status" className="my-5 text-muted">
                  No available Yunipals were found in this wallet.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {inventory.data?.pages
                  .flatMap((p) => p.items)
                  .filter((nft) => !nft.burned)
                  .map((nft) => (
                    <article
                      key={`${nft.chainId}/${nft.tokenId}`}
                      className="rounded-card border border-line p-4"
                    >
                      {nft.image && (
                        <img
                          className="aspect-square w-full rounded-card object-cover"
                          src={nft.image}
                          alt={nft.name ?? `Yunipal #${nft.tokenId}`}
                          loading="lazy"
                        />
                      )}
                      <h3 className="my-3 font-bold">
                        {nft.name ?? `Yunipal #${nft.tokenId}`}
                      </h3>
                      <button
                        className={cn(action, "w-full px-3 text-sm")}
                        disabled={
                          !!wallet.busy ||
                          wallet.pendingTransaction ||
                          !config.data?.entriesEnabled ||
                          tournament.seats.length >= 4 ||
                          tournament.seats.some(
                            (s) =>
                              s.nftChainId === nft.chainId &&
                              s.tokenId === nft.tokenId
                          )
                        }
                        onClick={() =>
                          void wallet.join(
                            tournament.id,
                            nft,
                            tournament.incarnation
                          )
                        }
                      >
                        Enter · 2 USDC
                      </button>
                    </article>
                  ))}
              </div>
              {inventory.hasNextPage && (
                <button
                  className={cn(action, "mt-4")}
                  disabled={inventory.isFetchingNextPage}
                  onClick={() => void inventory.fetchNextPage()}
                >
                  {inventory.isFetchingNextPage ? (
                    <ArenaLoading label="Loading more Yunipals…" />
                  ) : (
                    "Load more Yunipals"
                  )}
                </button>
              )}
            </section>
          )}
          {tournament.phase === "strategies" && (
            <section className="my-8 space-y-5">
              <h2 className="text-2xl font-bold">Plan your battle</h2>
              <p className="text-muted">
                You have 24 hours after the roster and island are ready. Each
                strategy locks when submitted; all four are revealed together.
                Missing the deadline assigns an automatic attack and keeps your
                entry in the pool. The server operator can read private
                strategies.
              </p>
              {context.data?.tiePriority?.length === 4 && (
                <details className="rounded-card border border-line p-4 text-sm">
                  <summary className="cursor-pointer font-semibold">
                    Rules and exact-tie priority
                  </summary>
                  <p className="mt-3 text-muted">
                    Higher remaining health wins at the time limit. Only an
                    exact health tie or double knockout uses this public order:
                  </p>
                  <ol className="mt-2 list-inside list-decimal">
                    {context.data.tiePriority.map((fighterId) => (
                      <li key={fighterId}>
                        {context.data?.roster.find((f) => f?.id === fighterId)
                          ?.name ?? fighterId}
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 text-muted">
                    Describe any attack, defense or conditional plan. The
                    referee applies the same damage, energy and timing limits to
                    everyone. Cosmetic rarity does not increase damage.
                  </p>
                </details>
              )}
              {!context.data?.ready && (
                <p role="status" className="text-muted">
                  The arena and fighter references must finish loading before
                  you can submit.
                </p>
              )}
              {ownedSeats.map((seat) => (
                <StrategyEditor
                  key={`${address}/${tournament.id}/${seat.seat}`}
                  tournament={tournament}
                  seat={seat}
                  busy={!!wallet.busy || !context.data?.ready}
                  submit={wallet.submit}
                />
              ))}
            </section>
          )}
          {tournament.winners && (
            <section className="my-8 rounded-card bg-lavender/20 p-6">
              <h2 className="text-2xl font-bold">The result is confirmed</h2>
              <p className="my-3 text-muted">
                Results are public onchain. Reveal the result here whenever
                you’re ready.
              </p>
              <button
                className={action}
                onClick={() =>
                  setRevealedId(showResults ? null : tournament.id)
                }
              >
                {showResults ? "Hide result" : "Show result"}
              </button>
              {showResults && (
                <p className="mt-5 text-xl font-bold">
                  Champion: Yunipal #
                  {tournament.seats[tournament.winners[2]]?.tokenId}
                </p>
              )}
            </section>
          )}
          {tournament.phase === "settled" && (
            <ArenaFilm
              key={`${tournament.id}/${tournament.incarnation ?? "legacy"}`}
              id={tournament.id}
              incarnation={tournament.incarnation}
              showResults={showResults}
              fighters={context.data?.roster ?? []}
            />
          )}
          {tournament.strategies && (
            <details className="my-6 rounded-card border border-line p-6">
              <summary className="cursor-pointer font-bold">
                Revealed strategies
              </summary>
              {tournament.strategies.map((s) => (
                <div key={s.seat} className="mt-5">
                  <h3 className="font-semibold">Fighter {s.seat + 1}</h3>
                  <p className="mt-2 whitespace-pre-wrap break-words text-muted">
                    {s.text}
                  </p>
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {list.data && list.data.items.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-2xl font-bold">Recent tournaments</h2>
          <div className="flex flex-wrap gap-3">
            {list.data.items.map((t) => (
              <Link
                key={t.id}
                className="rounded-full border border-line px-5 py-3 font-semibold hover:bg-lavender/20"
                to={`/arena/${t.id}`}
              >
                #{t.id} · {phases[t.phase]}
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
