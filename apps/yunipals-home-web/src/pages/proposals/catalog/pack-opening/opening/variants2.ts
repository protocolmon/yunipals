import { burst, clamp01, easeOut, emitter, pick, rand, ring } from "./fx";
import type { Scene } from "./scene";
import { FOIL_PEEL, HYPERSPACE, INK_BLOOM, LIQUID_METAL } from "./shaders";
import { enter, idle, present, type OpeningVariant } from "./variants";

const smooth = (value: number) => value * value * (3 - 2 * value);

/** Plain reveal for browsers without WebGL2. */
async function withoutShader(s: Scene) {
  s.hidePack();
  await present(s);
  s.reveal();
}

/** Resolves when the abort signal fires or `settle` is called. */
function gesture(s: Scene) {
  let settle = () => {};
  const done = new Promise<void>((resolve, reject) => {
    settle = resolve;
    s.signal.addEventListener(
      "abort",
      () => reject(new DOMException("Scene closed", "AbortError")),
      { once: true }
    );
  });
  return { done, settle: () => settle() };
}

/* 11 ─ Liquid Metal ──────────────────────────────────────────────────── */
const liquidMetal: OpeningVariant = {
  id: "liquid-metal",
  name: "Liquid Metal",
  tagline:
    "The pack melts into iridescent chrome, pools, then rises and hardens into the card.",
  palette: ["#c7d2fe", "#f0abfc", "#67e8f9"],
  background:
    "radial-gradient(ellipse at 50% 60%, #1e2238 0%, #0c0e1a 55%, #030308 100%)",
  async run(s) {
    const colors = ["#ffffff", "#c7d2fe", "#f0abfc", "#67e8f9"];
    await enter(s);
    await s.tap("Tap to melt the pack");
    const g = s.geo();
    if (!(await s.startShader(LIQUID_METAL))) return withoutShader(s);
    s.hidePack();
    emitter(
      s.fx,
      34,
      () => ({
        x: g.x + rand(g.w * 0.12, g.w * 0.88),
        y: g.y + g.h * rand(0.75, 1.02),
        vy: rand(60, 220),
        gravity: 700,
        life: rand(0.4, 0.8),
        size: rand(3, 7),
        color: pick(colors)
      }),
      1.5
    );
    await s.tween(1750, (progress) => {
      s.gl.p[0] = progress ** 1.25;
    });
    s.shake(5, 220);
    await s.tween(1250, (progress) => {
      s.gl.p[1] = smooth(progress);
    });
    s.flashScreen("#e0e7ff", 320, 0.28);
    await s.tween(1150, (progress) => {
      s.gl.p[2] = progress;
    });
    ring(s.fx, g.cx, g.cy, { to: g.w * 1.7, color: "#c7d2fe" });
    burst(s.fx, g.cx, g.cy, 80, {
      colors,
      speed: [160, 760],
      size: [2, 5]
    });
    await s.handoff();
    s.runSheen();
    s.reveal();
    idle(s, colors);
  }
};

