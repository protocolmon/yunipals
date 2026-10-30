import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { formatUnits, formatEther, type Address } from "viem";
import { LoaderCircle } from "lucide-react";
import { useAccount, usePublicClient } from "wagmi";
import { readArenaJoinPayment } from "@/lib/arenaPayment";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import { arenaMode } from "@protopals/yunipals-market-core/arenaProtocol";
import type {
  AnimeKnownKit,
  AnimeBackground,
  AnimeLoadout
} from "@protopals/yunipals-market-core/anime";
import type {
  ArenaPublicTournament,
  ArenaSeat
} from "@protopals/yunipals-market-core/arena";
import { Select, SelectItem } from "@/components/ui/select";
import type {
  ArenaHistoryPage,
  ArenaWalletSummary
} from "@protopals/yunipals-market-core/arenaViews";
import { fetchArenaTournament, type ArenaConfig } from "@/lib/arenaLive";
import { cn } from "@/lib/utils";
import { arenaFighterKey } from "@/lib/arenaTransactions";
import {
  readArenaStrategy,
  saveArenaStrategy,
  clearArenaStrategy,
  type ArenaStrategyReceipt
} from "@/lib/arenaStrategies";
import { fetchOwnerTokens, type IndexedChain } from "@/lib/yunipalsIndexer";
import { collectorClient, defaultCollectorFilters } from "@/lib/collector";
import { ArenaFilm } from "./ArenaFilm";
import { ArenaJoinBanner } from "./ArenaJoinBanner";
import {
  ArenaCardsLoading,
  ArenaLoading,
  ArenaTransactionFeedback
} from "./ArenaFeedback";
import { useArenaWallet, type ArenaApprovalEntries } from "./useArenaWallet";
import { useArenaClock } from "./useArenaClock";
import { ArenaNavigation } from "./ArenaNavigation";
import { ArenaDeadline, ArenaEvidence } from "./ArenaEvidence";
import { ArenaTournamentCard } from "./ArenaHistory";

const action =
  "rounded-full bg-ink px-6 py-3 font-semibold text-white transition hover:bg-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-40";
