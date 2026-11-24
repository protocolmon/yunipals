import { BoosterArtwork } from "@/pages/boosters/BoosterCollection";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { formatEther, isAddress } from "viem";
import {
  adventureAbi,
  evolutionAbi
} from "@protopals/yunipals-market-core/evolutionAbi";
import { z } from "zod";
import {
  adventureOdds,
  cardFinishes,
  finishOdds,
  serumRarities,
  serumPresences,
  serumDefinition,
  sponsoredSerumLimit,
  fusionPresenceOdds
} from "@protopals/yunipals-market-core/serums";
import { environment } from "@/environment";
import { useEvolutionActions } from "@/hooks/useEvolutionActions";
import {
  fetchAdventureCard,
  evolutionRequest,
  presencePreviews
} from "@/lib/evolution";
import { DialogSurface } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  AdventureWallet,
  AdventureCardTile,
  SerumHistory,
  adventureButton
} from "./AdventureCards";
import { SerumArtwork, SerumCatalogue } from "./SerumArtwork";

export function AdventurePage() {
  const { tokenId } = useParams();
  const account = useAccount();
  const connect = useConnectModal();
  const switcher = useSwitchChain();
  const navigate = useNavigate();
  const actions = useEvolutionActions();
  const adventurePause = useReadContract({
    address: isAddress(environment.adventuresAddress)
      ? environment.adventuresAddress
      : undefined,
    abi: adventureAbi,
    functionName: "randomnessPaused",
    chainId: environment.portalChainId,
    query: { enabled: environment.evolutionEnabled, refetchInterval: 10000 }
  });
  const evolutionPause = useReadContract({
    address: isAddress(environment.evolutionAddress)
      ? environment.evolutionAddress
      : undefined,
    abi: evolutionAbi,
    functionName: "requestsPaused",
    chainId: environment.portalChainId,
    query: { enabled: environment.evolutionEnabled, refetchInterval: 10000 }
  });
  const [choosing, setChoosing] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const dialog = useRef<HTMLDialogElement>(null);
  const validId = !!tokenId && /^[1-9][0-9]{0,77}$/.test(tokenId);
  const query = useQuery({
    queryKey: ["evolution", "card", tokenId],
    enabled: environment.evolutionEnabled && validId,
    queryFn: ({ signal }) => fetchAdventureCard(tokenId!, signal),
    refetchInterval: 5000,
    retry: 1
  });
  const card = query.data?.card;
  const sponsorship = useQuery({
    queryKey: ["evolution", "sponsorship"],
    enabled: environment.evolutionEnabled,
    queryFn: async ({ signal }) =>
      z
        .object({
          limit: z.literal(sponsoredSerumLimit),
          used: z.number().int().min(0).max(sponsoredSerumLimit),
          remaining: z.number().int().min(0).max(sponsoredSerumLimit)
        })
        .parse(await evolutionRequest("/sponsorship", signal)),
    refetchInterval: 10000,
    retry: 1
  });
  useEffect(() => {
    setChoosing(false);
  }, [tokenId, account.address]);
  useEffect(() => {
    if (!card || card.nextAdventureAt <= Date.now() / 1000) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [card?.nextAdventureAt]);
  useEffect(() => {
    if (!actions.review) {
      dialog.current?.close();
      return;
    }
    const trigger = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, [actions.review]);
  const requestId =
    actions.pending && actions.pending.tokenId === tokenId
      ? actions.pending.requestId
      : (card?.pendingEvolution ?? undefined);
  const isAdventure =
    actions.pending &&
    actions.pending.tokenId === tokenId &&
    actions.pending.kind === "adventure";
  const job = useQuery({
    queryKey: ["evolution", "progress", isAdventure, requestId],
    enabled: !!requestId,
    queryFn: async ({ signal }) =>
      z
        .object({ value: z.record(z.unknown()).nullable() })
        .parse(
          await evolutionRequest(
            `/${isAdventure ? "adventures" : "jobs"}/${requestId}`,
            signal
          )
        ),
    refetchInterval: 4000,
    retry: 1
  });
  useEffect(() => {
    const value = job.data?.value;
    if (
      value?.status === "completed" &&
      typeof value.resultTokenId === "string" &&
      value.resultTokenId !== tokenId
    ) {
      actions.clearPending();
      navigate(`/adventures/cards/${value.resultTokenId}`);
    }
  }, [job.data, tokenId, navigate, actions.clearPending]);
  const owned = card?.owner.toLowerCase() === account.address?.toLowerCase();
  const cooldown = card ? Math.max(0, card.nextAdventureAt - now) : 0;
  const unavailable =
    !owned ||
    card?.graded ||
    !!card?.reservedBy ||
    !!card?.pendingGrade ||
    !!actions.phase;
  const odds = card ? adventureOdds(card.effectiveSequence) : null;
  const serum = card?.unused ? serumDefinition(card.unused) : null;
  const progress = job.data?.value;
  const canWallet =
    account.address && account.chainId === environment.portalChainId;
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <Link to="/adventures" className="font-display text-xl font-bold">
          Adventures & alchemy
        </Link>
        <Link to="/collection?edition=tcg" className="text-sm underline">
          TCG collection
        </Link>
      </div>
      {!tokenId && (
        <>
          <section className="grid items-center gap-8 overflow-hidden rounded-3xl bg-lavender/20 p-6 md:grid-cols-2 md:p-10">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest">
                A new side of your Yunipal
              </p>
              <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">
                Small bottle.
                <br />
                Extraordinary change.
              </h1>
              <p className="mt-5 max-w-md leading-relaxed">
                Send your Yunipal exploring, discover a serum, or unite two
                companions. Every transformation leaves its mark.
              </p>
              <p className="mt-4 text-sm">
                121 serums · 11 Presences · 2 fusion levels
              </p>
              <p className="mt-3 text-sm font-semibold">
                We cover the AI fee for the first 1,000 serum applications.
                Network gas and any randomness fee still apply.
              </p>
              <a href="#your-cards" className={cn(adventureButton, "mt-6")}>
                Choose a companion
              </a>
            </div>
            <figure className="mx-auto max-w-xs rotate-3">
              <img
                src={presencePreviews[0]}
                width={640}
                height={960}
                alt="Approved concept: a black dragon in Holy Voidheart Avatar form"
                className="w-full rounded-3xl shadow-xl"
              />
              <figcaption className="mt-3 text-center text-xs">
                Concept preview · Holy Voidheart Avatar · not a live NFT
              </figcaption>
            </figure>
          </section>
          <SerumCatalogue />
          <section className="mt-12">
            <h2 className="font-display text-2xl font-bold">
              Three collectible finishes
            </h2>
            <p className="mt-2 max-w-2xl text-muted">
              Your first serum reveals a finish that stays through later serums
              and grading. Every new fusion rolls its own finish, independent of
              serum rarity and Presence.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-6">
              {finishOdds.map(({ finish, percent }) => (
                <figure key={finish}>
                  <img
                    src={`/images/evolution/finishes/${cardFinishes[finish].toLowerCase()}.webp`}
                    alt={`${cardFinishes[finish]} finish on a Holy dragon concept`}
                    width={600}
                    height={900}
                    loading="lazy"
                    className="w-full rounded-2xl"
                  />
                  <figcaption className="mt-2 text-center text-sm">
                    {cardFinishes[finish]} · {percent}%
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Approved finish concepts · not live NFTs. Golden uses the standard
              border width.
            </p>
          </section>
          <section className="mt-12">
            <h2 className="font-display text-2xl font-bold">
              A Presence of their own
            </h2>
            <p className="mt-2 max-w-2xl text-muted">
              Serums change the creature and its world. The latest dose sets its
              Presence; earlier physical effects stay. Holy appears in 1% of
              found serums.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {presencePreviews.map((src, i) => (
                <figure key={src}>
                  <img
                    src={src}
                    alt={`${serumPresences[i + 1]} dragon concept`}
                    width={640}
                    height={960}
                    loading="lazy"
                    className="rounded-2xl"
                  />
                  <figcaption className="mt-2 text-center text-sm">
                    {serumPresences[i + 1]}
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Approved style examples. Actual artwork combines your card and its
              history.
            </p>
          </section>
        </>
      )}
      {!environment.evolutionEnabled ? (
        <div className="mt-8 rounded-3xl border border-line p-6">
          <h2 className="font-display text-2xl font-bold">
            Preparing for the first adventure
          </h2>
          <p className="mt-2">
            Explore the approved styles above. Adventures, serums and fusion
            will open when the contracts and services are ready.
          </p>
        </div>
      ) : (
        <>
          {(adventurePause.data !== false || evolutionPause.data !== false) && (
            <p role="status" className="my-6 rounded-2xl bg-lavender/20 p-5">
              {adventurePause.data || evolutionPause.data
                ? "Adventures and alchemy are not fully open yet. You can explore the cards and serum styles while paused actions remain unavailable."
                : "Checking availability. Actions stay unavailable until the network confirms they are open."}
            </p>
          )}
          {validId && query.isPending && (
            <p role="status" className="py-12 animate-pulse">
              Finding your companion…
            </p>
          )}
          {query.isError && (
            <p role="alert" className="my-5 text-red-700">
              {query.error.message}{" "}
              <button
                className="underline"
                onClick={() => void query.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {card && (
            <section className="grid gap-8 md:grid-cols-2">
              <div>
                <BoosterArtwork
                  uri={card.metadataURI}
                  label={`Current artwork of Yunipal #${card.tokenId}`}
                  interactive
                />
                <Link
                  to={`/grading/cards/${card.tokenId}`}
                  className="mt-3 inline-block text-sm underline"
                >
                  Artwork and grading history
                </Link>
              </div>
              <div>
                <p className="text-sm text-muted">
                  {card.level
                    ? `Fusion level ${card.level} · ${card.sources.length} sources`
                    : "Yunipals TCG"}
                </p>
                <h1 className="mt-2 font-display text-4xl font-bold">
                  Yunipal #{card.tokenId}
                </h1>
                <p className="mt-3 text-lg">
                  {serumPresences[card.presence]} Presence · {card.localDoses}
                  /11 doses · {cardFinishes[card.finish]} finish
                </p>
                {card.graded && (
                  <p className="mt-5 rounded-2xl bg-lavender/20 p-4">
                    This card has been graded. Its artwork is complete:
                    adventures, serums and fusion are closed.
                  </p>
                )}
                {card.reservedBy && (
                  <p
                    role="status"
                    className="mt-5 rounded-2xl bg-lavender/20 p-4"
                  >
                    {card.pendingAdventure
                      ? "Exploring — the result arrives when randomness settles. Your card can still transfer."
                      : "Transformation in progress. Your current artwork stays visible while generation completes; this card is reserved."}
                  </p>
                )}
                <div className="mt-6 rounded-3xl border border-line p-5">
                  <h2 className="font-display text-xl font-bold">
                    Take an adventure
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    One trip every 24 hours. A new find replaces your unused
                    serum; finding nothing keeps it.
                  </p>
                  {cooldown > 0 && (
                    <p className="mt-2 text-sm">
                      Ready in {Math.floor(cooldown / 3600)}h{" "}
                      {Math.floor((cooldown % 3600) / 60)}m{" "}
                      {Math.floor(cooldown % 60)}s
                    </p>
                  )}
                  <button
                    className={cn(adventureButton, "mt-4")}
                    disabled={
                      unavailable ||
                      adventurePause.data !== false ||
                      cooldown > 0 ||
                      !canWallet
                    }
                    onClick={() =>
                      void actions.prepare("adventure", card.tokenId)
                    }
                  >
                    Review adventure
                  </button>
                  {card.localDoses === 11 && (
                    <p className="mt-2 text-sm">
                      All 11 local doses are used. You can still explore, but
                      cannot drink another serum on this card.
                    </p>
                  )}
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer font-semibold">
                      Tier {odds!.tier} · serum odds
                    </summary>
                    <p className="mt-2">
                      {card.level
                        ? "Average source sequence, rounded down"
                        : "Sequence"}
                      : {card.effectiveSequence}. Tier range: {odds!.min}–
                      {odds!.max}. Adventures do not raise your tier.
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-1">
                      {["Nothing found", ...serumRarities].map((label, i) => (
                        <div key={label} className="flex justify-between gap-3">
                          <dt>{label}</dt>
                          <dd>
                            {(odds!.weights[i] / 10000).toFixed(
                              i === 6 ? 3 : 2
                            )}
                            %
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </div>
                <div className="mt-4 rounded-3xl border border-line p-5">
                  <h2 className="font-display text-xl font-bold">
                    {serum?.name ?? "Your next discovery"}
                  </h2>
                  {serum ? (
                    <>
                      <div className="mt-3 flex items-center gap-4">
                        <SerumArtwork serumId={serum.id} />
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold">{serum.rarity}</p>
                          <p className="mt-1">{serum.presence} Presence</p>
                          <p className="mt-1 text-muted">
                            Found by this companion
                          </p>
                        </div>
                      </div>
                      <p className="mt-2 text-sm">
                        Presence: {serumPresences[card.presence]} →{" "}
                        {serum.presence}. Physical effects stack, including
                        repeat doses. The background transforms too.{" "}
                        {card.finish === 0
                          ? "Your first dose also rolls a finish; the ETH randomness cost is quoted before signing."
                          : `Your ${cardFinishes[card.finish]} finish stays.`}
                      </p>
                      <button
                        className={cn(adventureButton, "mt-4")}
                        disabled={
                          unavailable ||
                          evolutionPause.data !== false ||
                          card.localDoses >= 11 ||
                          !canWallet
                        }
                        onClick={() =>
                          void actions.prepare("serum", card.tokenId)
                        }
                      >
                        {sponsorship.data && !sponsorship.isError
                          ? sponsorship.data.remaining > 0
                            ? "Drink serum · AI sponsored"
                            : "Drink serum · 0.10 USDC"
                          : "Drink serum · review fee"}
                      </button>
                      {sponsorship.data && !sponsorship.isError && (
                        <p className="mt-2 text-sm text-muted">
                          {sponsorship.data.remaining > 0
                            ? `${sponsorship.data.remaining} of 1,000 sponsored uses remain at the latest confirmed update. Your slot is reserved when consumption is accepted onchain. Gas and any randomness fee still apply.`
                            : "All 1,000 sponsored uses have been claimed. The standard AI fee applies."}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-muted">
                      A serum found on your adventure will wait here.
                    </p>
                  )}
                </div>
                <div className="mt-4 rounded-3xl border border-line p-5">
                  <h2 className="font-display text-xl font-bold">
                    Fuse with a companion
                  </h2>
                  <p className="mt-2 text-sm">
                    {card.level === 2
                      ? "This card has reached the final fusion level."
                      : card.level === 1
                        ? "Choose a first fusion from a different original lineage."
                        : "Choose a neighbouring sequence from the same original lineage."}
                  </p>
                  <button
                    className={cn(adventureButton, "mt-4")}
                    disabled={
                      unavailable ||
                      evolutionPause.data !== false ||
                      card.level === 2 ||
                      !canWallet
                    }
                    onClick={() => setChoosing(!choosing)}
                  >
                    Choose fusion partner
                  </button>
                </div>
                {!card.graded && (
                  <p className="mt-5 text-sm">
                    <Link
                      to={`/grading?card=${card.tokenId}`}
                      className="underline"
                    >
                      Enter a grading portal
                    </Link>
                    . A completed grade permanently ends adventures, serum use
                    and fusion.
                  </p>
                )}
              </div>
            </section>
          )}
          {choosing && card && account.address && (
            <section className="mt-10">
              <h2 className="mb-4 font-display text-2xl font-bold">
                A compatible companion
              </h2>
              <AdventureWallet
                owner={account.address}
                compatibleWith={card.tokenId}
                onSelect={(p) => {
                  setChoosing(false);
                  void actions.prepare("fusion", card.tokenId, p.tokenId);
                }}
              />
            </section>
          )}
          {card && (
            <section className="mt-10 grid gap-6 md:grid-cols-2">
              <div>
                <h2 className="mb-4 font-display text-2xl font-bold">
                  The story so far
                </h2>
                <SerumHistory history={card.history} />
              </div>
              <div>
                <h2 className="mb-4 font-display text-2xl font-bold">
                  Original sources
                </h2>
                <ul className="space-y-3">
                  {card.sources.map((s) => (
                    <li
                      key={s.tokenId}
                      className="rounded-2xl border border-line p-4"
                    >
                      Card #{s.tokenId} · sequence {s.sequence}
                      <p className="mt-1 text-sm text-muted">
                        Original lineage #{s.originalTokenId}
                        {s.isOriginal ? " · original source" : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          {!tokenId && (
            <section id="your-cards" className="mt-12 scroll-mt-8">
              <h2 className="mb-4 font-display text-2xl font-bold">
                Your companions, together
              </h2>
              {account.address && <AdventureWallet owner={account.address} />}
            </section>
          )}
          {!account.address ? (
            <button
              className={cn(adventureButton, "mt-6")}
              onClick={() => connect.openConnectModal?.()}
            >
              Connect wallet
            </button>
          ) : account.chainId !== environment.portalChainId ? (
            <button
              className={cn(adventureButton, "mt-6")}
              onClick={() =>
                switcher.switchChain({ chainId: environment.portalChainId })
              }
            >
              Switch network
            </button>
          ) : null}
          {(actions.phase || actions.pending) && (
            <p role="status" className="mt-5 rounded-2xl bg-lavender/20 p-4">
              {actions.phase ??
                (progress?.settled
                  ? Number(progress.serumId)
                    ? "A serum was found! Your card is updating."
                    : "Nothing found this time. Your previous unused serum stays."
                  : progress?.status === "completed"
                    ? "Transformation complete."
                    : progress?.status === "randomness"
                      ? "Waiting for the finish and transformation randomness to settle…"
                      : actions.pending?.requestId
                        ? "Request accepted. Your card will update automatically."
                        : "Transaction sent. Waiting for confirmation…")}
            </p>
          )}
          {actions.error && (
            <p role="alert" className="mt-4 text-red-700">
              {actions.error}
            </p>
          )}
        </>
      )}
      <DialogSurface
        ref={dialog}
        size="lg"
        aria-labelledby="evolution-review-title"
        onCancel={() => actions.closeReview()}
      >
        {actions.review && (
          <>
            <h2
              id="evolution-review-title"
              className="font-display text-2xl font-bold"
            >
              {actions.review.quote.kind === "fusion"
                ? "Unite your Yunipals"
                : actions.review.quote.kind === "serum"
                  ? "A new transformation"
                  : "Ready to explore?"}
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-4">
              {actions.review.quote.cards.map((c) => (
                <AdventureCardTile key={c.tokenId} card={c} />
              ))}
            </div>
            {actions.review.quote.kind === "fusion" && (
              <>
                <p className="mt-4 text-sm">
                  Both inputs burn only after the new artwork is ready. Applied
                  effects stay; unused serums are discarded. The result gets 11
                  fresh dose slots and inherits the later adventure cooldown.
                </p>
                {actions.review.quote.cards.some(
                  (c) => c.level === 0 && c.sources.some((s) => s.isOriginal)
                ) && (
                  <p className="mt-3 font-semibold text-red-700">
                    An original is included. Its remaining daily claims end when
                    fusion completes.
                  </p>
                )}
                <p className="mt-3">
                  Presence:{" "}
                  {fusionPresenceOdds(
                    actions.review.quote.cards[0].presence,
                    actions.review.quote.cards[1].presence
                  )
                    .map((p) => `${serumPresences[p.presence]} ${p.percent}%`)
                    .join(" or ")}
                </p>
              </>
            )}
            {actions.review.quote.kind === "serum" && (
              <p className="mt-4">
                Presence changes from{" "}
                {serumPresences[actions.review.quote.cards[0].presence]} to{" "}
                {
                  serumPresences[
                    actions.review.quote.cards[0].unused!.presenceId
                  ]
                }
                . Earlier physical effects remain.
              </p>
            )}
            {actions.review.quote.kind !== "adventure" && (
              <p className="mt-4 text-sm">
                {actions.review.quote.kind === "fusion" ||
                actions.review.quote.cards[0].finish === 0
                  ? "New finish: Normal 70% · Golden 25% · Black 5%. This result stays through later serums and grading. Retrying generation never rerolls it."
                  : `Finish stays ${cardFinishes[actions.review.quote.cards[0].finish]}; no new finish roll.`}
              </p>
            )}
            <p className="mt-4 font-semibold">
              {actions.review.quote.fee === "0"
                ? actions.review.quote.kind === "serum"
                  ? "AI generation sponsored · 0 USDC"
                  : "No AI fee"
                : "AI generation: 0.10 USDC"}
            </p>
            {actions.review.quote.kind === "serum" &&
              actions.review.quote.fee === "0" && (
                <p className="mt-1 text-sm">
                  One of the first 1,000 serum applications. If the allowance
                  runs out before confirmation, this transaction reverts instead
                  of charging USDC. Gas can still be spent.
                </p>
              )}
            <p className="mt-1 text-sm">
              Randomness: up to{" "}
              {formatEther(BigInt(actions.review.quote.value))} ETH. Network gas
              is separate; excess randomness payment is returned or credited.
            </p>
            {actions.review.quote.kind !== "adventure" && (
              <p className="mt-3 text-sm text-muted">
                Inputs stay reserved until generation succeeds. Processing
                retries automatically, without another player fee; there is no
                cancellation timer.
              </p>
            )}
            <div className="mt-6 flex gap-3">
              <button
                className={adventureButton}
                disabled={!!actions.phase}
                onClick={() => void actions.confirm()}
              >
                Confirm in wallet
              </button>
              <button
                className="rounded-full border border-line px-5 py-3"
                disabled={!!actions.phase}
                onClick={() => actions.closeReview()}
              >
                Back
              </button>
            </div>
            {actions.error && (
              <p role="alert" className="mt-4 text-red-700">
                {actions.error}
              </p>
            )}
          </>
        )}
      </DialogSurface>
    </main>
  );
}