/* 12 ─ Scratch Foil ──────────────────────────────────────────────────── */
const scratchFoil: OpeningVariant = {
  id: "scratch-foil",
  name: "Scratch Foil",
  tagline:
    "The pack flips into a scratch card. Rub the holographic foil away with your own hand.",
  palette: ["#e5e7eb", "#a78bfa", "#fde68a"],
  background:
    "radial-gradient(ellipse at 50% 45%, #2b2350 0%, #130f2b 55%, #05040c 100%)",
  async run(s) {
    const colors = ["#ffffff", "#e5e7eb", "#c4b5fd", "#fde68a"];
    const flakes = ["#f3f4f6", "#d1d5db", "#9ca3af", "#c4b5fd"];
    await enter(s);
    await s.tap("Tap to flip the pack over");
    const g = s.geo();
    const turn = (degrees: number) => ({
      transform: `perspective(1100px) rotateY(${degrees}deg)`
    });
    await s.anim(s.pack, [turn(0), turn(90)], {
      duration: 300,
      easing: "ease-in"
    });
    s.hidePack();

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const foil = document.createElement("canvas");
    foil.className = "olab-foil";
    foil.width = Math.round(g.cw * ratio);
    foil.height = Math.round(g.ch * ratio);
    foil.style.left = `${g.cx - g.cw / 2}px`;
    foil.style.top = `${g.cy - g.ch / 2}px`;
    foil.style.width = `${g.cw}px`;
    foil.style.height = `${g.ch}px`;
    s.layer.append(foil);
    const ctx = foil.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.beginPath();
    ctx.roundRect(0, 0, g.cw, g.ch, g.cw * 0.06);
    ctx.clip();
    const silver = ctx.createLinearGradient(0, 0, g.cw, g.ch);
    ["#aeb4c2", "#f4f5f9", "#b9bfcc", "#eef0f5", "#a3a9b8", "#e7e9f0"].forEach(
      (color, index) => silver.addColorStop(index / 5, color)
    );
    ctx.fillStyle = silver;
    ctx.fillRect(0, 0, g.cw, g.ch);
    for (let stripe = -g.ch; stripe < g.cw; stripe += 9) {
      ctx.strokeStyle = `hsla(${(stripe * 1.7 + 720) % 360}, 90%, 62%, 0.2)`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(stripe, 0);
      ctx.lineTo(stripe + g.ch, g.ch);
      ctx.stroke();
    }
    for (let dot = 0; dot < 420; dot++) {
      ctx.fillStyle = Math.random() < 0.5 ? "#ffffffcc" : "#6b728055";
      ctx.fillRect(
        rand(0, g.cw),
        rand(0, g.ch),
        rand(0.6, 1.8),
        rand(0.6, 1.8)
      );
    }
    ctx.fillStyle = "#5b21b6c0";
    ctx.textAlign = "center";
    ctx.font = `900 ${g.cw * 0.2}px "Archivo Black", "Arial Black", sans-serif`;
    ctx.fillText("✦", g.cw / 2, g.ch * 0.42);
    ctx.font = `900 ${g.cw * 0.105}px "Archivo Black", "Arial Black", sans-serif`;
    ctx.fillText("SCRATCH", g.cw / 2, g.ch * 0.56);
    ctx.fillText("TO REVEAL", g.cw / 2, g.ch * 0.64);
    ctx.strokeStyle = "#ffffffb0";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(2.5, 2.5, g.cw - 5, g.ch - 5, g.cw * 0.055);
    ctx.stroke();

    s.set(s.card, { opacity: 1, transform: "none" });
    void s.anim(foil, [turn(-90), turn(0)], {
      duration: 340,
      easing: "ease-out"
    });
    await s.anim(s.flip, [turn(-90), turn(0)], {
      duration: 340,
      easing: "ease-out"
    });

    const columns = 10;
    const rows = 15;
    const cleared = new Uint8Array(columns * rows);
    let count = 0;
    let last: { x: number; y: number } | null = null;
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = g.cw * 0.17;
    const scratch = (x: number, y: number) => {
      ctx.beginPath();
      ctx.moveTo(last?.x ?? x, last?.y ?? y);
      ctx.lineTo(x + 0.01, y);
      ctx.stroke();
      last = { x, y };
      if (x < 0 || y < 0 || x > g.cw || y > g.ch) return;
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          const index = row * columns + column;
          if (cleared[index]) continue;
          const dx = ((column + 0.5) / columns) * g.cw - x;
          const dy = ((row + 0.5) / rows) * g.ch - y;
          if (Math.hypot(dx, dy) > g.cw * 0.105) continue;
          cleared[index] = 1;
          count++;
        }
      const sx = g.cx - g.cw / 2 + x;
      const sy = g.cy - g.ch / 2 + y;
      for (let index = 0; index < 3; index++)
        s.fx.emit({
          kind: "confetti",
          x: sx + rand(-10, 10),
          y: sy + rand(-10, 10),
          vx: rand(-140, 140),
          vy: rand(-160, 60),
          gravity: 900,
          life: rand(0.5, 1.1),
          size: rand(3, 7),
          color: pick(flakes),
          spin: rand(-9, 9)
        });
      s.fx.emit({
        kind: "star",
        x: sx + rand(-14, 14),
        y: sy + rand(-14, 14),
        life: 0.35,
        size: rand(4, 9),
        color: pick(colors)
      });
    };

    const surface = s.surface("Scratch the foil off — drag across the card");
    const { done, settle } = gesture(s);
    const box = () => foil.getBoundingClientRect();
    let pressed = false;
    const check = () => {
      if (count / cleared.length >= 0.5) settle();
    };
    surface.addEventListener("pointerdown", (event) => {
      pressed = true;
      last = null;
      surface.setPointerCapture(event.pointerId);
      scratch(event.clientX - box().left, event.clientY - box().top);
    });
    surface.addEventListener("pointermove", (event) => {
      if (!pressed) return;
      scratch(event.clientX - box().left, event.clientY - box().top);
      check();
    });
    const release = () => {
      pressed = false;
      last = null;
    };
    surface.addEventListener("pointerup", release);
    surface.addEventListener("pointercancel", release);
    surface.addEventListener("click", (event) => {
      // Keyboard and assistive activation: scratch it for the collector.
      if (event.detail !== 0) return;
      last = null;
      void s
        .tween(1500, (progress) => {
          scratch(
            g.cw * (0.5 + 0.44 * Math.sin(progress * Math.PI * 9)),
            g.ch * progress
          );
        })
        .then(settle, () => undefined);
    });
    await done;
    surface.remove();
    s.setPhase("opening");
    void s.anim(
      foil,
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(1.08)" }
      ],
      360
    );
    burst(s.fx, g.cx, g.cy, 90, {
      kind: "confetti",
      colors: flakes,
      speed: [200, 800],
      size: [4, 10],
      life: [0.9, 1.8],
      gravity: 900,
      spin: 9,
      scatter: g.cw * 0.4
    });
    ring(s.fx, g.cx, g.cy, { to: g.w * 1.7, color: "#c4b5fd" });
    s.flashScreen("#ffffff", 300, 0.3);
    await s.wait(360);
    foil.remove();
    s.runSheen();
    s.reveal();
    idle(s, colors);
  }
};

