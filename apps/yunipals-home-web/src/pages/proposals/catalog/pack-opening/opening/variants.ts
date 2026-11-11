import {
  TAU,
  bolt,
  burst,
  clamp01,
  easeOut,
  emitter,
  pick,
  rand,
  rays,
  ring
} from "./fx";
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

/* 1 ─ Holo Rip ───────────────────────────────────────────────────────── */
const holoRip: OpeningVariant = {
  id: "holo-rip",
  name: "Holo Rip",
  tagline:
    "A glowing tear across the foil, the card rises out in a prism of light.",
  palette: ["#a78bfa", "#22d3ee", "#f9a8d4"],
  background:
    "radial-gradient(ellipse at 50% 42%, #3b2a7a 0%, #17112f 55%, #07060f 100%)",
  async run(s) {
    const colors = ["#ffffff", ...this.palette, "#fde68a"];
    await enter(s);
    await s.tap("Tap the pack to rip it open");
    const g = s.geo();
    const seam = g.y + g.h * 0.105;
    s.hidePack();
    const top = s.piece("inset(0 0 89.5% 0)");
    const body = s.piece("inset(10.5% 0 0 0)");
    s.set(s.card, { opacity: 1, transform: "scale(.86)" });
    top.style.transformOrigin = "100% 10%";
    void s.anim(
      top,
      [
        { clipPath: "inset(0 0 89.5% 0)" },
        { clipPath: "inset(0 0 89.5% 96%)" }
      ],
      { duration: 520, easing: "linear" }
    );
    await s.tween(520, (progress) => {
      const x = g.x + g.w * (0.03 + 0.94 * progress);
      for (let index = 0; index < 5; index++)
        s.fx.emit({
          kind: "spark",
          x,
          y: seam + rand(-3, 3),
          vx: rand(-260, 120),
          vy: rand(-340, 220),
          life: rand(0.25, 0.6),
          size: rand(1.5, 4),
          color: pick(colors),
          gravity: 600
        });
      s.fx.emit({
        x,
        y: seam,
        size: 34,
        life: 0.12,
        color: "#c4b5fd",
        shrink: false
      });
    });
    s.shake(7, 260);
    s.flashScreen("#ffffff", 300, 0.45);
    const light = rays(s.bg, g.cx, seam + 10, {
      color: "#c4b5fd",
      length: g.h * 1.5,
      strength: 0.7
    });
    burst(s.fx, g.cx, seam, 90, {
      colors,
      speed: [240, 900],
      angle: -Math.PI / 2,
      spread: Math.PI * 0.9,
      gravity: 500,
      scatter: g.w * 0.35
    });
    await s.wait(180);
    void s.anim(
      s.card,
      [
        { transform: "scale(.86)" },
        { transform: `translateY(${-g.h * 0.66}px) scale(.86)` }
      ],
      { duration: 900, easing: SOFT }
    );
    await s.wait(620);
    void s.anim(
      body,
      [
        { transform: "none" },
        { transform: `translateY(${g.sh}px) rotate(9deg)` }
      ],
      { duration: 760, easing: FALL }
    );
    await s.wait(300);
    light.fade(1.2);
    ring(s.fx, g.cx, g.cy, { to: g.w * 1.7, color: "#22d3ee" });
    burst(s.fx, g.cx, g.cy, 60, {
      kind: "star",
      colors,
      speed: [120, 560],
      size: [4, 10],
      life: [0.7, 1.4],
      spin: 4
    });
    await present(s, `translateY(${-g.h * 0.66}px) scale(.86)`);
    s.reveal();
    idle(s, colors);
  }
};

