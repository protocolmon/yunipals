import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MonsterArtwork } from "@/lib/boosters";

type Driver = { reset: () => void };
export function BoosterCardViewer({
  artwork,
  interactive = true,
  onExpand,
  variant = "default"
}: {
  artwork: MonsterArtwork;
  interactive?: boolean;
  onExpand?: () => void;
  variant?: "default" | "expanded";
}) {
  const viewerRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef({ x: 0, y: 0, dragged: false });
  const driverRef = useRef<Driver | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const holo = Boolean(artwork.holo && artwork.attributes.glitter === "Yes");
  useEffect(() => {
    setImageFailed(false);
  }, [artwork.image]);
  useEffect(() => {
    const viewer = viewerRef.current,
      card = cardRef.current;
    if (!viewer || !card || !interactive || imageFailed) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let x = 0,
      y = 0,
      frame = 0,
      demo = 0,
      resume = 0,
      inactive = false,
      pointer: number | null = null;
    let light: { x: number; y: number } | null = null;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const render = () => {
      frame = 0;
      const values: Record<string, string> = {
        "--rotate-x": `${-y * 16}deg`,
        "--rotate-y": `${x * 16}deg`,
        "--mx": `${50 + x * 50}%`,
        "--my": `${50 + y * 50}%`,
        "--shift": `${x * 60}deg`,
        "--gx": `${x * 50}%`,
        "--gy": `${y * 50}%`,
        "--light-x": `${50 + x * 36}%`,
        "--light-y": `${50 + y * 36}%`,
        "--foil-x": `${50 + x * 45}%`,
        "--foil-y": `${50 + y * 45}%`,
        "--foil-angle": `${115 + x * 22 - y * 12}deg`,
        "--sweep-x": `${-65 + (x + y + 2) * 32.5}%`,
        "--sweep-y": `${-35 + (y + 1) * 35}%`,
        "--tilt-energy": String(Math.min(1, Math.hypot(x, y))),
        "--star-sweep": `${50 + x * 65 + y * 35}%`,
        "--relief-x": `${-x * 1.5}px`,
        "--relief-y": `${2.5 - y * 1.5}px`
      };
      let sx = 0.5 + x * 0.5,
        sy = 0.5 + y * 0.5;
      if (light) {
        const r = viewer.getBoundingClientRect();
        const px = light.x - r.left - r.width / 2,
          py = light.y - r.top - r.height / 2;
        const matrix = new DOMMatrix()
          .rotateAxisAngle(0, 1, 0, x * 16)
          .rotateAxisAngle(1, 0, 0, -y * 16);
        const perspective = 1200;
        const distance =
          (perspective * matrix.m33) /
          (perspective * matrix.m33 - matrix.m31 * px - matrix.m32 * py);
        const local = matrix
          .inverse()
          .transformPoint(
            new DOMPoint(
              distance * px,
              distance * py,
              perspective * (1 - distance)
            )
          );
        sx = local.x / card.offsetWidth + 0.5;
        sy = local.y / card.offsetHeight + 0.5;
      }
      values["--spot-x"] = `${Math.max(0, Math.min(1, sx)) * 100}%`;
      values["--spot-y"] = `${Math.max(0, Math.min(1, sy)) * 100}%`;
      for (const [key, value] of Object.entries(values))
        card.style.setProperty(key, value);
    };
    const stop = () => {
      cancelAnimationFrame(demo);
      clearTimeout(resume);
      demo = 0;
      resume = 0;
    };
    const tilt = (nx: number, ny: number) => {
      if (media.matches) return;
      x = clamp(nx);
      y = clamp(ny);
      viewer.classList.add("has-reflection");
      if (!frame) frame = requestAnimationFrame(render);
    };
    const reset = () => {
      stop();
      if (pointer !== null && viewer.hasPointerCapture(pointer))
        viewer.releasePointerCapture(pointer);
      pointer = null;
      light = null;
      x = 0;
      y = 0;
      viewer.classList.remove("has-reflection", "has-hotspot", "is-tracking");
      render();
    };
    const move = (event: PointerEvent) => {
      if (
        media.matches ||
        !event.isPrimary ||
        (event.pointerType !== "mouse" && pointer !== event.pointerId)
      )
        return;
      stop();
      light = { x: event.clientX, y: event.clientY };
      viewer.classList.add("has-hotspot");
      const r = card.getBoundingClientRect();
      tilt(
        ((event.clientX - r.left) / r.width) * 2 - 1,
        ((event.clientY - r.top) / r.height) * 2 - 1
      );
      if (pointer === null) resumeAuto();
    };
    const down = (event: PointerEvent) => {
      if (media.matches || !event.isPrimary || event.button !== 0) return;
      pointer = event.pointerId;
      viewer.setPointerCapture(pointer);
      viewer.classList.add("is-tracking");
      viewer.focus({ preventScroll: true });
      move(event);
    };
    const up = (event: PointerEvent) => {
      if (pointer === event.pointerId) {
        if (viewer.hasPointerCapture(pointer))
          viewer.releasePointerCapture(pointer);
        pointer = null;
        viewer.classList.remove("is-tracking");
        resumeAuto();
      }
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && pointer === null) {
        light = null;
        viewer.classList.remove("has-hotspot");
        startAuto();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(
          event.key
        ) ||
        media.matches
      )
        return;
      event.preventDefault();
      stop();
      light = null;
      if (event.key === "Home") reset();
      else {
        viewer.classList.add("has-hotspot");
        tilt(
          x +
            (event.key === "ArrowRight"
              ? 0.15
              : event.key === "ArrowLeft"
                ? -0.15
                : 0),
          y +
            (event.key === "ArrowDown"
              ? 0.15
              : event.key === "ArrowUp"
                ? -0.15
                : 0)
        );
      }
      resumeAuto();
    };
    const preference = () => {
      if (media.matches) reset();
      else startAuto();
    };
    const visibility = () => {
      if (document.hidden) stop();
      else startAuto();
    };
    const blur = () => {
      inactive = true;
      reset();
    };
    const focus = () => {
      inactive = false;
      startAuto();
    };
    const cancel = () => {
      reset();
      startAuto();
    };
    const demoTick = (time: number) => {
      // Stop immediately even if a browser delays the media-query change event.
      if (media.matches) {
        preference();
        return;
      }
      light = null;
      viewer.classList.add("has-hotspot");
      tilt(Math.sin(time / 1800) * 0.6, Math.cos(time / 2300) * 0.4);
      demo = requestAnimationFrame(demoTick);
    };
    const startAuto = () => {
      stop();
      if (!media.matches && !document.hidden && !inactive && pointer === null)
        demo = requestAnimationFrame(demoTick);
    };
    const resumeAuto = () => {
      clearTimeout(resume);
      resume = window.setTimeout(startAuto, 1500);
    };
    driverRef.current = {
      reset: () => {
        reset();
        resumeAuto();
      }
    };
    preference();
    render();
    viewer.addEventListener("pointerdown", down);
    viewer.addEventListener("pointermove", move);
    viewer.addEventListener("pointerup", up);
    viewer.addEventListener("pointercancel", cancel);
    viewer.addEventListener("pointerleave", leave);
    viewer.addEventListener("keydown", key);
    media.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      cancelAnimationFrame(frame);
      stop();
      driverRef.current = null;
      viewer.removeEventListener("pointerdown", down);
      viewer.removeEventListener("pointermove", move);
      viewer.removeEventListener("pointerup", up);
      viewer.removeEventListener("pointercancel", cancel);
      viewer.removeEventListener("pointerleave", leave);
      viewer.removeEventListener("keydown", key);
      media.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, [artwork.image, interactive, imageFailed]);
  if (!artwork.image || imageFailed)
    return (
      <p
        role="status"
        className="rounded-card bg-lavender/20 p-8 text-center text-muted"
      >
        The card image could not be loaded.{" "}
        {interactive && (
          <button
            type="button"
            className="underline"
            onClick={() => setImageFailed(false)}
          >
            Try again
          </button>
        )}
      </p>
    );
  const url = (value: string) => `url(${JSON.stringify(value)})`;
  const style = {
    "--art-mask": url(artwork.image),
    "--monster-mask": artwork.holo ? url(artwork.holo.foreground) : "none",
    "--background-mask": artwork.holo ? url(artwork.holo.background) : "none",
    "--star-mask": artwork.holo ? url(artwork.holo.stars) : "none"
  } as CSSProperties;
  const Viewport = onExpand ? "button" : "div";
  return (
    <div
      className={cn(
        "booster-card-viewer",
        !interactive && "is-static",
        variant === "expanded" && "is-expanded"
      )}
    >
      <Viewport
        ref={(element: HTMLDivElement | HTMLButtonElement | null) => {
          viewerRef.current = element;
        }}
        type={onExpand ? "button" : undefined}
        className={cn(
          "tilt-viewer relative w-full rounded-card bg-lavender/20",
          onExpand && "can-expand",
          holo && "is-holo"
        )}
        data-live-holo="true"
        data-foil-style="prism"
        role={!onExpand && interactive ? "group" : undefined}
        aria-label={
          onExpand
            ? `View ${artwork.name ?? "Yunipal card"} larger`
            : interactive
              ? "Interactive Yunipal card"
              : undefined
        }
        aria-haspopup={onExpand ? "dialog" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onPointerDownCapture={(event) => {
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            dragged: false
          };
        }}
        onPointerMoveCapture={(event) => {
          if (
            event.buttons &&
            Math.hypot(
              event.clientX - gesture.current.x,
              event.clientY - gesture.current.y
            ) > 8
          )
            gesture.current.dragged = true;
        }}
        onClick={
          onExpand
            ? (event) => {
                if (event.detail === 0 || !gesture.current.dragged) {
                  driverRef.current?.reset();
                  onExpand();
                }
              }
            : undefined
        }
      >
        <span
          ref={cardRef}
          style={style}
          className={cn("tilt-card", holo && "has-monster-depth")}
        >
          <img
            src={artwork.image}
            alt={artwork.name ?? "Yunipal card"}
            draggable={false}
            loading={interactive ? "eager" : "lazy"}
            onError={() => setImageFailed(true)}
          />
          {interactive && (
            <>
              <span className="tilt-foil" aria-hidden="true" />
              <span className="tilt-sweep" aria-hidden="true" />
              <span className="tilt-diagonal" aria-hidden="true" />
              <span className="tilt-glare" aria-hidden="true" />
              {holo && (
                <>
                  <span className="tilt-hotspot" aria-hidden="true">
                    <span className="hotspot-spectrum" />
                    <span className="hotspot-grain" />
                    <span className="hotspot-glint" />
                  </span>
                  <span className="tilt-art-stars" aria-hidden="true">
                    <img
                      className="art-star-light"
                      src={artwork.image}
                      alt=""
                    />
                  </span>
                  <span className="monster-depth" aria-hidden="true">
                    <span className="monster-relief">
                      <img
                        className="monster-print"
                        src={artwork.image}
                        alt=""
                      />
                    </span>
                  </span>
                </>
              )}
            </>
          )}
        </span>
        {onExpand && (
          <span className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-grape shadow-sm">
            <Expand size={18} aria-hidden="true" />
          </span>
        )}
      </Viewport>
    </div>
  );
}
