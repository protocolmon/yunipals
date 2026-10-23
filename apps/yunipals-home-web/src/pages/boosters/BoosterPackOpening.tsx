import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, X } from "lucide-react";

import { BoosterCardViewer } from "@/components/BoosterCardViewer";
import {
  boosterQueryKey,
  fetchBoosterMonster,
  fetchMonsterArtwork,
  type MonsterArtwork
} from "@/lib/boosters";
import "./booster-pack-opening.css";

export type BoosterOpeningCard = {
  collection: string;
  tokenId: string;
  metadataUri?: string;
  artwork?: MonsterArtwork;
};
type PackContent = {
  onClose: () => void;
  packImage?: string;
  metadataUri?: string;
  artwork?: MonsterArtwork;
  additionalCards?: readonly BoosterOpeningCard[];
};
export type BoosterPackOpeningProps = PackContent &
  (
    | { mode: "demo"; tokenId?: never; collection?: never }
    | { mode?: "revealed"; tokenId: string; collection: string }
  );
type Stage = "sealed" | "opening" | "extracting" | "revealing" | "results";
type GestureKind = "swipe" | "draw" | "pull" | "reveal";
type Motion = Record<GestureKind, number>;
const INITIAL: Motion = { swipe: 0, draw: 0, pull: 0, reveal: 0 };
const PARTICLES = Array.from({ length: 18 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 18 - Math.PI / 2;
  const distance = 90 + (index % 4) * 24;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    rotate: index % 2 === 0 ? 210 : -190,
    delay: (index % 3) * 0.025,
    color: ["#ffffff", "#a78bfa", "#22d3ee", "#f9a8d4"][index % 4]
  };
});