/* 13 ─ Stardust ──────────────────────────────────────────────────────── */
function samplePixels(image: TexImageSource, columns: number, rows: number) {
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image as CanvasImageSource, 0, 0, columns, rows);
  try {
    return ctx.getImageData(0, 0, columns, rows).data;
  } catch {
    return null;
  }
}
const stardust: OpeningVariant = {
  id: "stardust",
  name: "Stardust",
  tagline:
    "The pack crumbles into thousands of glowing grains that swirl like a galaxy and rebuild as the card.",
  palette: ["#f0abfc", "#93c5fd", "#fde68a"],
  background:
    "radial-gradient(ellipse at 50% 50%, #1a1440 0%, #0a0820 55%, #020207 100%)",
  async run(s) {
    const colors = ["#ffffff", "#f0abfc", "#93c5fd", "#fde68a"];
    await enter(s);
    await s.tap("Tap to scatter the pack into stardust");
    const g = s.geo();
    const images = await s.images();
    const columns = 64;
    const rows = 96;
    const packPixels = samplePixels(images.pack, columns, rows);
    const cardPixels = samplePixels(images.card, columns, rows);
    const homes: number[] = [];
    const targets: number[] = [];
    for (let index = 0; index < columns * rows; index++) {
      if (!packPixels || packPixels[index * 4 + 3] > 60) homes.push(index);
      if (!cardPixels || cardPixels[index * 4 + 3] > 60) targets.push(index);
    }
    const color = (pixels: Uint8ClampedArray | null, index: number) =>
      pixels
        ? `rgb(${pixels[index * 4]},${pixels[index * 4 + 1]},${pixels[index * 4 + 2]})`
        : pick(colors);
    const cell = g.cw / columns;
    const grains = targets.map((target, order) => {
      const home = homes[(order * 7919) % homes.length];
      const hx = g.x + (((home % columns) + 0.5) / columns) * g.w;
      const hy = g.y + ((Math.floor(home / columns) + 0.5) / rows) * g.h;
      const ty = (Math.floor(target / columns) + 0.5) / rows;
      return {
        x: hx,
        y: hy,
        vx: (hx - g.cx) * 1.3 + rand(-70, 70),
        vy: rand(-240, -30),
        tx: g.cx - g.cw / 2 + ((target % columns) + 0.5) * cell,
        ty: g.cy - g.ch / 2 + ty * g.ch,
        release: ((hy - g.y) / g.h) * 0.85 + rand(0, 0.3),
        delay: (1 - ty) * 0.55 + rand(0, 0.25),
        orbit: g.w * rand(0.45, 1.5),
        from: color(packPixels, home),
        to: color(cardPixels, target)
      };
    });
    const gather = 2.3;
    let running = true;
    s.fx.add((ctx, time, delta) => {
      if (!running) return false;
      const damping = 0.985 ** (delta * 60);
      for (const pass of [0, 1]) {
        ctx.globalCompositeOperation = pass === 0 ? "lighter" : "source-over";
        for (const grain of grains) {
          if (time < grain.release) continue;
          const settle = clamp01((time - gather - grain.delay) / 1.1);
          if ((settle >= 0.5 ? 1 : 0) !== pass) continue;
          if (pass === 0 || settle < 1) {
            const dx = grain.x - g.cx;
            const dy = grain.y - g.cy;
            const distance = Math.hypot(dx, dy) + 1;
            const pull = (distance - grain.orbit) * 3.2;
            grain.vx =
              (grain.vx +
                ((-dy / distance) * 540 - (dx / distance) * pull) * delta) *
              damping;
            grain.vy =
              (grain.vy +
                ((dx / distance) * 540 - (dy / distance) * pull) * delta) *
              damping;
            grain.x += grain.vx * delta;
            grain.y += grain.vy * delta;
          }
          const ease =
            settle < 0.5 ? 4 * settle ** 3 : 1 - (-2 * settle + 2) ** 3 / 2;
          const size = cell * (pass === 0 ? 0.75 : 1) + 0.7;
          ctx.globalAlpha = pass === 0 ? 0.9 : 1;
          ctx.fillStyle = pass === 0 ? grain.from : grain.to;
          ctx.fillRect(
            grain.x + (grain.tx - grain.x) * ease - size / 2,
            grain.y + (grain.ty - grain.y) * ease - size / 2,
            size,
            size
          );
        }
      }
      ctx.globalCompositeOperation = "lighter";
    });
    // Erase the real pack top-down in step with the grains leaving it.
    void s
      .tween(1250, (progress) => {
        const edge = progress * 125 - 12;
        const mask = `linear-gradient(to bottom, transparent ${edge}%, #000 ${edge + 12}%)`;
        s.pack.style.setProperty("mask-image", mask);
        s.pack.style.setProperty("-webkit-mask-image", mask);
      })
      .then(
        () => s.hidePack(),
        () => undefined
      );
    emitter(
      s.fx,
      26,
      () => ({
        kind: "star",
        x: g.cx + rand(-g.w, g.w),
        y: g.cy + rand(-g.h * 0.7, g.h * 0.7),
        life: rand(0.4, 0.9),
        size: rand(3, 8),
        color: pick(colors)
      }),
      3.6
    );
    await s.wait((gather + 0.8 + 1.1) * 1000 + 150);
    s.card.style.zIndex = "5";
    s.flashScreen("#f5d0fe", 360, 0.3);
    ring(s.fx, g.cx, g.cy, { to: g.w * 1.8, color: "#f0abfc" });
    await s.anim(
      s.card,
      [
        { opacity: 0, transform: "none" },
        { opacity: 1, transform: "none" }
      ],
      { duration: 320, easing: "linear" }
    );
    running = false;
    burst(s.fx, g.cx, g.cy, 70, {
      kind: "star",
      colors,
      speed: [120, 620],
      size: [4, 10],
      life: [0.7, 1.5],
      spin: 4
    });
    s.runSheen();
    s.reveal();
    idle(s, colors);
  }
};

