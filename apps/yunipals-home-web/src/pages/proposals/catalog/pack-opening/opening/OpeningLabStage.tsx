import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal, flushSync } from "react-dom";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";

import { BoosterCardViewer } from "@/components/BoosterCardViewer";
import type { MonsterArtwork } from "@/lib/boosters";
import { createScene, isAbort, type Phase, type Scene } from "./scene";
import { revealNextCard, type OpeningVariant } from "./variants";
import "./opening-lab.css";

const PACK_IMAGE = "/images/boosters/yunipals-pack-v1.png";

export type OpeningLabStageProps = {
  variant: OpeningVariant;
  index: number;
  total: number;
  cards: readonly MonsterArtwork[];
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function OpeningLabStage(props: OpeningLabStageProps) {
  const { variant, onPrevious, onNext, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [run, setRun] = useState(0);
  const replay = useCallback(() => setRun((value) => value + 1), []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  // Listen on the window: focus briefly leaves the dialog while a style
  // remounts, and the shortcuts must keep working through that gap.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // The card viewer uses the arrow keys itself to tilt the card.
      if (
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest(".tilt-viewer"))
      )
        return;
      if (event.key === "ArrowLeft") onPrevious();
      else if (event.key === "ArrowRight") onNext();
      else if (event.key.toLowerCase() === "r") replay();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onPrevious, onNext, replay]);

  return createPortal(
    <dialog
      ref={dialog}
      className="olab-dialog"
      aria-label={`Pack opening preview: ${variant.name}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <StageRun key={`${variant.id}:${run}`} {...props} onReplay={replay} />
    </dialog>,
    document.body
  );
}

function StageRun({
  variant,
  index,
  total,
  cards,
  onPrevious,
  onNext,
  onClose,
  onReplay
}: OpeningLabStageProps & { onReplay: () => void }) {
  const [phase, setPhase] = useState<Phase>("opening");
  const [hint, setHint] = useState("");
  const [cardIndex, setCardIndex] = useState(0);
  const scene = useRef<Scene | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const pack = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const flip = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const sheen = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bgCanvas = useRef<HTMLCanvasElement>(null);
  const fxCanvas = useRef<HTMLCanvasElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const cardCount = Math.max(1, cards.length);
  const artwork = cards[cardIndex];
  const artworkRef = useRef(artwork);
  artworkRef.current = artwork;
  const hasMore = cardIndex + 1 < cardCount;

  useEffect(() => {
    const created = createScene(
      {
        stage: stage.current!,
        world: world.current!,
        pack: pack.current!,
        card: card.current!,
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
        packImage: PACK_IMAGE,
        setHint,
        setPhase,
        advanceCard: () => flushSync(() => setCardIndex((value) => value + 1)),
        artwork: () => artworkRef.current
      }
    );
    scene.current = created.scene;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const play = reduced
      ? async (s: Scene) => {
          await s.tap("Tap the pack to open it");
          s.set(s.pack, { opacity: 0 });
          s.set(s.card, { opacity: 1 });
          s.reveal();
        }
      : (s: Scene) => variant.run(s);
    play(created.scene).catch((error: unknown) => {
      if (!isAbort(error)) console.error(error);
    });
    return () => {
      scene.current = null;
      created.destroy();
    };
  }, [variant]);

  useEffect(() => {
    if (phase === "sealed") trigger.current?.focus({ preventScroll: true });
  }, [phase]);

  const nextCard = () => {
    if (!scene.current || !hasMore) return;
    // Reduced motion: swap the card in place, with no slide, flip or flash.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      scene.current.advanceCard();
      scene.current.reveal();
      return;
    }
    revealNextCard(scene.current, variant).catch((error: unknown) => {
      if (!isAbort(error)) console.error(error);
    });
  };

  return (
    <div
      ref={stage}
      className="olab-stage"
      data-variant={variant.id}
      data-phase={phase}
      data-theme={variant.theme ?? "dark"}
      style={
        {
          "--olab-bg": variant.background,
          "--olab-accent": variant.palette[0],
          "--olab-accent-2": variant.palette[1],
          "--olab-pack": `url("${PACK_IMAGE}")`
        } as CSSProperties
      }
    >
      <canvas ref={bgCanvas} className="olab-canvas olab-bg" />
      <div ref={world} className="olab-world">
        <div ref={pack} className="olab-pack">
          <div className="olab-pack-art" />
        </div>
        <div ref={card} className="olab-card">
          <div ref={flip} className="olab-card-flip">
            <div ref={front} className="olab-card-front">
              {artwork?.image ? (
                <BoosterCardViewer
                  artwork={artwork}
                  interactive={phase === "revealed"}
                />
              ) : (
                <CardBack label="Sample card" />
              )}
            </div>
            <div ref={back} className="olab-card-back-face" aria-hidden="true">
              <CardBack />
            </div>
            <div ref={sheen} className="olab-sheen" aria-hidden="true" />
          </div>
        </div>
        <div ref={layer} className="olab-layer" aria-hidden="true" />
      </div>
      <canvas ref={glCanvas} className="olab-canvas olab-gl" />
      <canvas ref={fxCanvas} className="olab-canvas olab-fx" />
      <div ref={flash} className="olab-flash" aria-hidden="true" />
      <button
        ref={trigger}
        type="button"
        className="olab-trigger"
        aria-label={hint || "Open the pack"}
        disabled={phase !== "sealed"}
      />

      <header className="olab-top">
        <button
          type="button"
          className="olab-icon"
          aria-label="Previous opening style"
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden="true" size={22} />
        </button>
        <div className="olab-title">
          <p className="olab-count">
            {String(index + 1).padStart(2, "0")} / {total}
          </p>
          <h1 className="display">{variant.name}</h1>
          <p className="olab-tagline">{variant.tagline}</p>
        </div>
        <button
          type="button"
          className="olab-icon"
          aria-label="Next opening style"
          onClick={onNext}
        >
          <ChevronRight aria-hidden="true" size={22} />
        </button>
        <button
          type="button"
          className="olab-icon olab-close"
          aria-label="Back to all opening styles"
          onClick={onClose}
        >
          <X aria-hidden="true" size={22} />
        </button>
      </header>

      <footer className="olab-bottom">
        <p className="olab-hint" aria-live="polite">
          {phase === "sealed" || phase === "interactive"
            ? hint
            : phase === "revealed"
              ? `${artwork?.name ?? "Sample card"} · Card ${cardIndex + 1} of ${cardCount}`
              : ""}
        </p>
        <div className="olab-actions" data-visible={phase === "revealed"}>
          {hasMore && (
            <button
              type="button"
              className="olab-action is-primary"
              disabled={phase !== "revealed"}
              onClick={nextCard}
            >
              Next card
            </button>
          )}
          <button
            type="button"
            className="olab-action"
            disabled={phase !== "revealed"}
            onClick={onReplay}
          >
            <RotateCcw aria-hidden="true" size={16} />
            Replay
          </button>
          <button
            type="button"
            className="olab-action"
            disabled={phase !== "revealed"}
            onClick={onNext}
          >
            Next style
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}

function CardBack({ label }: { label?: string }) {
  return (
    <div className="olab-card-back">
      <img src="/images/yunipals-logo.webp" alt="" width={96} height={96} />
      <span className="display">{label ?? "Yunipals"}</span>
    </div>
  );
}
