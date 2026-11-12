import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import { Link, useSearchParams } from "react-router-dom";
import { Clock, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import {
  portalColorNames,
  portalTypeNames,
  portalCountdown
} from "@protopals/yunipals-market-core/portals";
import { environment } from "@/environment";
import { usePortals } from "@/hooks/usePortals";
import {
  fetchPortalStatus,
  portalImage,
  portalPrice,
  portalRange,
  type ActivePortalStatus
} from "@/lib/portals";
import { cn } from "@/lib/utils";
import { boosterButtonClass } from "@/pages/boosters/BoosterActionButton";
import { PortalCompetitions } from "./PortalCompetitions";
import { PortalHero, PortalStory } from "./PortalArtwork";

export function PortalPage() {
  const [search] = useSearchParams();
  const query = useQuery({
    queryKey: ["portals", "active"],
    queryFn: ({ signal }) => fetchPortalStatus(signal),
    refetchInterval: 3000
  });
  const status = query.data?.enabled ? query.data : null;
  const actions = usePortals(status);
  const { openConnectModal } = useConnectModal();
  const switcher = useSwitchChain();
  const [tokenId, setTokenId] = useState(() => {
    const card = search.get("card") ?? "";
    return /^[1-9][0-9]{0,77}$/.test(card) ? card : "";
  });
  const [spell, setSpell] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setElapsed(0);
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [query.dataUpdatedAt]);
  useEffect(() => {
    if (actions.review && !dialog.current?.open) dialog.current?.showModal();
    if (!actions.review) dialog.current?.close();
  }, [actions.review]);
  const left = status
    ? Number(status.round.endsAt) - (status.now + elapsed)
    : 0;
  const portalOpen = Boolean(status?.open && left > 0);
  const accepting =
    portalOpen &&
    !status?.indexing &&
    (!status?.competition || status.competition.accepting);
  const total = status?.portal
    ? BigInt(status.portal.payment.aiFee) +
      BigInt(status.portal.payment.portalFee) +
      BigInt(status.competition?.fee ?? 0)
    : null;
  const wrongChain =
    actions.address &&
    actions.chainId !==
      (status?.deployment.chainId ?? environment.portalChainId);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!actions.address) openConnectModal?.();
    else if (wrongChain)
      switcher.switchChain({
        chainId: status?.deployment.chainId ?? environment.portalChainId
      });
    else void actions.prepare(tokenId, spell);
  }
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PortalHero />
      <div className="mb-6 flex flex-wrap items-center gap-5 text-sm font-semibold">
        <Link className="underline" to="/portals/mine">
          My portals · balances &amp; claims
        </Link>
        {status && (
          <span>
            {status.supply.live} live portals · {status.supply.burned} burned
          </span>
        )}
      </div>
      <div id="portal-cast" className="scroll-mt-24" />
      {query.isPending ? (
        <div
          role="status"
          className="h-64 animate-pulse rounded-card bg-lavender/25"
        >
          {" "}
          <span className="sr-only">Finding the active portal…</span>
        </div>
      ) : query.error ? (
        <p
          role="alert"
          className="rounded-card border border-line p-6 text-muted"
        >
          {query.error.message}{" "}
          <button
            className="font-bold underline"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      ) : !status ? (
        <div className="rounded-card bg-hero-lav p-8">
          <h2 className="font-display text-2xl">Portals are being prepared</h2>
          <p className="mt-3 text-muted">
            Your cards will be able to travel soon.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section
            aria-labelledby="active-portal-title"
            className="overflow-hidden rounded-card border border-lavender bg-hero-lav p-6 sm:p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-bold",
                  portalOpen ? "bg-mint text-ink" : "bg-white text-muted"
                )}
              >
                {status.indexing
                  ? "Updating portal data"
                  : portalOpen
                    ? "Portal open"
                    : "Portal closed"}
              </span>
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Clock size={17} aria-hidden="true" />
                {portalOpen
                  ? `${portalCountdown(Number(status.round.endsAt), status.now + elapsed)} left`
                  : status.supply.live === "0"
                    ? "No live portals"
                    : left > 0
                      ? `Next window in ${portalCountdown(Number(status.round.endsAt), status.now + elapsed)}`
                      : "Waiting for the next window"}
              </span>
            </div>
            {status.indexing && (
              <p
                role="status"
                className="mt-4 rounded-2xl bg-white/70 p-4 text-sm"
              >
                The portal is confirmed onchain. Its data is being indexed
                before new spells can be reviewed. The eleven-minute window
                continues to run.
              </p>
            )}
            {status.statusReason === "retired" && (
              <p className="mt-4 font-semibold">
                This portal was redeemed. Entry is closed.
                {left > 0 &&
                  " The next window cannot open before this slot ends."}
              </p>
            )}
            {status.statusReason === "empty" && (
              <p className="mt-4 font-semibold">
                {status.supply.minted === "0"
                  ? "Portals are waiting to be minted."
                  : "No portals available. All minted portals have been redeemed."}
              </p>
            )}
            {status.supply.live === "1" && (
              <p className="mt-4 text-sm text-muted">
                One portal remains. It may open again in consecutive 11-minute
                slots.
              </p>
            )}
            {status.portal ? (
              <>
                <img
                  className="mx-auto mt-6 max-h-72 rounded-2xl object-contain"
                  src={portalImage(status.portal.imageURI)}
                  alt={status.portal.name}
                />
                <h2
                  id="active-portal-title"
                  className="mt-6 font-display text-2xl"
                >
                  {status.portal.name} #{status.portal.id}
                </h2>
                <PortalFilters status={status} />
                {status.portal.effect && (
                  <div className="mt-5 rounded-2xl bg-white/70 p-4 text-sm">
                    <p className="font-bold">What this portal adds</p>
                    <p className="mt-2 leading-relaxed text-muted">
                      {status.portal.effect.instruction}
                    </p>
                  </div>
                )}
                {status.portal.gradingCase && (
                  <details className="mt-4 rounded-2xl bg-white/70 p-4 text-sm">
                    <summary className="cursor-pointer font-bold">
                      How this portal grades
                    </summary>
                    <p className="mt-3 font-bold">
                      {status.portal.gradingCase.title}
                    </p>
                    <dl className="mt-3 space-y-3">
                      {Object.entries(status.portal.gradingCase.criteria).map(
                        ([category, description]) => (
                          <div key={category}>
                            <dt className="font-bold capitalize">{category}</dt>
                            <dd className="mt-1 leading-relaxed text-muted">
                              {description}
                            </dd>
                          </div>
                        )
                      )}
                    </dl>
                  </details>
                )}
              </>
            ) : (
              <div className="my-8 flex flex-col items-center gap-5 sm:flex-row">
                <img
                  src="/images/portals/rainbow-portal-card.webp"
                  width={1024}
                  height={1536}
                  alt="Rainbow Portal card preview"
                  className="w-28 -rotate-3 rounded-xl shadow-card sm:w-36"
                  loading="lazy"
                />
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-grape">
                    A glimpse of the magic
                  </p>
                  <h2
                    id="active-portal-title"
                    className="mt-3 font-display text-2xl"
                  >
                    The first portal is waiting to open
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    Meet the Rainbow Portal. A new world of color for your
                    Yunipal, while keeping a little of its original hue.
                  </p>
                  <p className="mt-3 text-xs text-muted">
                    Artwork preview · entry opens with an active portal.
                  </p>
                </div>
              </div>
            )}
            <div className="mt-6 border-t border-lavender pt-5">
              <p className="text-sm text-muted">
                Anyone can help prepare the next random portal. A randomness
                request uses ETH; your wallet shows the amount before you
                confirm.
              </p>
              <button
                type="button"
                className={cn(boosterButtonClass, "mt-4")}
                disabled={
                  actions.busy ||
                  (!status.rotationIndexed && status.rotation.canActivate) ||
                  (!status.rotation.canActivate &&
                    !status.rotation.canRequest) ||
                  (status.rotation.requestId !== "0" &&
                    !status.rotation.canActivate)
                }
                onClick={() => {
                  if (!actions.address) openConnectModal?.();
                  else if (wrongChain)
                    switcher.switchChain({
                      chainId: status.deployment.chainId
                    });
                  else void actions.rotate();
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {status.rotation.canActivate
                  ? "Open the next portal"
                  : status.rotation.requestId !== "0"
                    ? "Next portal is being prepared"
                    : "Prepare the next portal"}
              </button>
            </div>
          </section>
          <section
            aria-labelledby="cast-spell-title"
            className="rounded-card border border-line bg-white p-6 shadow-card sm:p-8"
          >
            <Wand2 className="text-grape" aria-hidden="true" />
            <h2 id="cast-spell-title" className="mt-3 font-display text-2xl">
              Your card, your spell
            </h2>
            {status.competition?.theme && (
              <div className="mt-4 rounded-2xl bg-lavender/15 p-4 text-sm">
                <p className="font-bold text-grape">
                  This challenge · {status.competition.theme.title}
                </p>
                <p className="mt-2 leading-relaxed text-muted">
                  {status.competition.theme.brief}
                </p>
              </div>
            )}
            <form className="mt-6 space-y-5" onSubmit={submit}>
              <div>
                <label
                  className="block text-sm font-bold"
                  htmlFor="portal-card-id"
                >
                  Card number
                </label>
                <input
                  id="portal-card-id"
                  inputMode="numeric"
                  pattern="[1-9][0-9]*"
                  required
                  value={tokenId}
                  onChange={(event) => setTokenId(event.target.value)}
                  disabled={actions.busy}
                  className="mt-2 w-full rounded-2xl border border-line px-4 py-3 focus-visible:outline-grape"
                  placeholder="Your TCG token ID"
                />
                {actions.address && (
                  <Link
                    className="mt-2 inline-block text-sm font-semibold text-grape underline"
                    to={`/collector/${actions.address}`}
                  >
                    Find a card in your collection
                  </Link>
                )}
              </div>
              <div>
                <label
                  className="block text-sm font-bold"
                  htmlFor="portal-spell"
                >
                  Your spell
                </label>
                <textarea
                  id="portal-spell"
                  required
                  maxLength={6000}
                  rows={5}
                  value={spell}
                  onChange={(event) => setSpell(event.target.value)}
                  disabled={actions.busy}
                  className="mt-2 w-full resize-y rounded-2xl border border-line px-4 py-3 focus-visible:outline-grape"
                  placeholder="Describe the transformation you imagine…"
                />
                <p className="mt-2 text-sm text-muted">
                  Simple ideas can score highly. Copying another player's
                  distinctive spell can reduce Creativity.
                </p>
              </div>
              {status.portal && (
                <dl className="space-y-2 rounded-2xl bg-lavender/15 p-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt>Image creation + grading</dt>
                    <dd>{portalPrice(status.portal.payment.aiFee)} USDC</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Accumulates on portal #{status.portal.id}</dt>
                    <dd>{portalPrice(status.portal.payment.portalFee)} USDC</dd>
                  </div>
                  {status.competition && (
                    <div className="flex justify-between gap-3">
                      <dt>
                        {status.competition.batchSize}-entry competition pool
                      </dt>
                      <dd>{portalPrice(status.competition.fee)} USDC</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 border-t border-line pt-2 font-bold">
                    <dt>Total per spell</dt>
                    <dd>{portalPrice(total ?? 0n)} USDC</dd>
                  </div>
                </dl>
              )}
              <button
                type={actions.address ? "submit" : "button"}
                onClick={
                  !actions.address ? () => openConnectModal?.() : undefined
                }
                className={cn(boosterButtonClass, "w-full")}
                disabled={
                  actions.busy || (!accepting && Boolean(actions.address))
                }
              >
                {!actions.address
                  ? "Connect wallet"
                  : wrongChain
                    ? "Switch network"
                    : accepting
                      ? "Review your spell"
                      : status?.competition && !status.competition.accepting
                        ? "Waiting for the next challenge"
                        : "Wait for an open portal"}
                <Sparkles size={17} aria-hidden="true" />
              </button>
            </form>
            <p className="mt-5 text-sm text-muted">
              An accepted spell continues after the portal closes. You can still
              trade your card while it is being processed. Each new attempt uses
              the latest completed artwork.
            </p>
            {actions.phase !== "idle" && (
              <p role="status" className="mt-4 text-sm font-semibold">
                {actions.phase}
              </p>
            )}
            {actions.error && (
              <p role="alert" className="mt-4 break-words text-sm text-grape">
                {actions.error}
              </p>
            )}
            {actions.submitted && (
              <div role="status" className="mt-5 rounded-2xl bg-mint/40 p-4">
                <p className="font-bold">Your spell was accepted</p>
                <p className="mt-1 text-sm">
                  Card #{actions.submitted.tokenId} is being transformed.
                </p>
                <Link
                  className="mt-2 inline-block text-sm font-bold underline"
                  to={`/portals/cards/${actions.submitted.tokenId}`}
                >
                  Follow its artwork and grades
                </Link>
              </div>
            )}
          </section>
        </div>
      )}
      <PortalStory />
      {(status?.competition || environment.portalGrading) && (
        <PortalCompetitions />
      )}
      <dialog
        ref={dialog}
        aria-labelledby="portal-review-title"
        onCancel={(event) => {
          event.preventDefault();
          actions.dismiss();
        }}
        className="w-full max-w-lg rounded-card bg-white p-6 text-ink shadow-card backdrop:bg-ink/50"
      >
        <h2 id="portal-review-title" className="font-display text-2xl">
          Review your spell
        </h2>
        {actions.review && (
          <>
            <div className="mt-5 flex items-start gap-4">
              <img
                src={portalImage(actions.review.quote.input.uri)}
                className="w-24 rounded-xl"
                alt={`Card #${actions.review.quote.tokenId} before the spell`}
              />
              <p className="whitespace-pre-wrap break-words text-sm">
                {actions.review.spell}
              </p>
            </div>
            <p className="mt-5 font-bold">
              {actions.review.quote.portal?.effect && (
                <span className="mb-4 block rounded-2xl bg-lavender/15 p-4 text-sm font-normal">
                  <strong className="mb-2 block">The portal also adds</strong>
                  {actions.review.quote.portal.effect.instruction}
                </span>
              )}
              Total:{" "}
              {portalPrice(
                BigInt(actions.review.quote.portal?.payment.aiFee ?? 0) +
                  BigInt(actions.review.quote.portal?.payment.portalFee ?? 0) +
                  BigInt(actions.review.quote.competition?.fee ?? 0)
              )}{" "}
              USDC
            </p>
            <p className="mt-2 text-sm text-muted">
              This pays for one image edit and grading attempt. Accepted
              requests have no automatic refund or expiry.
            </p>
            {actions.review.quote.competition && (
              <p className="mt-2 text-sm text-muted">
                Includes {portalPrice(actions.review.quote.competition.fee)}{" "}
                USDC for challenge #{actions.review.quote.competition.nextBatch}
                : {actions.review.quote.competition.theme.title}. Your
                transaction is bound to this theme; if the challenge fills
                first, you must review a new quote. Prizes go to this submitting
                wallet even if you sell the card. Grading starts independently
                of the competition.
              </p>
            )}
          </>
        )}
        {actions.busy && (
          <p role="status" className="mt-4 text-sm">
            {actions.phase}
          </p>
        )}
        {actions.error && (
          <p role="alert" className="mt-4 text-sm text-grape">
            {actions.error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className={boosterButtonClass}
            disabled={actions.busy}
            onClick={() => void actions.confirm()}
          >
            Pay and cast spell
          </button>
          <button
            className="rounded-full border border-line px-5 py-3 text-sm font-bold"
            disabled={actions.busy}
            onClick={actions.dismiss}
          >
            Close
          </button>
        </div>
      </dialog>
    </main>
  );
}

function PortalFilters({ status }: { status: ActivePortalStatus }) {
  const gates = status.portal?.gates;
  if (!gates) return null;
  return (
    <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
      {[
        ["Color", portalColorNames[gates.colorGate]],
        ["Type", portalTypeNames[gates.typeGate]],
        [
          "Cards",
          gates.originalOnly
            ? "Original cards only"
            : `Sequence ${portalRange(gates.sequenceStart, gates.sequenceLength)}`
        ],
        ["Glitter", gates.glitterGate ? "Required" : "Any finish"],
        ["Horn", gates.diamondGate ? "Diamond required" : "Any horn"]
      ].map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-white/75 p-3">
          <dt className="text-muted">{label}</dt>
          <dd className="mt-1 font-bold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