/* 14 ─ Ink Bloom ─────────────────────────────────────────────────────── */
const inkBloom: OpeningVariant = {
  id: "ink-bloom",
  name: "Ink Bloom",
  tagline:
    "On warm paper the pack washes away like watercolor, and the card soaks in through spreading ink.",
  palette: ["#4338ca", "#db2777", "#0d9488"],
  background:
    "radial-gradient(ellipse at 50% 45%, #fdf8ec 0%, #f3e9d2 60%, #e2d3b3 100%)",
  theme: "light",
  async run(s) {
    const inks = ["#312e81", "#4338ca", "#be185d", "#0f766e"];
    const speck = (x: number, y: number, count: number) =>
      burst(s.fx, x, y, count, {
        kind: "dot",
        colors: inks,
        speed: [60, 520],
        size: [1.5, 6],
        life: [0.7, 1.6],
        gravity: 500,
        drag: 0.93
      });
    await enter(s);
    await s.tap("Tap to let the ink flow");
    const g = s.geo();
    if (!(await s.startShader(INK_BLOOM))) return withoutShader(s);
    s.hidePack();
    speck(g.cx, g.cy, 30);
    void s.tween(1700, (progress) => {
      s.gl.p[0] = progress;
    });
    await s.wait(950);
    // Drops of ink land on the paper where the washes will start.
    for (let drop = 0; drop < 4; drop++) {
      const x = g.cx + rand(-g.cw * 0.35, g.cw * 0.35);
      const y = g.cy + rand(-g.ch * 0.35, g.ch * 0.35);
      speck(x, y, 16);
      await s.wait(110);
    }
    await s.tween(2900, (progress) => {
      s.gl.p[1] = 0.04 + 0.96 * smooth(progress);
    });
    await s.handoff();
    s.runSheen();
    s.reveal();
    emitter(s.fx, 5, () => ({
      kind: "dot",
      x: g.cx + rand(-g.cw, g.cw),
      y: g.cy + rand(-g.ch * 0.6, g.ch * 0.6),
      vx: rand(-12, 12),
      vy: rand(-26, -6),
      life: rand(1.2, 2.4),
      size: rand(1.5, 4),
      color: pick(inks),
      drag: 1
    }));
  }
};

