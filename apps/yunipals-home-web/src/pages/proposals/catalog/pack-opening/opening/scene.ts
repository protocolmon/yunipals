import type { MonsterArtwork } from "@/lib/boosters";
import { Fx, rand } from "./fx";
import { ShaderLayer } from "./gl";

/** "interactive" shows the hint while a variant handles its own gesture. */
export type Phase = "sealed" | "interactive" | "opening" | "revealed";
export type SceneElements = {
  stage: HTMLElement;
  world: HTMLElement;
  pack: HTMLElement;
  card: HTMLElement;
  flip: HTMLElement;
  front: HTMLElement;
  back: HTMLElement;
  sheen: HTMLElement;
  layer: HTMLElement;
  flash: HTMLElement;
  trigger: HTMLButtonElement;
  bgCanvas: HTMLCanvasElement;
  fxCanvas: HTMLCanvasElement;
  glCanvas: HTMLCanvasElement;
};
export type SceneHooks = {
  packImage: string;
  setHint: (hint: string) => void;
  setPhase: (phase: Phase) => void;
  /** Synchronously swaps the card face to the next artwork. */
  advanceCard: () => void;
  /** The artwork of the card currently on the stage, if it has loaded. */
  artwork: () => MonsterArtwork | undefined;
};
export type Geometry = {
  /** Pack box in stage pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stage centre and size. */
  cx: number;
  cy: number;
  sw: number;
  sh: number;
  /** Card size. */
  cw: number;
  ch: number;
};
type Timing = number | KeyframeAnimationOptions;

export type Scene = SceneElements & {
  signal: AbortSignal;
  /** Effects behind the pack and card. */
  bg: Fx;
  /** Effects in front of everything. */
  fx: Fx;
  geo: () => Geometry;
  wait: (milliseconds: number) => Promise<void>;
  anim: (
    element: HTMLElement,
    keyframes: Keyframe[],
    timing: Timing
  ) => Promise<void>;
  /** Pins styles immediately, above any earlier animation. */
  set: (element: HTMLElement, keyframe: Keyframe) => void;
  tween: (
    milliseconds: number,
    update: (progress: number) => void
  ) => Promise<void>;
  tap: (hint: string) => Promise<{ x: number; y: number }>;
  flashScreen: (color: string, milliseconds: number, peak?: number) => void;
  invert: (milliseconds: number) => void;
  shake: (pixels: number, milliseconds: number) => void;
  /** A clipped copy of the pack artwork, placed exactly over the pack. */
  piece: (clipPath: string) => HTMLElement;
  element: (className: string) => HTMLElement;
  hidePack: () => void;
  showBack: () => void;
  showFront: () => void;
  flipCard: (milliseconds?: number) => Promise<void>;
  runSheen: () => void;
  reveal: () => void;
  advanceCard: () => void;
  setPhase: (phase: Phase) => void;
  setHint: (hint: string) => void;
  artwork: () => MonsterArtwork | undefined;
  /** Shader layer between the stage and the front effects. */
  gl: ShaderLayer;
  /** Pixel-readable pack and current card images (card falls back to a back). */
  images: () => Promise<{ pack: TexImageSource; card: TexImageSource }>;
  /**
   * Loads both textures and starts a scene shader. Resolves false when WebGL
   * is unavailable, so the variant can fall back to a plain reveal.
   */
  startShader: (fragment: string) => Promise<boolean>;
  /**
   * Re-uploads the textures. Shaders started before the tap call this once
   * the collector acts, because the card artwork may have loaded since.
   */
  refreshTextures: () => Promise<void>;
  /** Swaps the shader-drawn card for the real card element. */
  handoff: () => Promise<void>;
  /**
   * Full-stage button for custom gestures. A keyboard or assistive
   * activation arrives as a click with `detail === 0`.
   */
  surface: (hint: string) => HTMLButtonElement;
};

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(source: string) {
  let pending = imageCache.get(source);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = source;
    });
    imageCache.set(source, pending);
  }
  return pending;
}
/** Stand-in card face for shaders when the artwork cannot be read. */
function placeholderCard() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 512, 768);
  gradient.addColorStop(0, "#4c1d95");
  gradient.addColorStop(0.5, "#7c3aed");
  gradient.addColorStop(1, "#312e81");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 768, 36);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 56px "Archivo Black", "Arial Black", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("YUNIPALS", 256, 400);
  return canvas;
}