// Geometry, thresholds, spring and timings are ported from Protobits'
// ExperimentalPackOpening. This overlay only replays an already revealed NFT.
export function BoosterPackOpening(props: BoosterPackOpeningProps) {
  const demo = props.mode === "demo";
  const packImage = props.packImage ?? "/images/boosters/yunipals-pack-v1.png";
  const [stage, setStage] = useState<Stage>("sealed");
  const [cardIndex, setCardIndex] = useState(0);
  const [motion, setMotion] = useState<Motion>(INITIAL);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [distance, setDistance] = useState(196);
  const [packHeight, setPackHeight] = useState(495);
  const dialog = useRef<HTMLDialogElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);
  const completed = useRef(false);
  const descriptionId = useId();
  const activeCard =
    (cardIndex > 0 ? props.additionalCards?.[cardIndex - 1] : undefined) ??
    props;
  const totalCards = 1 + (props.additionalCards?.length ?? 0);
  const hasMoreCards = cardIndex + 1 < totalCards;
  const gesture = useRef<{
    kind: GestureKind;
    pointer: number;
    x: number;
    y: number;
    value: number;
    samples: { x: number; y: number; time: number }[];
  } | null>(null);
  const drawDistance = Math.max(210, Math.min(325, distance * 1.48));
  const pullDistance = Math.max(190, Math.min(320, distance * 1.4));
  const revealDistance = Math.max(170, Math.min(270, distance * 1.18));
  const packDrawOffset = Math.min(105, drawDistance * 0.32);
  const completedDraw = Math.max(
    drawDistance,
    packHeight * 0.9 - packDrawOffset + 12
  );
  const completedPull = Math.max(pullDistance, packHeight * 0.9 + 12);
  const drawProgress = Math.max(0, Math.min(1, -motion.draw / drawDistance));
  const progress = Math.max(0, Math.min(1, motion.swipe / distance));
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
    // Warm the same approved image while the wrapper is still sealed, so the
    // small first peek does not wait for the static viewer's lazy image.
    const image = new Image();
    image.decoding = "async";
    image.src = artwork.image;
  }, [artwork?.image]);

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
    element
      .querySelector<HTMLButtonElement>('[data-stage-action="sealed"]')
      ?.focus();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
      if (timer.current) clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const update = () => {
      setDistance(Math.max(120, Math.min(230, element.clientWidth * 0.82)));
      setPackHeight(element.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stage === "results"]);
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLButtonElement>(`[data-stage-action="${stage}"]`)
      ?.focus();
  }, [stage]);

  const later = (next: Stage, milliseconds: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setSettling(false);
      setStage(next);
    }, milliseconds);
  };
  const haptic = (duration: number) => {
    if (!reduced && "vibrate" in navigator) navigator.vibrate(duration);
  };
  const finish = (kind: GestureKind) => {
    if (settling || (kind === "swipe" && completed.current)) return;
    cancelAnimationFrame(frame.current);
    gesture.current = null;
    setDragging(false);
    setSettling(true);
    if (kind === "swipe") {
      completed.current = true;
      setMotion((value) => ({ ...value, swipe: distance }));
      setStage("opening");
      haptic(18);
      later("extracting", reduced ? 220 : 720);
    } else if (kind === "draw" || kind === "pull") {
      setMotion((value) => ({
        ...value,
        [kind]: kind === "draw" ? -completedDraw : completedPull
      }));
      haptic(12);
      later("revealing", reduced ? 140 : 560);
    } else {
      setMotion((value) => ({
        ...value,
        reveal: (value.reveal < 0 ? -1 : 1) * revealDistance * 1.18
      }));
      haptic(10);
      later("results", reduced ? 140 : 460);
    }
  };
  const reset = (kind: GestureKind, value: number) => {
    setDragging(false);
    // Same mass=1, stiffness=420, damping=28 spring as the source gesture.
    const start = performance.now();
    const spring = (now: number) => {
      const t = (now - start) / 1000;
      const frequency = Math.sqrt(420 - 14 * 14);
      const next =
        reduced || t > 0.65
          ? 0
          : value *
            Math.exp(-14 * t) *
            (Math.cos(frequency * t) +
              (14 / frequency) * Math.sin(frequency * t));
      setMotion((current) => ({ ...current, [kind]: next }));
      if (next !== 0) frame.current = requestAnimationFrame(spring);
    };
    frame.current = requestAnimationFrame(spring);
  };
  const begin = (
    kind: GestureKind,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (settling || (event.pointerType === "mouse" && event.button !== 0))
      return;
    cancelAnimationFrame(frame.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      kind,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      value: 0,
      samples: [{ x: event.clientX, y: event.clientY, time: performance.now() }]
    };
    setMotion((value) =>
      kind === "draw" || kind === "pull"
        ? { ...value, draw: 0, pull: 0 }
        : { ...value, [kind]: 0 }
    );
    setDragging(true);
  };
  const position = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return null;
    const x = event.clientX - current.x,
      y = event.clientY - current.y;
    const maximum =
      current.kind === "swipe"
        ? distance
        : current.kind === "draw"
          ? drawDistance
          : current.kind === "pull"
            ? pullDistance
            : revealDistance;
    const value =
      current.kind === "swipe" || current.kind === "pull"
        ? Math.max(0, Math.min(maximum, current.kind === "swipe" ? x : y))
        : current.kind === "draw"
          ? Math.max(-maximum, Math.min(0, y))
          : Math.max(-maximum, Math.min(maximum, x));
    setMotion((previous) => ({ ...previous, [current.kind]: value }));
    current.value = value;
    const now = performance.now();
    current.samples.push({ x: event.clientX, y: event.clientY, time: now });
    current.samples = current.samples.filter(
      (sample) => now - sample.time <= 100
    );
    return value;
  };
  const end = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false
  ) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const value = cancelled ? current.value : (position(event) ?? 0);
    gesture.current = null;
    const first = current.samples[0],
      last = current.samples.at(-1)!;
    const elapsed = Math.max(1, last.time - first.time) / 1000;
    const vx = (last.x - first.x) / elapsed,
      vy = (last.y - first.y) / elapsed;
    const enough =
      current.kind === "swipe"
        ? value / distance >= 0.7 || (value / distance >= 0.42 && vx >= 700)
        : current.kind === "draw"
          ? -value / drawDistance >= 0.52 ||
            (-value / drawDistance >= 0.24 && vy <= -650)
          : current.kind === "pull"
            ? value / pullDistance >= 0.48 ||
              (value / pullDistance >= 0.22 && vy >= 650)
            : Math.abs(value) / revealDistance >= 0.38 || Math.abs(vx) >= 650;
    if (!cancelled && enough) finish(current.kind);
    else reset(current.kind, value);
  };
  const control = (kind: GestureKind) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) =>
      begin(kind, event),
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      position(event);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => end(event),
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) =>
      end(event, true),
    onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) =>
      end(event, true),
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0) finish(kind);
    }
  });
  const replay = () => {
    if (timer.current) clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    completed.current = false;
    gesture.current = null;
    setCardIndex(0);
    setMotion(INITIAL);
    setDragging(false);
    setSettling(false);
    setStage("sealed");
  };
  const nextCard = () => {
    if (!hasMoreCards) return;
    if (timer.current) clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    gesture.current = null;
    setCardIndex((value) => value + 1);
    setMotion({ ...INITIAL, swipe: distance });
    setDragging(false);
    setSettling(false);
    setStage("extracting");
  };
  const style = {
    "--pack-image": `url("${packImage}")`,
    "--rip-edge": `${progress * 100}%`,
    "--rip-x": `${motion.swipe}px`,
    "--rip-progress": progress,
    "--curl-transform": `translateY(${-17 * progress}px) rotateX(${-62 * progress}deg) rotateZ(${9 * progress}deg) scaleY(${1 - progress * 0.28})`,
    "--curl-origin": `${Math.max(0.02, progress) * 100}% 8.7%`,
    "--pack-rotate": `${-1.5 + progress * 3}deg`,
    "--pack-scale": 1 + progress * 0.012,
    "--draw-y": `${motion.draw}px`,
    "--pull-y": `${motion.pull}px`,
    "--draw-scale": 0.96 + drawProgress * 0.12,
    "--draw-rotate": `${-drawProgress * 2.5}deg`,
    "--pack-offset": `${drawProgress * packDrawOffset}px`,
    "--peek-distance": `${Math.min(24, packHeight * 0.04)}px`,
    "--reveal-x": `${motion.reveal}px`,
    "--reveal-rotate": `${(motion.reveal / revealDistance) * 12}deg`
  } as CSSProperties;
  const card = artwork?.image ? (
    <BoosterCardViewer artwork={artwork} interactive={stage === "results"} />
  ) : (
    <div className="yunipals-opening-card-back" role="status">
      <span className="display text-2xl">YUNIPALS</span>
      <p className="mt-3 text-sm">
        {demo
          ? "Sample card preview"
          : "Your Yunipal is revealed. Its artwork is being prepared."}
      </p>
      {(monster.error || artworkQuery.error) && (
        <button
          type="button"
          className="mt-4 underline"
          disabled={stage !== "revealing" && stage !== "results"}
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

  return createPortal(
    <dialog
      ref={dialog}
      aria-label="Yunipals pack opening"
      aria-describedby={descriptionId}
      className="yunipals-opening-dialog"
      data-stage={stage}
      data-dragging={dragging}
      data-settling={settling}
      data-reduced-motion={reduced}
      style={style}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <div className="yunipals-opening-content">
        <button
          type="button"
          aria-label="Close pack opening"
          onClick={props.onClose}
          className="yunipals-opening-close"
        >
          <X aria-hidden="true" size={22} />
        </button>
        <p className="display text-center text-3xl sm:text-4xl">
          {stage === "results"
            ? demo
              ? "A little preview of the magic."
              : "Meet your Yunipal."
            : "A little magic inside."}
        </p>
        <p
          id={descriptionId}
          className="mt-3 max-w-md text-center text-sm text-white/75"
        >
          {demo
            ? "Demo preview — no NFT is minted."
            : "Your NFT is already revealed on Base. This opening replays its reveal."}
        </p>
        {totalCards > 1 && (
          <p
            className="mt-2 text-sm font-semibold text-white/80"
            aria-live="polite"
          >
            Card {cardIndex + 1} of {totalCards}
          </p>
        )}
        {stage === "results" ? (
          <div className="yunipals-opening-result">
            {card}
            {artwork?.name && (
              <h2 className="display mt-5 text-center text-2xl">
                {artwork.name}
              </h2>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                data-stage-action="results"
                onClick={hasMoreCards ? nextCard : replay}
                className="yunipals-opening-action"
              >
                {hasMoreCards ? "Pull next card" : "Replay opening"}
              </button>
              {!demo && (
                <Link
                  className="yunipals-opening-action"
                  onClick={props.onClose}
                  to={`/monsters/${activeCard.collection}/${activeCard.tokenId}`}
                >
                  View Yunipal #{activeCard.tokenId}
                </Link>
              )}
              {!hasMoreCards && (
                <Link
                  className="yunipals-opening-action"
                  onClick={props.onClose}
                  to="/collection"
                >
                  View collection
                </Link>
              )}
              <button
                type="button"
                onClick={props.onClose}
                className="yunipals-opening-action"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <p
              className="my-5 text-center text-sm font-semibold text-white/80"
              aria-live="polite"
            >
              {stage === "sealed"
                ? "Swipe right along the glowing seal."
                : stage === "opening"
                  ? "Open a little wonder…"
                  : stage === "extracting"
                    ? "Pull the card up, or pull the wrapper down."
                    : "Swipe the card aside to reveal it."}
            </p>
            <div ref={shell} className="yunipals-opening-shell">
              {(stage === "opening" || stage === "extracting") && (
                <div
                  className="yunipals-opening-extract-window"
                  aria-hidden="true"
                >
                  <div className="yunipals-opening-extract-card">
                    <div className="yunipals-opening-card-peek">{card}</div>
                  </div>
                </div>
              )}
              {stage === "revealing" && (
                <div className="yunipals-opening-reveal-card">
                  {card}
                  <button
                    type="button"
                    aria-label="Reveal card"
                    data-stage-action="revealing"
                    disabled={settling}
                    className="yunipals-opening-reveal-hit"
                    {...control("reveal")}
                  />
                </div>
              )}
              <div className="yunipals-opening-wrapper">
                <img
                  src={packImage}
                  alt="Yunipals foil booster pack"
                  draggable={false}
                  className="yunipals-opening-body"
                />
                {stage === "sealed" && (
                  <>
                    <div className="yunipals-opening-attached">
                      <img src={packImage} alt="" draggable={false} />
                    </div>
                    <div className="yunipals-opening-curl">
                      <img src={packImage} alt="" draggable={false} />
                      <div className="yunipals-opening-curl-highlight" />
                    </div>
                    <div className="yunipals-opening-foil" />
                    <div className="yunipals-opening-glint" />
                    <div className="yunipals-opening-seam" />
                    <div className="yunipals-opening-seam-progress" />
                    <span className="yunipals-opening-tab">
                      <ChevronRight
                        aria-hidden="true"
                        size={16}
                        strokeWidth={3.2}
                      />
                    </span>
                    <button
                      type="button"
                      aria-label="Rip pack seal"
                      data-stage-action="sealed"
                      className="yunipals-opening-rip-hit"
                      {...control("swipe")}
                    />
                  </>
                )}
                {stage === "opening" && (
                  <>
                    <img
                      src={packImage}
                      alt=""
                      draggable={false}
                      className="yunipals-opening-torn-top"
                    />
                    {!reduced &&
                      PARTICLES.map((particle, index) => (
                        <span
                          key={index}
                          className="yunipals-opening-particle"
                          style={
                            {
                              "--particle-x": `${particle.x}px`,
                              "--particle-y": `${particle.y}px`,
                              "--particle-rotate": `${particle.rotate}deg`,
                              animationDelay: `${0.18 + particle.delay}s`,
                              backgroundColor: particle.color
                            } as CSSProperties
                          }
                        />
                      ))}
                  </>
                )}
              </div>
              {stage === "extracting" && (
                <div className="yunipals-opening-extract-controls">
                  <button
                    type="button"
                    aria-label="Pull card upward"
                    data-stage-action="extracting"
                    disabled={settling}
                    className="yunipals-opening-card-hit"
                    {...control("draw")}
                  />
                  <button
                    type="button"
                    aria-label="Pull pack downward"
                    disabled={settling}
                    className="yunipals-opening-pack-hit"
                    {...control("pull")}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              className="yunipals-opening-action mt-6"
              disabled={settling || stage === "opening"}
              onClick={() =>
                finish(
                  stage === "sealed"
                    ? "swipe"
                    : stage === "extracting"
                      ? "draw"
                      : "reveal"
                )
              }
            >
              {stage === "sealed"
                ? "Rip open"
                : stage === "extracting"
                  ? "Pull out card"
                  : stage === "revealing"
                    ? "Reveal Yunipal"
                    : "Opening…"}
            </button>
          </>
        )}
      </div>
    </dialog>,
    document.body
  );
}
