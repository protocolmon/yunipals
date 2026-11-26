import { burst, emitter, pick, rand, ring } from "./fx";
import type { Scene } from "./scene";

export type OpeningVariant = {
  id: string;
  name: string;
  tagline: string;
  /** Three accent colours: primary, secondary, highlight. */
  palette: readonly [string, string, string];
  background: string;
  /** Light stages switch the overlay text to dark ink. */
  theme?: "light";
  run: (scene: Scene) => Promise<void>;
};

const SOFT = "cubic-bezier(.3,0,.2,1)";
const POP = "cubic-bezier(.2,1.5,.4,1)";
const FALL = "cubic-bezier(.6,0,.9,.4)";

export async function enter(s: Scene) {
  await s.anim(
    s.pack,
    [
      { opacity: 0, transform: "translateY(70px) scale(.78) rotate(-7deg)" },
      { opacity: 1, transform: "none" }
    ],
    { duration: 750, easing: POP }
  );
}

/** Card pops from behind the pack position to its final pose. */
export async function present(s: Scene, from = "scale(.84)") {
  s.card.style.zIndex = "5";
  await s.anim(
    s.card,
    [
      { opacity: 1, transform: from },
      { opacity: 1, transform: "scale(1.07)", offset: 0.6 },
      { opacity: 1, transform: "none" }
    ],
    { duration: 620, easing: SOFT }
  );
  s.runSheen();
}

/** Gentle sparkles around the revealed card. */
export function idle(
  s: Scene,
  colors: readonly string[],
  kind: "star" | "glow" = "star"
) {
  emitter(s.fx, 9, () => {
    const g = s.geo();
    const side = Math.random() < 0.5 ? -1 : 1;
    return {
      kind,
      x: g.cx + side * (g.cw / 2 + rand(-10, 46)),
      y: g.cy + rand(-g.ch / 2, g.ch / 2),
      vx: side * rand(4, 26),
      vy: rand(-46, -12),
      life: rand(0.9, 1.8),
      size: rand(3, kind === "star" ? 9 : 7),
      color: pick(colors),
      drag: 0.99
    };
  });
}

/** Shared reveal for the second and later cards, tinted per variant. */
export async function revealNextCard(s: Scene, variant: OpeningVariant) {
  const g = s.geo();
  s.setPhase("opening");
  await s.anim(
    s.card,
    [
      { opacity: 1, transform: "none" },
      {
        opacity: 0,
        transform: `translateX(${-g.sw * 0.6}px) rotate(-20deg) scale(.9)`
      }
    ],
    { duration: 420, easing: FALL }
  );
  s.advanceCard();
  s.showBack();
  await s.anim(
    s.card,
    [
      { opacity: 1, transform: `translateY(${g.sh * 0.6}px) scale(.8)` },
      { opacity: 1, transform: "none" }
    ],
    { duration: 620 }
  );
  void s.wait(330).then(
    () => {
      ring(s.fx, g.cx, g.cy, { to: g.w * 1.5, color: variant.palette[0] });
      burst(s.fx, g.cx, g.cy, 70, {
        colors: variant.palette,
        speed: [200, 760],
        size: [2, 5]
      });
      s.flashScreen(variant.palette[2], 320, 0.25);
    },
    () => undefined
  );
  await s.flipCard(680);
  s.runSheen();
  s.reveal();
}