const entryButtonLabels: Record<string, string> = {
  "Switch to Base…": "Switch…",
  "Checking fighter…": "Checking…",
  "Checking artwork…": "Checking…",
  "Approve in wallet…": "Approve…",
  "Confirm in wallet…": "Confirm…",
  "Confirming approval…": "Confirming…",
  "Confirming entry…": "Confirming…",
  "Updating approval…": "Updating…",
  "Updating entry…": "Updating…",
  "Transaction pending…": "Pending…"
};
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
    animeBackground?: AnimeBackground;
  } | null;
  roster: Array<{
    id: string;
    name: string;
    image: string;
    identity: string;
    locomotion: "ground" | "flight";
    animeKits?: AnimeKnownKit[];
    animeDefaultLoadout?: AnimeLoadout;
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

export function StrategyEditor({
  tournament,
  seat,
  fighter,
  busy,
  progress,
  submissionError,
  contract,
  submit,
  readReceipt
}: {
  tournament: ArenaPublicTournament;
  seat: ArenaSeat;
  fighter?: Context["roster"][number];
  busy: boolean;
  progress?: string | null;
  submissionError?: string | null;
  contract: Address | undefined;
  submit: (
    id: string,
    seat: number,
    text: string,
    loadout?: AnimeLoadout
  ) => Promise<void>;
  readReceipt: (
    id: string,
    seat: number
  ) => Promise<ArenaStrategyReceipt | undefined>;
}) {
  const [text, setText] = useState(() =>
    contract
      ? readArenaStrategy(contract, seat.player, tournament.id, seat.seat).text
      : ""
  );
  const [draftError, setDraftError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ArenaStrategyReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const saved = contract
    ? readArenaStrategy(contract, seat.player, tournament.id, seat.seat)
    : null;
  const [chosen, setChosen] = useState<string[] | undefined>(
    () => saved?.signed?.loadout ?? saved?.loadout
  );
  const loadout = chosen ?? fighter?.animeDefaultLoadout;
  const locked = tournament.submittedSeats.includes(seat.seat);
  const now = useArenaClock(tournament.serverTime);
  const closed = now >= tournament.deadline;
  useEffect(() => {
    if ((locked || closed) && contract)
      clearArenaStrategy(contract, seat.player, tournament.id, seat.seat);
  }, [locked, closed, contract, seat.player, seat.seat, tournament.id]);
  return (
    <section
      className={cn(
        "rounded-card border border-line p-5",
        progress && "border-grape bg-lavender/10"
      )}
      aria-busy={Boolean(progress) || receiptLoading}
      data-arena-strategy-seat={seat.seat}
    >
      <div className="mb-4 flex items-center gap-4">
        {fighter?.image ? (
          <Link
            to={`/collection/${chains[seat.nftChainId]}/${seat.tokenId}`}
            aria-label={`View ${fighter.name}`}
            className="shrink-0 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
          >
            <img
              src={fighter.image}
              alt={fighter.name}
              loading="lazy"
              className="h-24 w-24 rounded-2xl border border-line object-cover sm:h-28 sm:w-28"
            />
          </Link>
        ) : (
          <div
            aria-hidden="true"
            className="h-24 w-24 shrink-0 animate-pulse rounded-2xl bg-lavender/30 sm:h-28 sm:w-28"
          />
        )}
        <div className="min-w-0">
          <h3 className="break-words font-bold">
            Your strategy · {fighter?.name ?? `Yunipal #${seat.tokenId}`}
          </h3>
          <p className="mt-1 text-sm text-muted">
            Fighter {seat.seat + 1} · Semifinal {seat.seat < 2 ? "1" : "2"}
            {fighter
              ? ` · ${fighter.locomotion === "flight" ? "Flies" : "Ground movement"}`
              : " · Loading fighter…"}
          </p>
        </div>
      </div>
      {locked ? (
        <div>
          <p className="mt-3 text-muted">
            Locked. All four strategies will appear together after confirmation.
          </p>
          <button
            className="mt-3 inline-flex items-center gap-2 font-semibold underline"
            aria-busy={receiptLoading || Boolean(progress)}
            aria-label={
              progress ?? (receiptLoading ? "Loading your receipt…" : undefined)
            }
            disabled={receiptLoading || busy}
            onClick={() => {
              setReceiptLoading(true);
              setDraftError(null);
              void readReceipt(tournament.id, seat.seat)
                .then((value) => {
                  if (value) setReceipt(value);
                })
                .catch((error: unknown) =>
                  setDraftError(
                    error instanceof Error
                      ? error.message
                      : "Could not load your strategy receipt."
                  )
                )
                .finally(() => setReceiptLoading(false));
            }}
          >
            {receiptLoading || progress ? (
              <>
                <LoaderCircle
                  size={16}
                  aria-hidden="true"
                  className="motion-safe:animate-spin"
                />
                <span role="status" aria-live="polite">
                  {progress ?? "Loading your receipt…"}
                </span>
              </>
            ) : (
              "View your locked strategy"
            )}
          </button>
          {draftError ? (
            <p role="alert" className="mt-2 text-sm">
              {draftError}
            </p>
          ) : null}
          {receipt?.locked ? (
            <div className="mt-3 rounded-2xl bg-panel-base p-4">
              <p className="whitespace-pre-wrap break-words">{receipt.text}</p>
              <p className="mt-3 break-all font-mono text-xs text-muted">
                Commitment: {receipt.commitment}
              </p>
              {receipt.receivedAt ? (
                <p className="mt-2 text-xs text-muted">
                  Server receipt:{" "}
                  {new Date(receipt.receivedAt).toLocaleString()}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : closed ? (
        <p role="status" className="mt-3 text-muted">
          The strategy deadline has passed. An automatic legal attack will be
          assigned; your entry stays in the pool.
        </p>
      ) : (
        <>
          {fighter?.animeKits && (
            <fieldset className="my-4" disabled={busy || !!saved?.signed}>
              <legend className="font-semibold">Choose two techniques</legend>
              <p className="my-2 text-sm text-muted">
                These names and effects shape your film. They add no combat
                advantage. Your choices appear with the revealed strategies.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {fighter.animeKits.map((kit) => {
                  const selected = loadout?.includes(kit.id) ?? false;
                  return (
                    <button
                      key={kit.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={!selected && loadout?.length === 2}
                      className={cn(
                        "rounded-2xl border border-line p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape disabled:opacity-50",
                        selected && "border-grape bg-lavender/30"
                      )}
                      onClick={() => {
                        const next = selected
                          ? (loadout ?? []).filter((id) => id !== kit.id)
                          : [...(loadout ?? []), kit.id];
                        setChosen(next);
                        try {
                          if (contract)
                            saveArenaStrategy(
                              contract,
                              seat.player,
                              tournament.id,
                              seat.seat,
                              {
                                text,
                                ...(next.length === 2
                                  ? { loadout: next as AnimeLoadout }
                                  : {})
                              }
                            );
                          setDraftError(null);
                        } catch {
                          setDraftError(
                            "Your browser could not save these choices for refresh recovery."
                          );
                        }
                      }}
                    >
                      <span className="block font-semibold">
                        {selected ? "✓ " : ""}
                        {kit.name}
                      </span>
                      <span className="mt-1 block text-sm text-muted">
                        {kit.description}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-sm" role="status">
                {loadout?.length ?? 0} of 2 selected. Deselect a technique to
                choose another.
              </p>
            </fieldset>
          )}
          <label
            htmlFor={`strategy-${seat.seat}`}
            className="my-3 block text-sm text-muted"
          >
            Describe your attacks, defenses and conditional plan for the final.
          </label>
          <textarea
            id={`strategy-${seat.seat}`}
            value={text}
            onChange={(e) => {
              const value = e.target.value;
              setText(value);
              try {
                if (contract)
                  saveArenaStrategy(
                    contract,
                    seat.player,
                    tournament.id,
                    seat.seat,
                    {
                      text: value,
                      signed: saved?.signed,
                      ...(loadout?.length === 2
                        ? { loadout: loadout as AnimeLoadout }
                        : {})
                    }
                  );
                setDraftError(null);
              } catch {
                setDraftError(
                  "Your browser could not save this draft for refresh recovery."
                );
              }
            }}
            maxLength={2400}
            rows={6}
            disabled={busy || !!saved?.signed}
            className="w-full rounded-card border border-line p-4 focus-visible:outline-grape"
          />
          <p role="status" className="mt-2 text-sm text-muted">
            {draftError ??
              (saved?.signed
                ? "Signed strategy saved. Retry to check its receipt or send the same signed body."
                : "Draft saved in this browser tab until submission or sign-out.")}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted">
              {text.length}/2400 · Submission is final
            </span>
            <button
              className={cn(
                action,
                "inline-flex items-center justify-center gap-2",
                progress && "bg-grape disabled:opacity-100"
              )}
              aria-busy={Boolean(progress)}
              aria-label={progress ?? undefined}
              disabled={
                busy ||
                !text.trim() ||
                (!!fighter?.animeKits && loadout?.length !== 2)
              }
              onClick={() =>
                void submit(
                  tournament.id,
                  seat.seat,
                  text,
                  loadout as AnimeLoadout | undefined
                )
              }
            >
              {progress ? (
                <>
                  <LoaderCircle
                    size={18}
                    aria-hidden="true"
                    className="shrink-0 motion-safe:animate-spin"
                  />
                  <span role="status" aria-live="polite">
                    {progress}
                  </span>
                </>
              ) : saved?.signed ? (
                "Check & retry saved strategy"
              ) : (
                "Sign & lock strategy"
              )}
            </button>
          </div>
        </>
      )}
      {submissionError ? (
        <p role="alert" className="mt-3 break-words text-sm text-ink">
          {submissionError}
        </p>
      ) : null}
    </section>
  );
}

export function LiveArenaPage() {
  const deployment = useArenaDeployment();
  const arenaRequest = useArenaRequest();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: 8453 });
  const [refundRecipient, setRefundRecipient] = useState("");
  const [approvalEntries, setApprovalEntries] =
    useState<ArenaApprovalEntries>(1);
  useEffect(() => setApprovalEntries(1), [address]);
  const queryClient = useQueryClient();
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const configured = !!deployment.apiUrl;
  const config = useQuery({
    queryKey: ["arena-live", deployment.scope, "config"],
    queryFn: ({ signal }) =>
      arenaRequest<ArenaConfig>("/config", undefined, signal),
    enabled: configured,
    staleTime: 60_000
  });
  const list = useInfiniteQuery({
    queryKey: ["arena-live", deployment.scope, "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      arenaRequest<ArenaHistoryPage>(
        `/tournaments${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        undefined,
        signal
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: configured,
    refetchInterval: 15000
  });
  const tournaments = list.data?.pages.flatMap((p) => p.items) ?? [];
  const selectedId = id;
  const detail = useQuery({
    queryKey: ["arena-live", deployment.scope, "tournament", selectedId],
    queryFn: ({ signal }) =>
      arenaRequest<ArenaPublicTournament>(
        `/tournaments/${selectedId!}`,
        undefined,
        signal
      ),
    enabled: configured && !!selectedId,
    refetchInterval: 10000
  });
  const tournament = detail.data;
  const drawQuote = useQuery({
    queryKey: [
      "arena-live",
      deployment.scope,
      "draw-quote",
      config.data?.contract,
      tournament?.id,
      tournament?.seats.length
    ],
    queryFn: () =>
      readArenaJoinPayment(publicClient!, config.data!, tournament!.id),
    enabled:
      !!publicClient &&
      config.data?.contractVersion === 2 &&
      tournament?.phase === "open",
    refetchInterval: 15000,
    retry: false
  });
  const refund = useQuery({
    queryKey: [
      "arena-live",
      deployment.scope,
      "eth-refund",
      config.data?.contract,
      address
    ],
    queryFn: () =>
      publicClient!.readContract({
        address: config.data!.contract,
        abi: arenaV2Abi,
        functionName: "randomnessRefund",
        args: [arenaMode(deployment.kind), address!]
      }),
    enabled: !!publicClient && !!address && config.data?.contractVersion === 2,
    refetchInterval: 15000
  });
  const showResults = revealedId === tournament?.id;
  const context = useQuery({
    queryKey: [
      "arena-live",
      deployment.scope,
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
  const summary = useQuery({
    queryKey: ["arena-live", deployment.scope, "summary", address],
    queryFn: ({ signal }) =>
      arenaRequest<ArenaWalletSummary>(
        `/wallets/${address}/summary`,
        undefined,
        signal
      ),
    enabled: configured && !!address,
    refetchInterval: 30000
  });
  const wallet = useArenaWallet(config.data, () =>
    queryClient.invalidateQueries({
      queryKey: ["arena-live", deployment.scope]
    })
  );
  const inventory = useInfiniteQuery({
    queryKey: ["arena-inventory", deployment.scope, address],
    queryFn: async ({ pageParam, signal }) => {
      const page =
        deployment.kind === "anime"
          ? await collectorClient.page(
              address!,
              { ...defaultCollectorFilters, chains: ["base"] },
              "visible",
              pageParam,
              signal
            )
          : await fetchOwnerTokens(
              address!,
              { limit: 24, cursor: pageParam },
              signal
            );
      if (deployment.kind !== "anime") return page;
      const base = page.items.filter((t) => t.chainId === 8453);
      const eligible = await Promise.all(
        base.map(async (t) => ({
          token: t,
          approved:
            (
              await arenaRequest<{ fighter: { status: string } }>(
                `/fighters/${t.tokenId}`,
                undefined,
                signal
              )
            ).fighter.status === "Approved"
        }))
      );
      return {
        ...page,
        items: eligible.filter((t) => t.approved).map((t) => t.token)
      };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: configured && !!address && tournament?.phase === "open"
  });
  const ownedSeats =
    tournament?.seats.filter(
      (s) => s.player.toLowerCase() === address?.toLowerCase()
    ) ?? [];
  useEffect(() => {
    if (
      location.hash !== "#join" ||
      tournament?.phase !== "open" ||
      context.isPending
    )
      return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("join")?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    location.hash,
    location.key,
    tournament?.id,
    tournament?.phase,
    context.isPending
  ]);
  const error = config.error ?? detail.error ?? list.error;
  const claimable =
    summary.data?.wallet.toLowerCase() === address?.toLowerCase()
      ? (summary.data?.available ?? null)
      : null;
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-12 text-ink">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-grape">
            {deployment.label}
          </p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl">
            Four fighters. One champion.
          </h1>
          <p className="mt-4 max-w-2xl text-muted">
            Study your opponents and island. Submit your own strategy. Watch two
            semifinals and a final decide the champion.
          </p>
        </div>
      </header>
      <ArenaNavigation />
      <ArenaJoinBanner tournaments={tournaments} />
      <section
        aria-label="Entry and payouts"
        className="my-8 grid grid-cols-2 gap-4 rounded-card bg-panel-base p-6 md:grid-cols-4"
      >
        {[
          ["Entry", `${deployment.entry} USDC`],
          ["Champion", `${deployment.champion} USDC`],
          [
            "Island owner",
            deployment.kind === "anime" ? "0.20 USDC" : "0.40 USDC"
          ],
          [
            "Operations",
            deployment.kind === "anime" ? "0.60 USDC" : "1.60 USDC"
          ]
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
      {config.data?.entryMode === "pilot" ? (
        <p role="status" className="my-5 rounded-card bg-lavender/20 p-5">
          Controlled launch pilot · only the selected test wallets can enter
          while the full mainnet flow is verified.
        </p>
      ) : config.data && !config.data.entriesEnabled ? (
        <p role="status" className="my-5 rounded-card bg-lavender/20 p-5">
          Paid entry is currently closed. Existing tournaments, videos and
          claims remain available.
        </p>
      ) : null}
      {error && (
        <p role="alert" className="rounded-card border border-line p-5">
          {error.message}
        </p>
      )}
      {configured &&
      !error &&
      (list.isPending || (!!selectedId && detail.isPending)) ? (
        <ArenaCardsLoading
          label={selectedId ? "Loading tournament" : "Loading tournaments"}
        />
      ) : null}
      {configured &&
      !error &&
      !id &&
      list.isSuccess &&
      tournaments.length === 0 ? (
        <p role="status" className="rounded-card bg-lavender/20 p-6">
          The next lobby is being prepared.
        </p>
      ) : null}
      {!id ? (
        <section
          className="my-8 grid gap-4 sm:grid-cols-3"
          aria-label="How Arena works"
        >
          {[
            [
              "01",
              "Bring your Yunipal",
              `Pick ${deployment.kind === "anime" ? "an approved Base OG fighter" : "one of your NFTs"} and enter for ${deployment.entry} USDC. Your NFT stays yours.`
            ],
            [
              "02",
              "Outsmart your opponents",
              "Once four fighters join, study the drawn island and submit your own private strategy."
            ],
            [
              "03",
              "Watch. Win. Claim.",
              `Two semifinals and a final decide one champion. Watch the battles and claim the ${deployment.champion} USDC prize.`
            ]
          ].map(([step, title, description]) => (
            <article key={step} className="rounded-card border border-line p-5">
              <span className="text-xs font-bold text-grape">{step}</span>
              <h2 className="mt-2 text-lg font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {description}
              </p>
            </article>
          ))}
        </section>
      ) : null}
      {wallet.error &&
        !(
          tournament?.phase === "strategies" &&
          wallet.strategyFeedback?.tournamentId === tournament.id
        ) && (
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
      {wallet.batchPending ? (
        <div className="my-4 rounded-card border border-line p-5" role="status">
          <p>Your wallet is handling this combined approval and entry.</p>
          <button
            className={cn(action, "mt-3")}
            disabled={!!wallet.busy}
            onClick={() => void wallet.checkStatus()}
          >
            Check entry status
          </button>
        </div>
      ) : wallet.operation ? (
        <ArenaTransactionFeedback
          operation={wallet.operation}
          busy={!!wallet.busy}
          onCheck={() => void wallet.checkStatus()}
        />
      ) : null}
      {address && refund.data !== undefined && refund.data > 0n && (
        <section
          className="my-6 space-y-3 rounded-card border border-line p-5"
          aria-label="Unused draw fee refund"
        >
          <p>Unused draw-fee refund: {formatEther(refund.data)} ETH.</p>
          <p className="text-sm text-muted">
            Your wallet did not accept the automatic return. You can send the
            unused ETH to this wallet or another address you control.
          </p>
          <label
            htmlFor="arena-refund-recipient"
            className="block text-sm font-semibold"
          >
            ETH recipient
          </label>
          <input
            id="arena-refund-recipient"
            className="w-full rounded-full border border-line px-4 py-2"
            value={refundRecipient}
            placeholder={address}
            onChange={(event) => setRefundRecipient(event.target.value)}
          />
          <button
            className={action}
            disabled={!!wallet.busy || wallet.pendingTransaction}
            onClick={() =>
              void wallet.claim(
                true,
                (refundRecipient.trim() || address) as Address
              )
            }
          >
            Claim unused ETH
          </button>
        </section>
      )}
      {address &&
        configured &&
        (claimable !== "0" || wallet.operation?.action.kind === "claim") && (
          <section className="my-6 flex flex-wrap items-center gap-4">
            {summary.isPending ? (
              <ArenaLoading label="Loading available USDC…" />
            ) : claimable === null ? (
              <span role="alert" className="text-sm text-muted">
                Your reward balance could not be loaded.{" "}
                <button
                  className="font-semibold underline"
                  onClick={() => void summary.refetch()}
                >
                  Try again
                </button>
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
      {id && tournament && (
        <>
          {tournament.projection?.ready === false ? (
            <p
              role="status"
              className="my-5 rounded-card border border-line p-5"
            >
              Tournament synchronization is catching up. The last indexed state
              is shown; entry and strategy submission will resume when it is
              current.
            </p>
          ) : null}
          <section className="my-8">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">
                  Tournament #{tournament.id}
                </h2>
                <p className="mt-1 text-muted">{phases[tournament.phase]}</p>
              </div>
              <ArenaDeadline tournament={tournament} />
            </div>
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
                key={`film/${tournament.id}`}
                id={tournament.id}
                showResults={showResults}
                fighters={context.data?.roster ?? []}
              />
            )}

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
                  {context.data.island.animeBackground?.mode ===
                    "shared-preview" && (
                    <p className="mt-3 text-sm text-muted">
                      The film uses shared arena artwork while island-specific
                      scenes are prepared. Your selected island’s terrain rules
                      and hosting rewards still apply.
                    </p>
                  )}
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
          {tournament.phase === "open" && !address ? (
            <section
              id="join"
              className="my-8 scroll-mt-28 rounded-card border border-lavender bg-lavender/10 p-6"
            >
              <h2 className="text-2xl font-bold">Choose your fighter</h2>
              <p className="mt-3 text-muted">
                Connect your wallet using the button in the header to see your
                Yunipals. Pick a fighter and enter for {deployment.entry} USDC;
                your NFT stays in your wallet.
              </p>
            </section>
          ) : null}
          {tournament.phase === "open" && address && (
            <section id="join" className="my-8 scroll-mt-28">
              <h2 className="text-2xl font-bold">Choose your fighter</h2>
              <p className="my-3 text-muted">
                Your NFT stays in your wallet. Each different NFT can occupy one
                active seat.
              </p>
              {config.data?.contractVersion === 2 && (
                <div
                  className="my-4 rounded-card border border-line bg-lavender/10 p-4"
                  role="status"
                >
                  {drawQuote.isPending
                    ? "Checking the island draw fee…"
                    : drawQuote.error
                      ? "The draw fee could not be checked yet. It will be checked again before your wallet confirms payment."
                      : drawQuote.data?.firstEntry
                        ? `The first entry also pays up to ${formatEther(drawQuote.data.value)} ETH for the island draw, plus network gas. Unused ETH is returned automatically. The used draw fee is not refundable if the battle later expires.`
                        : "The island draw is already paid. This entry pays USDC and network gas only."}
                </div>
              )}
              <div className="my-5 rounded-card border border-line bg-panel-base p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="arena-approval-limit"
                    className="font-semibold"
                  >
                    USDC approval limit
                  </label>
                  <Select
                    id="arena-approval-limit"
                    aria-describedby="arena-approval-help"
                    value={String(approvalEntries)}
                    disabled={!!wallet.busy || wallet.pendingTransaction}
                    onValueChange={(value) =>
                      setApprovalEntries(
                        value === "10" ? 10 : value === "4" ? 4 : 1
                      )
                    }
                  >
                    <SelectItem value="1">
                      {deployment.entry} USDC · 1 entry
                    </SelectItem>
                    <SelectItem value="4">
                      {Number(deployment.entry) * 4} USDC · 4 entries
                    </SelectItem>
                    <SelectItem value="10">
                      {Number(deployment.entry) * 10} USDC · 10 entries
                    </SelectItem>
                  </Select>
                </div>
                <p id="arena-approval-help" className="mt-3 text-sm text-muted">
                  A higher limit saves repeat approvals. Each entry still
                  charges only {deployment.entry} USDC. This limit applies when
                  a new approval is needed; an existing allowance is reused.{" "}
                  Compatible wallets approve and enter together. Other wallets
                  ask for approval, then immediately ask you to confirm entry.
                </p>
              </div>
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
                  .map((nft) => {
                    const key = arenaFighterKey({
                      tournamentId: tournament.id,
                      nftChainId: nft.chainId,
                      collection: nft.contractAddress,
                      tokenId: nft.tokenId
                    });
                    const progress =
                      wallet.entryProgress?.key === key
                        ? wallet.entryProgress
                        : null;
                    const entered = tournament.seats.some(
                      (s) =>
                        s.nftChainId === nft.chainId &&
                        s.collection.toLowerCase() ===
                          nft.contractAddress.toLowerCase() &&
                        s.tokenId === nft.tokenId
                    );
                    return (
                      <article
                        key={`${nft.chainId}/${nft.contractAddress}/${nft.tokenId}`}
                        data-arena-fighter={key}
                        aria-busy={!!progress}
                        className={cn(
                          "rounded-card border p-4",
                          progress ? "border-grape bg-grape/5" : "border-line"
                        )}
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
                          className={cn(
                            action,
                            "inline-flex h-12 w-full items-center justify-center gap-2 px-3 text-sm",
                            progress && "bg-grape disabled:opacity-100"
                          )}
                          aria-busy={!!progress}
                          aria-label={progress?.label}
                          disabled={
                            !!wallet.busy ||
                            wallet.pendingTransaction ||
                            !config.data?.entriesEnabled ||
                            tournament.seats.length >= 4 ||
                            tournament.projection?.ready === false ||
                            entered
                          }
                          onClick={() =>
                            void wallet.join(
                              tournament.id,
                              nft,
                              approvalEntries
                            )
                          }
                        >
                          {progress ? (
                            <>
                              <LoaderCircle
                                size={16}
                                aria-hidden="true"
                                className="shrink-0 motion-safe:animate-spin"
                              />
                              <span
                                className="truncate"
                                role="status"
                                aria-live="polite"
                              >
                                {entryButtonLabels[progress.label] ??
                                  progress.label}
                              </span>
                            </>
                          ) : entered ? (
                            "Entered"
                          ) : (
                            `Enter · ${deployment.entry} USDC`
                          )}
                        </button>
                      </article>
                    );
                  })}
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
                  contract={config.data?.contract}
                  seat={seat}
                  fighter={context.data?.roster[seat.seat]}
                  progress={
                    wallet.strategyFeedback?.tournamentId === tournament.id &&
                    wallet.strategyFeedback.seat === seat.seat
                      ? wallet.strategyFeedback.progress
                      : null
                  }
                  submissionError={
                    wallet.strategyFeedback?.tournamentId === tournament.id &&
                    wallet.strategyFeedback.seat === seat.seat
                      ? wallet.strategyFeedback.error
                      : null
                  }
                  busy={
                    !!wallet.busy ||
                    !context.data?.ready ||
                    tournament.projection?.ready === false
                  }
                  submit={wallet.submit}
                  readReceipt={wallet.readStrategy}
                />
              ))}
            </section>
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
          <ArenaEvidence
            key={`evidence/${tournament.id}`}
            tournament={tournament}
          />
        </>
      )}
      {list.data &&
        (tournaments.some((t) => (id ? t.id !== id : t.phase !== "open")) ||
          list.hasNextPage) && (
          <section className="mt-12">
            <h2 className="mb-4 text-2xl font-bold">
              {id ? "More battles" : "Latest battles"}
            </h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {tournaments
                .filter((t) => (id ? t.id !== id : t.phase !== "open"))
                .map((t) => (
                  <ArenaTournamentCard
                    key={t.id}
                    tournament={t}
                    wallet={address}
                  />
                ))}
            </div>
            {list.hasNextPage ? (
              <button
                className={cn(action, "mt-5")}
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? (
                  <ArenaLoading label="Loading more tournaments…" />
                ) : (
                  "Load more tournaments"
                )}
              </button>
            ) : null}
          </section>
        )}
    </main>
  );
}
