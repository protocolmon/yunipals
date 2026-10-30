import { useEffect, useRef, useState } from "react";
import type { AnimeKit } from "@protopals/yunipals-market-core/anime";

export function AnimeKitPreview({
  kit,
  assetsOrigin
}: {
  kit: AnimeKit;
  assetsOrigin: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext("2d");
    if (!node || !ctx) return;
    let cancelled = false,
      frame = 0,
      visible = true,
      loaded = false;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sheets = [kit.projectile ?? kit.strike, kit.impact].filter(
      (s) => !!s
    );
    setUnavailable(false);
    const images = sheets.map((sheet) => {
      const img = new Image();
      img.src = `${assetsOrigin.replace(/\/$/, "")}/${sheet.sheet}`;
      return img;
    });
    const draw = (time: number) => {
      if (cancelled || !loaded) return;
      if (visible) {
        ctx.clearRect(0, 0, node.width, node.height);
        const index = motion.matches
          ? 0
          : Math.floor(time / 1200) % sheets.length;
        const sheet = sheets[index]!,
          img = images[index]!;
        const cell = motion.matches
          ? 0
          : Math.floor((time / 1000) * 14) % (sheet.cols * sheet.rows);
        const w = img.naturalWidth / sheet.cols,
          h = img.naturalHeight / sheet.rows;
        const scale = Math.min(120 / w, 80 / h);
        ctx.globalCompositeOperation =
          sheet.blend === "add" ? "lighter" : "source-over";
        ctx.drawImage(
          img,
          (cell % sheet.cols) * w,
          Math.floor(cell / sheet.cols) * h,
          w,
          h,
          (node.width - w * scale) / 2,
          (node.height - h * scale) / 2,
          w * scale,
          h * scale
        );
      }
      if (!motion.matches) frame = requestAnimationFrame(draw);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible && motion.matches) draw(performance.now());
    });
    observer.observe(node);
    const restart = () => {
      cancelAnimationFrame(frame);
      draw(performance.now());
    };
    motion.addEventListener("change", restart);
    void Promise.all(images.map((img) => img.decode()))
      .then(() => {
        loaded = true;
        if (!cancelled) restart();
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", restart);
    };
  }, [kit, assetsOrigin]);
  return unavailable ? (
    <p className="text-xs text-muted">Preview unavailable</p>
  ) : (
    <canvas
      ref={canvas}
      width={128}
      height={88}
      role="img"
      aria-label={`${kit.name} effect preview`}
      className="mx-auto rounded-xl bg-ink"
    />
  );
}