/* 2 ─ Supernova ──────────────────────────────────────────────────────── */
const supernova: OpeningVariant = {
  id: "supernova",
  name: "Supernova",
  tagline:
    "The pack overloads with energy and detonates into a blinding starburst.",
  palette: ["#fbbf24", "#fb7185", "#fff7d6"],
  background:
    "radial-gradient(ellipse at 50% 45%, #4a1d0f 0%, #1c0a12 55%, #050308 100%)",
  async run(s) {
    const colors = ["#ffffff", "#fde68a", "#fbbf24", "#fb7185"];
    await enter(s);
    await s.tap("Tap to overload the pack");
    const g = s.geo();
    emitter(
      s.fx,
      110,
      () => {
        const angle = rand(0, TAU);
        const radius = rand(g.w * 1.1, g.w * 2);
        const speed = radius / 0.5;
        return {
          kind: "spark",
          x: g.cx + Math.cos(angle) * radius,
          y: g.cy + Math.sin(angle) * radius,
          vx: -Math.cos(angle) * speed,
          vy: -Math.sin(angle) * speed,
          life: 0.5,
          size: rand(2, 5),
          color: pick(colors),
          drag: 1
        };
      },
      1.35
    );
    void s.anim(
      s.pack,
      [
        { transform: "scale(1)", filter: "brightness(1)" },
        {
          transform: "scale(.9)",
          filter: "brightness(1.7) saturate(1.5)",
          offset: 0.72
        },
        { transform: "scale(1.14)", filter: "brightness(7) saturate(0)" }
      ],
      { duration: 1450, easing: "ease-in" }
    );
    for (let step = 0; step < 7; step++) {
      s.shake(2 + step * 2.4, 200);
      if (step > 1)
        bolt(
          s.fx,
          [g.x + rand(0, g.w), g.y + rand(0, g.h)],
          [g.x + rand(0, g.w), g.y + rand(0, g.h)],
          { color: "#fbbf24", duration: 0.22 }
        );
      await s.wait(205);
    }
    s.set(s.pack, { opacity: 0 });
    s.flashScreen("#ffffff", 900, 1);
    s.shake(24, 560);
    rays(s.bg, g.cx, g.cy, {
      color: "#fbbf24",
      length: Math.hypot(g.sw, g.sh) * 0.62,
      count: 18,
      strength: 0.42,
      spin: 0.12
    });
    [0, 120, 260].forEach((delay, index) =>
      setTimeout(
        () =>
          ring(s.fx, g.cx, g.cy, {
            to: g.w * (2.6 - index * 0.5),
            color: colors[index + 1],
            duration: 1,
            width: 12
          }),
        delay
      )
    );
    burst(s.fx, g.cx, g.cy, 190, {
      colors,
      speed: [260, 1500],
      size: [2, 6],
      life: [0.6, 1.5],
      drag: 0.94
    });
    burst(s.fx, g.cx, g.cy, 50, {
      kind: "glow",
      colors,
      speed: [60, 520],
      size: [10, 26],
      life: [0.8, 1.6]
    });
    s.card.style.zIndex = "5";
    await s.anim(
      s.card,
      [
        { opacity: 0, transform: "scale(.08) rotate(-28deg)" },
        { opacity: 1, transform: "scale(1.13) rotate(3deg)", offset: 0.68 },
        { opacity: 1, transform: "none" }
      ],
      { duration: 950, delay: 160, easing: SOFT }
    );
    s.runSheen();
    s.reveal();
    idle(s, colors);
  }
};

