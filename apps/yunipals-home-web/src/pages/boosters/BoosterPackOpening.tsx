import { useAccount } from "wagmi";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";

import { collectorHref } from "@/lib/collectionEdition";
import { BoosterCardViewer } from "@/components/BoosterCardViewer";
import {
  createScene,
  isAbort,
  type Phase,
  type Scene
} from "@/components/pack-opening/scene";
import { holoRip } from "@/components/pack-opening/holoRip";
import { revealNextCard } from "@/components/pack-opening/variants";
import {
  boosterQueryKey,
  fetchBoosterMonster,
  fetchMonsterArtwork,
  type MonsterArtwork
} from "@/lib/boosters";
import { BoosterOpeningShare } from "./BoosterOpeningShare";
import "./booster-pack-opening.css";

export type BoosterOpeningCard = {
  collection: string;
  tokenId: string;
  metadataUri?: string;
  artwork?: MonsterArtwork;
};
type PackContent = {
  recipient?: string;
  onClose: () => void;
  packImage?: string;
  metadataUri?: string;
  artwork?: MonsterArtwork;
  additionalCards?: readonly BoosterOpeningCard[];
  replayHash?: string;
};
export type BoosterPackOpeningProps = PackContent &
  (
    | { mode: "demo"; tokenId?: never; collection?: never }
    | { mode?: "revealed"; tokenId: string; collection: string }
  );

// This overlay only reveals cards that have already been minted.
export function BoosterPackOpening(props: BoosterPackOpeningProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [run, setRun] = useState(0);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="olab-dialog yunipals-opening-dialog"
      aria-label="Yunipals pack opening"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <OpeningRun
        key={`${run}:${reduced}`}
        reduced={reduced}
        {...props}
        onReplay={() => setRun((value) => value + 1)}
      />
    </dialog>,
    document.body
  );
}

