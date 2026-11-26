// Small canvas effects engine for the opening lab: additive particles plus
// free-form draw callbacks. No dependencies; colours are #rrggbb strings.

export const TAU = Math.PI * 2;
export const rand = (min: number, max: number) =>
  min + Math.random() * (max - min);
export const pick = <T>(values: readonly T[]): T =>
  values[Math.floor(Math.random() * values.length)];
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const easeOut = (value: number) => 1 - (1 - clamp01(value)) ** 3;

export type ParticleKind =
  "glow" | "spark" | "confetti" | "petal" | "star" | "pixel" | "dot" | "bubble";
export type Particle = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  life: number;
  age: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
  shrink: boolean;
};
export type ParticleInit = Partial<Particle> & { x: number; y: number };
export type Draw = (
  ctx: CanvasRenderingContext2D,
  time: number,
  delta: number
) => boolean | void;

const sprites = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string) {
  let sprite = sprites.get(color);
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = sprite.height = 64;
  const ctx = sprite.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.18, color);
  gradient.addColorStop(0.5, `${color}55`);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  sprites.set(color, sprite);
  return sprite;
}

export class Fx {
  readonly ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  private draws: { draw: Draw; time: number }[] = [];
  private particles: Particle[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** Adds a draw callback; it is removed when it returns false. */
  add(draw: Draw) {
    const entry = { draw, time: 0 };
    this.draws.push(entry);
    return () => {
      this.draws = this.draws.filter((item) => item !== entry);
    };
  }

  emit(init: ParticleInit) {
    if (this.particles.length > 1400) return;
    this.particles.push({
      kind: "glow",
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 0.98,
      life: 1,
      age: 0,
      size: 4,
      color: "#ffffff",
      rotation: rand(0, TAU),
      spin: 0,
      shrink: true,
      ...init
    });
  }

  frame(delta: number) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "lighter";
    for (const entry of [...this.draws]) {
      entry.time += delta;
      ctx.globalAlpha = 1;
      if (entry.draw(ctx, entry.time, delta) === false)
        this.draws = this.draws.filter((item) => item !== entry);
    }
    const drag = delta * 60;
    let kept = 0;
    for (const particle of this.particles) {
      particle.age += delta;
      if (particle.age >= particle.life) continue;
      this.particles[kept++] = particle;
      const friction = particle.drag ** drag;
      particle.vx *= friction;
      particle.vy = particle.vy * friction + particle.gravity * delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.rotation += particle.spin * delta;
      this.paint(particle);
    }
    this.particles.length = kept;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private paint(particle: Particle) {
    const { ctx } = this;
    const left = 1 - particle.age / particle.life;
    const size = particle.shrink
      ? particle.size * (0.25 + left * 0.75)
      : particle.size;
    const solid =
      particle.kind === "confetti" ||
      particle.kind === "petal" ||
      particle.kind === "dot";
    ctx.globalCompositeOperation = solid ? "source-over" : "lighter";
    ctx.globalAlpha = Math.min(1, left * (solid ? 4 : 1.6));
    switch (particle.kind) {
      case "glow":
        ctx.drawImage(
          glowSprite(particle.color),
          particle.x - size,
          particle.y - size,
          size * 2,
          size * 2
        );
        break;
      case "spark": {
        const speed = Math.hypot(particle.vx, particle.vy) || 1;
        const tail = Math.min(46, speed * 0.045) / speed;
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = Math.max(0.6, size * 0.5);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(
          particle.x - particle.vx * tail,
          particle.y - particle.vy * tail
        );
        ctx.stroke();
        break;
      }
      case "dot":
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, size, 0, TAU);
        ctx.fill();
        break;
      case "bubble":
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = Math.max(1, size * 0.14);
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, size, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(
          particle.x - size * 0.35,
          particle.y - size * 0.35,
          size * 0.16,
          0,
          TAU
        );
        ctx.fill();
        break;
      case "pixel":
        ctx.fillStyle = particle.color;
        ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
        break;
      case "star": {
        ctx.globalAlpha *= 0.55 + 0.45 * Math.sin(particle.age * 18 + size);
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        for (let index = 0; index < 8; index++) {
          const radius = index % 2 === 0 ? size : size * 0.22;
          const angle = (index / 8) * TAU + particle.rotation;
          ctx.lineTo(
            particle.x + Math.cos(angle) * radius,
            particle.y + Math.sin(angle) * radius
          );
        }
        ctx.fill();
        break;
      }
      default: {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.scale(1, Math.cos(particle.age * 7 + particle.rotation));
        ctx.fillStyle = particle.color;
        if (particle.kind === "confetti")
          ctx.fillRect(-size / 2, -size / 3, size, size * 0.66);
        else {
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.bezierCurveTo(
            size * 0.8,
            -size * 0.3,
            size * 0.5,
            size * 0.7,
            0,
            size
          );
          ctx.bezierCurveTo(
            -size * 0.5,
            size * 0.7,
            -size * 0.8,
            -size * 0.3,
            0,
            -size
          );
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }
}

export type BurstOptions = {
  kind?: ParticleKind;
  colors: readonly string[];
  speed: [number, number];
  life?: [number, number];
  size?: [number, number];
  /** Centre direction in radians and total spread; defaults to a full circle. */
  angle?: number;
  spread?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  scatter?: number;
};
export function burst(
  fx: Fx,
  x: number,
  y: number,
  count: number,
  options: BurstOptions
) {
  const life = options.life ?? [0.5, 1.1];
  const size = options.size ?? [2, 5];
  const spread = options.spread ?? TAU;
  for (let index = 0; index < count; index++) {
    const angle = (options.angle ?? 0) + rand(-spread / 2, spread / 2);
    const speed = rand(options.speed[0], options.speed[1]);
    const scatter = options.scatter ?? 0;
    fx.emit({
      kind: options.kind ?? "spark",
      x: x + rand(-scatter, scatter),
      y: y + rand(-scatter, scatter),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: rand(life[0], life[1]),
      size: rand(size[0], size[1]),
      color: pick(options.colors),
      gravity: options.gravity ?? 0,
      drag: options.drag ?? 0.95,
      spin: options.spin ? rand(-options.spin, options.spin) : 0
    });
  }
}

/** Emits `rate` particles per second until stopped or `duration` elapses. */
export function emitter(
  fx: Fx,
  rate: number,
  make: (time: number) => ParticleInit,
  duration = Infinity
) {
  let owed = 0;
  return fx.add((_ctx, time, delta) => {
    if (time > duration) return false;
    owed += rate * delta;
    while (owed >= 1) {
      owed--;
      fx.emit(make(time));
    }
  });
}

export function ring(
  fx: Fx,
  x: number,
  y: number,
  options: {
    to: number;
    from?: number;
    duration?: number;
    color: string;
    width?: number;
  }
) {
  const duration = options.duration ?? 0.8;
  const from = options.from ?? 10;
  fx.add((ctx, time) => {
    const progress = time / duration;
    if (progress >= 1) return false;
    const radius = from + (options.to - from) * easeOut(progress);
    const width = (options.width ?? 8) * (1 - progress * 0.7);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.strokeStyle = options.color;
    ctx.globalAlpha = (1 - progress) ** 1.5 * 0.35;
    ctx.lineWidth = width * 3.5;
    ctx.stroke();
    ctx.globalAlpha = (1 - progress) ** 1.5;
    ctx.lineWidth = width;
    ctx.stroke();
  });
}

/** Rotating light wedges. Returns a handle to fade them out. */
export function rays(
  fx: Fx,
  x: number,
  y: number,
  options: {
    count?: number;
    color: string;
    length: number;
    spin?: number;
    strength?: number;
  }
) {
  const count = options.count ?? 14;
  const wedges = Array.from({ length: count }, (_, index) => ({
    angle: (index / count) * TAU + rand(-0.12, 0.12),
    width: rand(0.03, 0.11),
    speed: rand(0.6, 1.4)
  }));
  let clock = 0;
  let fadeAt = Infinity;
  let fadeFor = 1;
  fx.add((ctx, time) => {
    clock = time;
    const fade = time > fadeAt ? 1 - (time - fadeAt) / fadeFor : 1;
    if (fade <= 0) return false;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, options.length);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.12, options.color);
    gradient.addColorStop(1, `${options.color}00`);
    ctx.fillStyle = gradient;
    ctx.globalAlpha =
      Math.min(1, time / 0.35) * fade * (options.strength ?? 0.5);
    for (const wedge of wedges) {
      const angle = wedge.angle + time * (options.spin ?? 0.25) * wedge.speed;
      const width =
        wedge.width * (0.75 + 0.25 * Math.sin(time * 3 + wedge.angle * 9));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.cos(angle - width) * options.length,
        y + Math.sin(angle - width) * options.length
      );
      ctx.lineTo(
        x + Math.cos(angle + width) * options.length,
        y + Math.sin(angle + width) * options.length
      );
      ctx.fill();
    }
  });
  return {
    fade(seconds = 0.8) {
      fadeAt = clock;
      fadeFor = seconds;
    }
  };
}

/** A flickering jagged lightning line. */
export function bolt(
  fx: Fx,
  from: [number, number],
  to: [number, number],
  options: { color: string; duration?: number; width?: number; jitter?: number }
) {
  const duration = options.duration ?? 0.25;
  let points: [number, number][] = [];
  let next = 0;
  fx.add((ctx, time) => {
    if (time >= duration) return false;
    if (time >= next) {
      next = time + 0.045;
      const steps = 9;
      const jitter = options.jitter ?? 16;
      points = Array.from({ length: steps + 1 }, (_, index) => {
        const amount = index / steps;
        const edge = index === 0 || index === steps ? 0 : jitter;
        return [
          from[0] + (to[0] - from[0]) * amount + rand(-edge, edge),
          from[1] + (to[1] - from[1]) * amount + rand(-edge, edge)
        ];
      });
    }
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach(([px, py], index) =>
      index ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
    );
    const left = 1 - time / duration;
    ctx.strokeStyle = options.color;
    ctx.globalAlpha = 0.4 * left;
    ctx.lineWidth = (options.width ?? 3) * 4;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = left;
    ctx.lineWidth = options.width ?? 3;
    ctx.stroke();
  });
}