/* 18 ─ Foil Peel ─────────────────────────────────────────────────────── */
const foilPeel: OpeningVariant = {
  id: "foil-peel",
  name: "Foil Peel",
  tagline:
    "Grab the corner and peel the foil back yourself. It curls like a real sticker, with light spilling out underneath.",
  palette: ["#fbbf24", "#c4b5fd", "#fef3c7"],
  background:
    "radial-gradient(ellipse at 50% 45%, #33265e 0%, #151033 55%, #05040d 100%)",
  async run(s) {
    const colors = ["#ffffff", "#fef3c7", "#fbbf24", "#c4b5fd"];
    await enter(s);
    const g = s.geo();
    if (!(await s.startShader(FOIL_PEEL))) {
      await s.tap("Tap the pack to open it");
      return withoutShader(s);
    }
    const under = 0.86;
    const curl = Math.max(14, g.w * 0.065);
    const corner = { x: g.x + g.w * 0.93, y: g.y + g.h * 0.955 };
    const reach = Math.hypot(g.w, g.h);
    const rest = { x: corner.x - g.w * 0.07, y: corner.y - g.w * 0.09 };
    const flap = { ...rest };
    let held = false;
    let moved = 0;
    const apply = () => {
      const dx = Math.min(-4, flap.x - corner.x);
      const dy = Math.min(-4, flap.y - corner.y);
      const length = Math.hypot(dx, dy);
      const along = (length + Math.PI * curl) / 2;
      s.gl.p = [dx / length, dy / length, curl, 0];
      s.gl.q = [
        corner.x + (dx / length) * along,
        corner.y + (dy / length) * along,
        0,
        under
      ];
      return length;
    };
    apply();
    s.hidePack();
    const surface = s.surface("Drag the corner to peel the foil back");
    const { done, settle } = gesture(s);
    let peeling = false;
    // The corner lifts a little on its own to show where to grab.
    const breathe = s.fx.add((_ctx, time) => {
      if (held || peeling) return;
      const lift = 0.5 + 0.5 * Math.sin(time * 2.6);
      flap.x = rest.x - lift * g.w * 0.035;
      flap.y = rest.y - lift * g.w * 0.045;
      apply();
    });
    const finish = () => {
      if (peeling) return;
      peeling = true;
      breathe();
      const from = { ...flap };
      const to = { x: corner.x - g.w * 2.3, y: corner.y - g.h * 2.3 };
      void s
        .tween(820, (progress) => {
          const eased = progress * progress;
          flap.x = from.x + (to.x - from.x) * eased;
          flap.y = from.y + (to.y - from.y) * eased;
          sparkle(apply(), 4);
        })
        .then(settle, () => undefined);
    };
    const sparkle = (length: number, amount: number) => {
      const [nx, ny] = s.gl.p;
      for (let index = 0; index < amount; index++) {
        const along = rand(-reach, reach) * 0.5;
        const x = s.gl.q[0] - ny * along;
        const y = s.gl.q[1] + nx * along;
        if (x < g.x || x > g.x + g.w || y < g.y || y > g.y + g.h) continue;
        s.fx.emit({
          kind: Math.random() < 0.3 ? "star" : "glow",
          x,
          y,
          vx: -nx * rand(20, 160),
          vy: -ny * rand(20, 160) - 40,
          life: rand(0.35, 0.9),
          size: rand(2, 6) + length * 0.004,
          color: pick(colors)
        });
      }
    };
    let grab = { x: 0, y: 0, fx: 0, fy: 0 };
    surface.addEventListener("pointerdown", (event) => {
      if (peeling) return;
      held = true;
      moved = 0;
      surface.setPointerCapture(event.pointerId);
      grab = { x: event.clientX, y: event.clientY, fx: flap.x, fy: flap.y };
    });
    surface.addEventListener("pointermove", (event) => {
      if (!held || peeling) return;
      flap.x = grab.fx + event.clientX - grab.x;
      flap.y = grab.fy + event.clientY - grab.y;
      moved = Math.max(
        moved,
        Math.hypot(event.clientX - grab.x, event.clientY - grab.y)
      );
      sparkle(apply(), 2);
    });
    const release = () => {
      if (!held || peeling) return;
      held = false;
      // A plain tap, or a pull past the middle, finishes the peel.
      if (moved < 8 || apply() > reach * 0.42) return finish();
      const from = { ...flap };
      void s
        .tween(320, (progress) => {
          if (held || peeling) return;
          flap.x = from.x + (rest.x - from.x) * easeOut(progress);
          flap.y = from.y + (rest.y - from.y) * easeOut(progress);
          apply();
        })
        .catch(() => undefined);
    };
    surface.addEventListener("pointerup", release);
    surface.addEventListener("pointercancel", release);
    surface.addEventListener("click", (event) => {
      if (event.detail === 0) finish();
    });
    await done;
    surface.remove();
    s.setPhase("opening");
    s.set(s.card, { opacity: 1, transform: `scale(${under})` });
    s.gl.stop();
    s.flashScreen("#fef3c7", 320, 0.35);
    ring(s.fx, g.cx, g.cy, { to: g.w * 1.7, color: "#fbbf24" });
    burst(s.fx, g.cx, g.cy, 80, {
      kind: "star",
      colors,
      speed: [140, 700],
      size: [4, 10],
      life: [0.7, 1.5],
      spin: 4
    });
    await present(s, `scale(${under})`);
    s.reveal();
    idle(s, colors);
  }
};