export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
const aborted = () => new DOMException("Scene closed", "AbortError");

export function createScene(elements: SceneElements, hooks: SceneHooks) {
  const controller = new AbortController();
  const { signal } = controller;
  const bg = new Fx(elements.bgCanvas);
  const fx = new Fx(elements.fxCanvas);
  const gl = new ShaderLayer(elements.glCanvas);
  const animations = new Set<Animation>();
  const resize = () => {
    bg.resize();
    gl.resize();
    fx.resize();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(elements.stage);
  let frame = 0;
  let previous = performance.now();
  const loop = (now: number) => {
    const delta = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    bg.frame(delta);
    gl.frame(delta);
    fx.frame(delta);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  const wait = (milliseconds: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
      const stop = () => {
        clearTimeout(id);
        reject(aborted());
      };
      const id = setTimeout(() => {
        signal.removeEventListener("abort", stop);
        resolve();
      }, milliseconds);
      signal.addEventListener("abort", stop, { once: true });
    });
  const animate = (
    element: HTMLElement,
    keyframes: Keyframe[],
    timing: Timing
  ) => {
    const animation = element.animate(keyframes, {
      fill: "both",
      easing: "cubic-bezier(.2,.8,.2,1)",
      ...(typeof timing === "number" ? { duration: timing } : timing)
    });
    animations.add(animation);
    return animation;
  };
  const anim: Scene["anim"] = (element, keyframes, timing) => {
    if (signal.aborted) return Promise.reject(aborted());
    const done = animate(element, keyframes, timing).finished.then(
      () => undefined
    );
    // Fire-and-forget animations must not report a rejection when cancelled.
    done.catch(() => undefined);
    return done;
  };
  const geo = (): Geometry => ({
    x: elements.pack.offsetLeft,
    y: elements.pack.offsetTop,
    w: elements.pack.offsetWidth,
    h: elements.pack.offsetHeight,
    cx: elements.stage.clientWidth / 2,
    cy: elements.stage.clientHeight / 2,
    sw: elements.stage.clientWidth,
    sh: elements.stage.clientHeight,
    cw: elements.card.offsetWidth,
    ch: elements.card.offsetHeight
  });
  const showFront = () => {
    elements.front.style.opacity = "1";
    elements.back.style.opacity = "0";
  };
  const showBack = () => {
    elements.front.style.opacity = "0";
    elements.back.style.opacity = "1";
  };

  const scene: Scene = {
    ...elements,
    signal,
    bg,
    fx,
    geo,
    wait,
    anim,
    set: (element, keyframe) => {
      animate(element, [keyframe, keyframe], 1);
    },
    tween: (milliseconds, update) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(aborted());
        const remove = fx.add((_ctx, time) => {
          const progress = Math.min(1, (time * 1000) / milliseconds);
          update(progress);
          if (progress < 1) return;
          signal.removeEventListener("abort", stop);
          resolve();
          return false;
        });
        const stop = () => {
          remove();
          reject(aborted());
        };
        signal.addEventListener("abort", stop, { once: true });
      }),
    tap: (hint) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) return reject(aborted());
        hooks.setPhase("sealed");
        hooks.setHint(hint);
        const stop = () => {
          elements.trigger.removeEventListener("click", click);
          reject(aborted());
        };
        const click = (event: MouseEvent) => {
          signal.removeEventListener("abort", stop);
          hooks.setPhase("opening");
          hooks.setHint("");
          const box = elements.stage.getBoundingClientRect();
          const size = geo();
          // Keyboard activation has no pointer position; use the pack centre.
          resolve(
            event.detail === 0
              ? { x: size.cx, y: size.cy }
              : { x: event.clientX - box.left, y: event.clientY - box.top }
          );
        };
        elements.trigger.addEventListener("click", click, { once: true });
        signal.addEventListener("abort", stop, { once: true });
      }),
    flashScreen: (color, milliseconds, peak = 1) => {
      elements.flash.style.mixBlendMode = "normal";
      elements.flash.style.background = color;
      animate(
        elements.flash,
        [{ opacity: 0 }, { opacity: peak, offset: 0.12 }, { opacity: 0 }],
        { duration: milliseconds, easing: "ease-out", fill: "none" }
      );
    },
    invert: (milliseconds) => {
      elements.flash.style.mixBlendMode = "difference";
      elements.flash.style.background = "#ffffff";
      animate(elements.flash, [{ opacity: 1 }, { opacity: 1 }], {
        duration: milliseconds,
        fill: "none"
      });
    },
    shake: (pixels, milliseconds) => {
      const steps = Math.max(4, Math.round(milliseconds / 34));
      animate(
        elements.world,
        [
          ...Array.from({ length: steps }, (_, index) => {
            const power = pixels * (1 - index / steps);
            return {
              transform: `translate(${rand(-power, power)}px, ${rand(-power, power)}px)`
            };
          }),
          { transform: "none" }
        ],
        { duration: milliseconds, easing: "linear", fill: "none" }
      );
    },
    piece: (clipPath) => {
      const size = geo();
      const piece = document.createElement("div");
      piece.className = "olab-piece";
      piece.style.left = `${size.x}px`;
      piece.style.top = `${size.y}px`;
      piece.style.width = `${size.w}px`;
      piece.style.height = `${size.h}px`;
      piece.style.backgroundImage = `url("${hooks.packImage}")`;
      piece.style.clipPath = clipPath;
      elements.layer.append(piece);
      return piece;
    },
    element: (className) => {
      const element = document.createElement("div");
      element.className = className;
      elements.layer.append(element);
      return element;
    },
    hidePack: () => {
      elements.pack.style.visibility = "hidden";
    },
    showBack,
    showFront,
    flipCard: async (milliseconds = 700) => {
      const turn = (degrees: number) => ({
        transform: `perspective(1100px) rotateY(${degrees}deg)`
      });
      await anim(elements.flip, [turn(0), turn(90)], {
        duration: milliseconds / 2,
        easing: "cubic-bezier(.5,0,1,.6)"
      });
      showFront();
      await anim(elements.flip, [turn(-90), turn(0)], {
        duration: milliseconds / 2,
        easing: "cubic-bezier(0,.4,.3,1)"
      });
    },
    runSheen: () => {
      elements.sheen.classList.remove("is-running");
      void elements.sheen.offsetWidth;
      elements.sheen.classList.add("is-running");
    },
    reveal: () => {
      elements.card.style.zIndex = "5";
      hooks.setPhase("revealed");
    },
    advanceCard: hooks.advanceCard,
    setPhase: hooks.setPhase,
    setHint: hooks.setHint,
    artwork: hooks.artwork,
    gl,
    images: async () => {
      const cardSource = hooks.artwork()?.image;
      const [pack, card] = await Promise.all([
        loadImage(hooks.packImage),
        cardSource ? loadImage(cardSource) : null
      ]);
      if (signal.aborted) throw aborted();
      return {
        pack: pack ?? placeholderCard(),
        card: card ?? placeholderCard()
      };
    },
    startShader: async (fragment) => {
      if (!gl.supported) return false;
      await scene.refreshTextures();
      const size = geo();
      gl.packRect = { x: size.x, y: size.y, w: size.w, h: size.h };
      gl.cardRect = {
        x: size.cx - size.cw / 2,
        y: size.cy - size.ch / 2,
        w: size.cw,
        h: size.ch
      };
      elements.glCanvas.style.opacity = "1";
      return gl.use(fragment);
    },
    refreshTextures: async () => {
      const images = await scene.images();
      gl.texture(0, images.pack);
      gl.texture(1, images.card);
    },
    handoff: async () => {
      // The shader canvas sits behind the card element, so showing the
      // element on the same rectangle covers the shader's copy exactly.
      elements.card.style.zIndex = "5";
      showFront();
      animate(
        elements.card,
        [
          { opacity: 1, transform: "none" },
          { opacity: 1, transform: "none" }
        ],
        1
      );
      await wait(34);
      gl.stop();
    },
    surface: (hint) => {
      const surface = document.createElement("button");
      surface.type = "button";
      surface.className = "olab-surface";
      surface.setAttribute("aria-label", hint);
      elements.stage.append(surface);
      hooks.setPhase("interactive");
      hooks.setHint(hint);
      surface.focus({ preventScroll: true });
      return surface;
    }
  };

  return {
    scene,
    destroy() {
      controller.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const animation of animations) animation.cancel();
    }
  };
}
