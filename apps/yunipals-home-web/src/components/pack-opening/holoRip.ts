import { burst, pick, rand, rays, ring } from "./fx";
import { enter, idle, present, type OpeningVariant } from "./variants";
const SOFT = "cubic-bezier(.3,0,.2,1)";
const FALL = "cubic-bezier(.6,0,.9,.4)";
/* 1 ─ Holo Rip ───────────────────────────────────────────────────────── */
export const holoRip: OpeningVariant = {
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