/* 3 ─ Blade Slice ────────────────────────────────────────────────────── */
const bladeSlice: OpeningVariant = {
  id: "blade-slice",
  name: "Blade Slice",
  tagline:
    "One clean diagonal cut. The halves slide apart and the card steps through.",
  palette: ["#f43f5e", "#e2e8f0", "#fecdd3"],
  background:
    "radial-gradient(ellipse at 50% 45%, #2a1220 0%, #120a12 55%, #040305 100%)",
  async run(s) {
    const colors = ["#ffffff", "#fecdd3", "#f43f5e", "#fda4af"];
    await enter(s);
    await s.tap("Tap to slice the pack");
    const g = s.geo();
    s.set(s.card, { opacity: 1, transform: "scale(.84)" });
    void s.anim(
      s.pack,
      [{ transform: "none" }, { transform: "scale(.96)" }],
      140
    );
    await s.wait(140);
    // The cut runs from 22% down the right edge to 62% down the left edge.
    const start = [g.x + g.w * 1.4, g.y + g.h * 0.06] as const;
    const finish = [g.x - g.w * 0.4, g.y + g.h * 0.78] as const;
    s.fx.add((ctx, time) => {
      if (time > 0.75) return false;
      const head = clamp01(time / 0.11);
      const tail = clamp01((time - 0.16) / 0.5);
      const point = (amount: number) =>
        [
          start[0] + (finish[0] - start[0]) * amount,
          start[1] + (finish[1] - start[1]) * amount
        ] as const;
      const from = point(tail);
      const to = point(head);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
      ctx.strokeStyle = "#f43f5e";
      ctx.globalAlpha = 0.5 * (1 - tail);
      ctx.lineWidth = 22;
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = 1 - tail;
      ctx.lineWidth = 5;
      ctx.stroke();
    });
    await s.wait(110);
    s.flashScreen("#ffffff", 200, 0.9);
    s.shake(15, 280);
    s.hidePack();
    const upper = s.piece("polygon(0 0, 100% 0, 100% 22%, 0 62%)");
    const lower = s.piece("polygon(0 62%, 100% 22%, 100% 100%, 0 100%)");
    for (let index = 0; index < 90; index++) {
      const amount = Math.random();
      const side = Math.random() < 0.5 ? -1 : 1;
      s.fx.emit({
        kind: "spark",
        x: g.x + g.w * (1 - amount),
        y: g.y + g.h * (0.22 + 0.4 * amount),
        vx: rand(-300, 300) + side * 80,
        vy: side * rand(120, 620),
        life: rand(0.3, 0.9),
        size: rand(1.5, 4.5),
        color: pick(colors),
        gravity: 500
      });
    }
    // Hit-stop, then the halves slide along the cut and drop away.
    await s.wait(110);
    const length = Math.hypot(g.w, g.h * 0.4);
    const ux = g.w / length;
    const uy = (-g.h * 0.4) / length;
    void s.anim(
      upper,
      [
        { transform: "none" },
        {
          transform: `translate(${ux * 46}px, ${uy * 46}px)`,
          offset: 0.3,
          easing: FALL
        },
        {
          transform: `translate(${g.w * 1.1}px, ${-g.h * 1.1}px) rotate(26deg)`,
          opacity: 0
        }
      ],
      { duration: 1050, easing: "ease-out" }
    );
    void s.anim(
      lower,
      [
        { transform: "none" },
        {
          transform: `translate(${-ux * 46}px, ${-uy * 46}px)`,
          offset: 0.3,
          easing: FALL
        },
        {
          transform: `translate(${-g.w * 1.1}px, ${g.h * 1.2}px) rotate(-22deg)`,
          opacity: 0
        }
      ],
      { duration: 1050, easing: "ease-out" }
    );
    await s.wait(420);
    ring(s.fx, g.cx, g.cy, { to: g.w * 1.6, color: "#f43f5e" });
    await present(s);
    s.reveal();
    idle(s, colors);
  }
};