/* 19 ─ Hyperspace ────────────────────────────────────────────────────── */
const hyperspace: OpeningVariant = {
  id: "hyperspace",
  name: "Hyperspace",
  tagline:
    "The pack launches down a star tunnel. You follow at light speed until the card drops out of the jump.",
  palette: ["#60a5fa", "#c084fc", "#f0f9ff"],
  background:
    "radial-gradient(ellipse at 50% 50%, #0b1030 0%, #050718 55%, #010104 100%)",
  async run(s) {
    const colors = ["#ffffff", "#bfdbfe", "#60a5fa", "#c084fc"];
    const shader = await s.startShader(HYPERSPACE);
    s.gl.p = [0.05, 0, 0, 0.4];
    s.bg.add((_ctx, _time, delta) => {
      s.gl.q[0] += delta * (0.22 + s.gl.p[0] * 5.6);
    });
    await enter(s);
    await s.tap("Tap to make the jump");
    if (!shader) return withoutShader(s);
    await s.refreshTextures();
    const g = s.geo();
    void s.tween(950, (progress) => {
      s.gl.p[0] = 0.05 + 0.95 * progress * progress;
      s.gl.p[3] = 0.4 + 0.6 * progress;
    });
    await s.anim(
      s.pack,
      [
        { transform: "none", opacity: 1 },
        { transform: "scale(1.16) rotate(-5deg)", opacity: 1, offset: 0.28 },
        { transform: "scale(0) rotate(50deg)", opacity: 0 }
      ],
      { duration: 950, easing: "cubic-bezier(.5,0,.9,.4)" }
    );
    s.shake(5, 1150);
    await s.wait(1150);
    s.flashScreen("#ffffff", 620, 0.85);
    await s.tween(240, (progress) => {
      s.gl.p[2] = progress;
    });
    await s.tween(1350, (progress) => {
      s.gl.p[1] = 1 - (1 - progress) ** 4;
      s.gl.p[0] = 1 - 0.93 * smooth(progress);
      s.gl.p[2] = 1 - progress;
    });
    s.shake(10, 300);
    ring(s.fx, g.cx, g.cy, { to: g.w * 2, color: "#60a5fa", width: 10 });
    burst(s.fx, g.cx, g.cy, 110, { colors, speed: [240, 1100], size: [2, 5] });
    // The tunnel keeps drifting behind the real card.
    s.card.style.zIndex = "5";
    s.set(s.card, { opacity: 1, transform: "none" });
    s.gl.p[1] = 0;
    s.runSheen();
    void s.tween(1200, (progress) => {
      s.gl.p[3] = 1 - 0.5 * progress;
    });
    s.reveal();
    idle(s, colors);
  }
};

export const ROUND_TWO_VARIANTS: readonly OpeningVariant[] = [
  liquidMetal,
  scratchFoil,
  stardust,
  inkBloom,
  foilPeel,
  hyperspace
];