function OpeningRun(
  props: BoosterPackOpeningProps & { onReplay: () => void; reduced: boolean }
) {
  const { reduced } = props;
  const { address } = useAccount();
  const queries = useQueryClient();
  const demo = props.mode === "demo";
  const recipient = props.recipient;
  const ownCollection = Boolean(
    recipient && address?.toLowerCase() === recipient.toLowerCase()
  );
  const packImage = props.packImage ?? "/images/boosters/yunipals-pack-v1.png";
  const [phase, setPhase] = useState<Phase>("opening");
  const [hint, setHint] = useState("");
  const [cardIndex, setCardIndex] = useState(0);
  const revealed = phase === "revealed";
  const descriptionId = useId();
  const scene = useRef<Scene | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const pack = useRef<HTMLDivElement>(null);
  const cardElement = useRef<HTMLDivElement>(null);
  const flip = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const sheen = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const resultAction = useRef<HTMLButtonElement>(null);
  const bgCanvas = useRef<HTMLCanvasElement>(null);
  const fxCanvas = useRef<HTMLCanvasElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const activeCard =
    (cardIndex > 0 ? props.additionalCards?.[cardIndex - 1] : undefined) ??
    props;
  const totalCards = 1 + (props.additionalCards?.length ?? 0);
  const hasMoreCards = cardIndex + 1 < totalCards;
  const monster = useQuery({
    queryKey: [
      ...boosterQueryKey,
      "opening-monster",
      activeCard.collection,
      activeCard.tokenId
    ],
    enabled: !demo && !activeCard.metadataUri && !activeCard.artwork,
    queryFn: ({ signal }) =>
      fetchBoosterMonster(activeCard.collection!, activeCard.tokenId!, signal),
    retry: 1,
    refetchInterval: (query) => (query.state.data ? false : 5000)
  });
  const metadataUri = activeCard.metadataUri ?? monster.data?.item.metadataUri;
  const artworkQuery = useQuery({
    queryKey: [...boosterQueryKey, "artwork", metadataUri],
    enabled: Boolean(metadataUri) && !activeCard.artwork,
    queryFn: ({ signal }) => fetchMonsterArtwork(metadataUri!, signal),
    retry: 1,
    refetchInterval: (query) =>
      query.state.data?.status === "ready" ? false : 5000
  });
  const artwork = activeCard.artwork ?? artworkQuery.data;

  useEffect(() => {
    if (!artwork?.image) return;
    // Warm the approved image before the card rises out of the pack.
    const image = new Image();
    image.decoding = "async";
    image.src = artwork.image;
  }, [artwork?.image]);

  const artworkRef = useRef(artwork);
  artworkRef.current = artwork;
  useEffect(() => {
    const element = stage.current!;
    const fit = () =>
      element.style.setProperty(
        "--olab-w",
        `${Math.max(60, Math.min(290, element.clientWidth * 0.6, element.clientHeight * 0.5))}px`
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // Skip the entire animation engine (including its frame loop) for reduced motion.
    if (reduced) {
      setPhase("sealed");
      setHint("Tap the pack to open it");
      return;
    }
    const created = createScene(
      {
        stage: stage.current!,
        world: world.current!,
        pack: pack.current!,
        card: cardElement.current!,
        flip: flip.current!,
        front: front.current!,
        back: back.current!,
        sheen: sheen.current!,
        layer: layer.current!,
        flash: flash.current!,
        trigger: trigger.current!,
        bgCanvas: bgCanvas.current!,
        fxCanvas: fxCanvas.current!,
        glCanvas: glCanvas.current!
      },
      {
        packImage,
        shaders: false,
        setHint,
        setPhase,
        advanceCard: () => flushSync(() => setCardIndex((value) => value + 1)),
        artwork: () => artworkRef.current
      }
    );
    scene.current = created.scene;
    holoRip.run(created.scene).catch((error: unknown) => {
      if (!isAbort(error)) {
        // Animation failures must never hide a successfully minted card.
        created.scene.hidePack();
        created.scene.set(created.scene.card, {
          opacity: 1,
          transform: "none"
        });
        created.scene.reveal();
        console.error(error);
      }
    });
    return () => {
      scene.current = null;
      created.destroy();
      layer.current?.replaceChildren();
    };
  }, [packImage, reduced]);
  useEffect(() => {
    if (phase === "sealed") trigger.current?.focus({ preventScroll: true });
    if (phase === "revealed")
      resultAction.current?.focus({ preventScroll: true });
  }, [phase]);
  useEffect(() => {
    if (cardElement.current) cardElement.current.inert = !revealed;
  }, [revealed]);
  const nextCard = () => {
    if (!hasMoreCards || !revealed) return;
    if (reduced) {
      setCardIndex((value) => value + 1);
      return;
    }
    if (scene.current)
      void revealNextCard(scene.current, holoRip).catch((error: unknown) => {
        if (!isAbort(error)) console.error(error);
      });
  };
  const card = artwork?.image ? (
    <BoosterCardViewer artwork={artwork} interactive={revealed} />
  ) : (
    <div className="olab-card-back yunipals-opening-placeholder" role="status">
      <img
        src="/images/yunipals-logo.webp"
        alt=""
        width={64}
        height={64}
        className="mb-4 h-16 w-16"
      />
      <span className="display text-2xl">{artwork?.name ?? "YUNIPALS"}</span>
      <p className="mt-3 text-sm">
        {demo
          ? "Sample card preview"
          : monster.error || artworkQuery.error
            ? "The artwork could not be loaded. Your NFT is safe in Collection."
            : artwork?.status === "blocked"
              ? "Artwork needs attention before it can be published. Your NFT is already minted."
              : artwork?.status === "queued" || artwork?.status === "missing"
                ? "Your NFT is minted. Its artwork is awaiting generation."
                : "Loading your card artwork…"}
      </p>
      {artwork && (
        <p className="mt-3 text-xs opacity-80">
          {[
            artwork.attributes.color,
            artwork.attributes.horn,
            artwork.attributes.glitter === "Yes" ? "Glitter" : undefined
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {(monster.error || artworkQuery.error) && (
        <button
          type="button"
          className="mt-4 underline"
          disabled={!revealed}
          onClick={() => {
            if (!demo && !activeCard.metadataUri) void monster.refetch();
            if (metadataUri) void artworkQuery.refetch();
          }}
        >
          Retry artwork
        </button>
      )}
    </div>
  );

  return (
    <div
      className="yunipals-opening-content"
      data-stage={revealed ? "results" : phase}
      data-reduced-motion={reduced}
      style={
        {
          "--olab-bg": holoRip.background,
          "--olab-accent": holoRip.palette[0],
          "--olab-accent-2": holoRip.palette[1],
          "--olab-pack": `url("${packImage}")`
        } as CSSProperties
      }
    >
      <header className="yunipals-opening-header">
        <h1 className="display text-center text-2xl sm:text-4xl">
          {revealed
            ? demo
              ? "A little preview of the magic."
              : "Meet your Yunipal."
            : "A little magic inside."}
        </h1>
        <p id={descriptionId} className="mt-2 text-sm text-white/75">
          {demo
            ? "Demo preview — no NFT is minted."
            : "Your cards are ready. Let’s see who’s inside."}
        </p>
        {totalCards > 1 && (
          <p
            className="mt-2 text-sm font-semibold text-white/80"
            aria-live="polite"
          >
            Card {cardIndex + 1} of {totalCards}
          </p>
        )}
      </header>
      <button
        type="button"
        aria-label="Close pack opening"
        onClick={props.onClose}
        className="olab-icon olab-close"
      >
        <X aria-hidden="true" size={22} />
      </button>
      <div
        ref={stage}
        className="olab-stage yunipals-opening-stage"
        data-variant={holoRip.id}
        data-phase={phase}
      >
        <canvas
          ref={bgCanvas}
          className="olab-canvas olab-bg"
          aria-hidden="true"
        />
        <div ref={world} className="olab-world">
          <div ref={pack} className="olab-pack">
            <div className="olab-pack-art" />
          </div>
          <div ref={cardElement} className="olab-card" aria-hidden={!revealed}>
            <div ref={flip} className="olab-card-flip">
              <div ref={front} className="olab-card-front">
                {card}
              </div>
              <div
                ref={back}
                className="olab-card-back-face"
                aria-hidden="true"
              >
                <div className="olab-card-back">
                  <img
                    src="/images/yunipals-logo.webp"
                    alt=""
                    width={96}
                    height={96}
                  />
                  <span className="display">Yunipals</span>
                </div>
              </div>
              <div ref={sheen} className="olab-sheen" aria-hidden="true" />
            </div>
          </div>
          <div ref={layer} className="olab-layer" aria-hidden="true" />
        </div>
        <canvas
          ref={glCanvas}
          className="olab-canvas olab-gl"
          aria-hidden="true"
        />
        <canvas
          ref={fxCanvas}
          className="olab-canvas olab-fx"
          aria-hidden="true"
        />
        <div ref={flash} className="olab-flash" aria-hidden="true" />
        <button
          ref={trigger}
          type="button"
          className="olab-trigger"
          aria-label="Rip pack seal"
          aria-describedby={descriptionId}
          data-stage-action="sealed"
          disabled={phase !== "sealed"}
          onClick={reduced ? () => setPhase("revealed") : undefined}
        />
      </div>
      <footer className="yunipals-opening-footer">
        <p
          className="yunipals-opening-instructions text-center text-sm text-white/80"
          aria-live="polite"
        >
          {revealed
            ? "Tilt your card to see the holo shine."
            : phase === "sealed"
              ? hint
              : "Open a little wonder…"}
        </p>
        {revealed && (
          <>
            {artwork?.name && (
              <h2 className="display text-center text-xl">{artwork.name}</h2>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <button
                ref={resultAction}
                type="button"
                data-stage-action="results"
                onClick={hasMoreCards ? nextCard : props.onReplay}
                className="olab-action is-primary"
              >
                {hasMoreCards ? "Next card" : "Replay opening"}
              </button>
              {!demo && (
                <Link
                  className="olab-action"
                  onClick={props.onClose}
                  to={`/monsters/${activeCard.collection}/${activeCard.tokenId}`}
                >
                  View Yunipal #{activeCard.tokenId}
                </Link>
              )}
              {!hasMoreCards && (
                <Link
                  className="olab-action"
                  onClick={() => {
                    if (recipient && !demo && activeCard.collection)
                      void queries.resetQueries({
                        queryKey: [
                          ...boosterQueryKey,
                          "normal-collection",
                          activeCard.collection.toLowerCase(),
                          recipient.toLowerCase()
                        ],
                        exact: true
                      });
                    props.onClose();
                  }}
                  to={
                    recipient && !demo
                      ? collectorHref(recipient, "tcg")
                      : "/?edition=tcg#collection"
                  }
                >
                  {ownCollection
                    ? "View my TCG collection"
                    : "View TCG collection"}
                </Link>
              )}
              <button
                type="button"
                onClick={props.onClose}
                className="olab-action"
              >
                Done
              </button>
            </div>
            {props.replayHash && (
              <div className="yunipals-opening-share">
                <BoosterOpeningShare hash={props.replayHash} />
              </div>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