/* 4 ─ Vortex Portal ──────────────────────────────────────────────────── */
const vortex: OpeningVariant = {
  id: "vortex",
  name: "Vortex Portal",
  tagline:
    "The pack spirals into a swirling portal and the card is pulled back out.",
  palette: ["#8b5cf6", "#22d3ee", "#e879f9"],
  background:
    "radial-gradient(ellipse at 50% 50%, #1b1147 0%, #0b0824 55%, #030208 100%)",
  async run(s) {
    const colors = ["#8b5cf6", "#22d3ee", "#e879f9", "#ffffff"];
    await enter(s);
    await s.tap("Tap to open the portal");
    const g = s.geo();
    const portal = { size: 0, glow: 1 };
    const streaks = Array.from({ length: 110 }, () => ({
      radius: rand(0.1, 1),
      angle: rand(0, TAU),
      length: rand(0.25, 1),
      speed: rand(1.6, 3.4),
      width: rand(1, 5),
      color: pick(colors)
    }));
    s.bg.add((ctx, time) => {
      const radius = g.w * 1.3 * portal.size;
      if (radius < 2) return;
      const gradient = ctx.createRadialGradient(
        g.cx,
        g.cy,
        radius * 0.1,
        g.cx,
        g.cy,
        radius * 1.15
      );
      gradient.addColorStop(0, "#8b5cf600");
      gradient.addColorStop(0.75, "#7c3aed");
      gradient.addColorStop(1, "#22d3ee00");
      ctx.globalAlpha = 0.4 * portal.glow;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, radius * 1.15, 0, TAU);
      ctx.fill();
      ctx.lineCap = "round";
      for (const streak of streaks) {
        // Inner streaks orbit faster, like matter falling into the centre.
        const angle =
          streak.angle - time * streak.speed * (1.5 - streak.radius);
        ctx.globalAlpha = (0.25 + 0.75 * streak.radius) * portal.glow;
        ctx.strokeStyle = streak.color;
        ctx.lineWidth = streak.width * portal.size;
        ctx.beginPath();
        ctx.arc(
          g.cx,
          g.cy,
          radius * streak.radius,
          angle,
          angle + streak.length
        );
        ctx.stroke();
      }
      ctx.strokeStyle = "#c4b5fd";
      ctx.globalAlpha = 0.9 * portal.glow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, radius * (1 + 0.02 * Math.sin(time * 9)), 0, TAU);
      ctx.stroke();
    });
    emitter(
      s.fx,
      70,
      () => {
        const angle = rand(0, TAU);
        const radius = rand(g.w * 0.9, g.w * 1.6);
        return {
          kind: "spark",
          x: g.cx + Math.cos(angle) * radius,
          y: g.cy + Math.sin(angle) * radius,
          vx: -Math.cos(angle) * 260 + Math.sin(angle) * 420,
          vy: -Math.sin(angle) * 260 - Math.cos(angle) * 420,
          life: rand(0.5, 0.9),
          size: rand(2, 4),
          color: pick(colors),
          drag: 0.97
        };
      },
      2.4
    );
    void s.tween(900, (progress) => {
      portal.size = easeOut(progress);
    });
    await s.anim(
      s.pack,
      [
        { transform: "none", opacity: 1 },
        { transform: "rotate(200deg) scale(.72)", opacity: 1, offset: 0.55 },
        { transform: "rotate(980deg) scale(0)", opacity: 0 }
      ],
      { duration: 1600, easing: "cubic-bezier(.5,0,.9,.5)" }
    );
    s.flashScreen("#c4b5fd", 420, 0.6);
    s.shake(10, 300);
    ring(s.fx, g.cx, g.cy, { to: g.w * 2, color: "#22d3ee", duration: 0.9 });
    burst(s.fx, g.cx, g.cy, 120, {
      colors,
      speed: [200, 1000],
      size: [2, 5]
    });
    s.card.style.zIndex = "5";
    await s.anim(
      s.card,
      [
        { opacity: 0, transform: "rotate(-540deg) scale(0)" },
        { opacity: 1, transform: "rotate(6deg) scale(1.1)", offset: 0.8 },
        { opacity: 1, transform: "none" }
      ],
      { duration: 1250, easing: "cubic-bezier(.1,.7,.2,1)" }
    );
    ring(s.fx, g.cx, g.cy, { to: g.w * 1.6, color: "#e879f9" });
    s.runSheen();
    void s.tween(1200, (progress) => {
      portal.size = 1 + progress * 0.15;
      portal.glow = 1 - progress * 0.55;
    });
    s.reveal();
    idle(s, colors);
  }
};

/* 7 ─ Anime Impact ───────────────────────────────────────────────────── */
const animeImpact: OpeningVariant = {
  id: "anime-impact",
  name: "Anime Impact",
  tagline:
    "Speed lines, an impact frame, and the card slams down in a storm of petals.",
  palette: ["#fb7185", "#fde047", "#67e8f9"],
  background:
    "radial-gradient(ellipse at 50% 45%, #a21caf 0%, #4c1d95 50%, #150a33 100%)",
  async run(s) {
    const petals = ["#fbcfe8", "#f9a8d4", "#fb7185", "#ffffff"];
    const lines = Array.from({ length: 80 }, () => ({
      angle: rand(0, TAU),
      width: rand(0.004, 0.02),
      phase: rand(0, 1),
      speed: rand(1.4, 3)
    }));
    const speed = { power: 0.16 };
    s.bg.add((ctx, time) => {
      const g = s.geo();
      const reach = Math.hypot(g.sw, g.sh) * 0.6;
      ctx.fillStyle = "#ffffff";
      for (const line of lines) {
        const cycle = (time * line.speed + line.phase) % 1;
        const inner = reach * (0.42 + 0.3 * (1 - cycle));
        ctx.globalAlpha = speed.power * (0.4 + 0.6 * cycle);
        ctx.beginPath();
        ctx.moveTo(
          g.cx + Math.cos(line.angle) * inner,
          g.cy + Math.sin(line.angle) * inner
        );
        ctx.lineTo(
          g.cx + Math.cos(line.angle - line.width) * reach,
          g.cy + Math.sin(line.angle - line.width) * reach
        );
        ctx.lineTo(
          g.cx + Math.cos(line.angle + line.width) * reach,
          g.cy + Math.sin(line.angle + line.width) * reach
        );
        ctx.fill();
      }
    });
    await enter(s);
    await s.tap("Tap to unleash it");
    const g = s.geo();
    speed.power = 0.75;
    await s.anim(
      s.pack,
      [
        { transform: "none" },
        { transform: "translateY(26px) scale(1.14,.84)", offset: 0.45 },
        { transform: "scale(1.28) rotate(-9deg)" }
      ],
      { duration: 540, easing: SOFT }
    );
    s.invert(90);
    s.shake(20, 320);
    await s.wait(130);
    s.invert(60);
    const star = { size: 0, alpha: 0.95 };
    s.bg.add((ctx, time) => {
      const spikes = 20;
      const radius = g.w * 1.02 * star.size;
      if (radius < 2) return;
      [
        ["#fb7185", 1.16, -0.2],
        ["#fde047", 1, 0.25]
      ].forEach(([color, scale, spin]) => {
        ctx.fillStyle = color as string;
        ctx.globalAlpha = star.alpha;
        ctx.globalCompositeOperation = "source-over";
        ctx.beginPath();
        for (let index = 0; index < spikes * 2; index++) {
          const length =
            radius * (scale as number) * (index % 2 === 0 ? 1 : 0.68);
          const angle = (index / (spikes * 2)) * TAU + time * (spin as number);
          ctx.lineTo(
            g.cx + Math.cos(angle) * length,
            g.cy + Math.sin(angle) * length
          );
        }
        ctx.fill();
      });
      ctx.globalCompositeOperation = "lighter";
    });
    void s.tween(420, (progress) => {
      star.size = easeOut(progress) * (1 + 0.18 * Math.sin(progress * Math.PI));
    });
    void s.anim(
      s.pack,
      [
        { transform: "scale(1.28) rotate(-9deg)" },
        {
          transform: `translate(${g.w * 1.3}px, ${-g.sh}px) rotate(560deg) scale(.6)`
        }
      ],
      { duration: 720, easing: "cubic-bezier(.3,0,.8,.4)" }
    );
    s.card.style.zIndex = "5";
    void s.anim(
      s.card,
      [
        {
          opacity: 1,
          transform: `translateY(${-g.sh}px) rotate(-16deg) scale(1.5)`,
          easing: "cubic-bezier(.5,0,.9,.5)"
        },
        {
          opacity: 1,
          transform: "translateY(0) rotate(4deg) scale(.93)",
          offset: 0.55,
          easing: POP
        },
        { opacity: 1, transform: "none" }
      ],
      { duration: 720, delay: 260 }
    );
    await s.wait(260 + 396);
    s.invert(60);
    s.shake(22, 380);
    ring(s.fx, g.cx, g.cy, { to: g.w * 2.1, color: "#ffffff", width: 12 });
    burst(s.fx, g.cx, g.cy, 110, {
      kind: "confetti",
      colors: ["#fb7185", "#fde047", "#67e8f9", "#ffffff"],
      speed: [300, 1100],
      size: [6, 13],
      life: [1.1, 2.1],
      gravity: 800,
      spin: 9
    });
    await s.wait(330);
    s.runSheen();
    void s.tween(900, (progress) => {
      speed.power = 0.75 - progress * 0.55;
      star.alpha = 0.95 - progress * 0.25;
    });
    emitter(s.fx, 13, () => ({
      kind: "petal",
      x: rand(-40, s.fx.width),
      y: -20,
      vx: rand(30, 120),
      vy: rand(70, 170),
      life: rand(4, 7),
      size: rand(6, 11),
      color: pick(petals),
      drag: 1,
      spin: rand(-2, 2),
      shrink: false
    }));
    s.reveal();
  }
};

export const ROUND_ONE_VARIANTS: readonly OpeningVariant[] = [
  holoRip,
  supernova,
  bladeSlice,
  vortex,
  animeImpact
];
