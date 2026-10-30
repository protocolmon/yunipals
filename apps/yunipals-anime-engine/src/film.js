import { resolveAnimeKit } from "./kitPolicy.js";
// Yunipals Arena — deterministic full-tournament motion and signature kits.
// Every frame is a pure function of film time, so one code path drives live
// playback, scrubbing and frame-exact offline rendering.
//   tournament.json   — referee data only (events, timing, verdicts)
//   choreography.json — staging authored per match (body placement, short
//                       attack names, cut-ins); never changes an outcome
// Poses, hits, HP, falls, camera and slow motion are derived from the events.

const W = 1280,
  H = 720,
  FPS = 30,
  GROUND = 505;

// ---------- deterministic helpers ----------
const R = (i) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeOutBack = (t) => {
  t = clamp(t);
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const win = (x, a, b) => x >= a && x < b;
const bump = (x, a, b, edge) =>
  smooth((x - a) / edge) * (1 - smooth((x - b) / edge));
function keys(t, ks) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++)
    if (t <= ks[i][0]) {
      const [t0, v0] = ks[i - 1],
        [t1, v1] = ks[i];
      return t1 === t0 ? v1 : lerp(v0, v1, smooth((t - t0) / (t1 - t0)));
    }
  return ks[ks.length - 1][1];
}
function stepKeys(t, ks) {
  let v = ks[0][1];
  for (const [k, x] of ks) if (t >= k) v = x;
  return v;
}
// Minimum on-screen time for a text so it can actually be read (~18 chars/s + reaction time).
const READ = (s) => 1.0 + s.length * 0.055;

// ---------- fighter look ----------
// h: on-stage sprite height per pose; face: direction the sprite art looks (+1 right);
// origin: attack source (mouth/horn/hoof) and torso: hit point, as fractions of sprite height.
const LOOK = {};
const has = (id, pose) => pose in LOOK[id].h;
const KIND = {
  vine: { word: "THWACK!", cue: "whip", spark: ["#eaffd8", "#7ee05a"] },
  star: {
    word: "KA-BOOM!",
    cue: "zap",
    spark: ["#fff6c8", "#ffb02e", "#ff7a1f"]
  },
  jet: {
    word: "SPLASH!",
    cue: "splash",
    spark: ["#e8fbff", "#5fd0ff", "#1f8bff"]
  },
  orb: { word: "VOOM!", cue: "orb", spark: ["#e2ecff", "#6f9bff", "#2c4fd6"] },
  dash: {
    word: "WHAM!",
    cue: "whoosh",
    spark: ["#ffffff", "#a8c8ff", "#ffd36b"]
  }
};

// ---------- data ----------
const IMG = {};
const FX = {},
  LOADOUTS = {};
let ELEMENTS = {};
const eventKit = (e) => (e.kit ? FX[e.actorId]?.[e.kit] : undefined);
const sheetFrame = (im, index, sheet) => ({
  sx: ((index % sheet.cols) * im.width) / sheet.cols,
  sy: (Math.floor(index / sheet.cols) * im.height) / sheet.rows,
  sw: im.width / sheet.cols,
  sh: im.height / sheet.rows
});
let T = null,
  CH = null,
  SCENES = [],
  DURATION = 0,
  CUES = [];

async function loadAssets(base = "assets/") {
  const get = async (n) => (await fetch(base + n)).json();
  [T, CH] = await Promise.all([
    get("tournament.json"),
    get("choreography.json")
  ]);
  const fighters = await get("fighters.json");
  const manifest = await get("sprites.json");
  const expected = {};
  const digest = async (bytes) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const canonical = (v) =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
            .join(",")}}`
        : JSON.stringify(v);
  if (Object.values(fighters).some((f) => f.manifest.kits?.length)) {
    const palettes = await get("kit-palettes.json");
    if (
      (await digest(new TextEncoder().encode(palettes.style))) !==
        palettes.lock.files["style.json"] ||
      (await digest(
        new TextEncoder().encode(canonical(palettes.lock.files))
      )) !== palettes.lock.sha256
    )
      throw new Error("Kit palette recipe changed");
    ELEMENTS = JSON.parse(palettes.style).kits.elements;
    for (const f of Object.values(fighters))
      if (
        f.manifest.kits?.length &&
        f.manifest.recipe?.sha256 !== palettes.lock.sha256
      )
        throw new Error("Fighter kit recipe differs from palette recipe");
  }
  for (const id of Object.keys(T.fighters)) {
    const { manifest: m, manifestHash } = fighters[id];
    if (
      `0x${await digest(new TextEncoder().encode(canonical(m)))}` !==
      manifestHash
    )
      throw new Error("Fighter manifest changed");
    LOOK[id] = {
      ...m.look.palette,
      kind: m.look.attackKind,
      defFace: m.look.face,
      face: {},
      h: { ...m.look.stageHeight },
      origin: m.look.origin,
      torso: m.look.torso
    };
    FX[id] = Object.fromEntries((m.kits ?? []).map((k) => [k.id, { ...k }]));
    const chosen =
      fighters[id].loadout ??
      m.defaultLoadout ??
      (m.kits ?? []).map((k) => k.id);
    if (
      new Set(chosen).size !== chosen.length ||
      chosen.some((kit) => !FX[id][kit])
    )
      throw new Error("Fighter loadout changed");
    LOADOUTS[id] = chosen.map((kit) => FX[id][kit]);
    for (const [pose, s] of Object.entries(m.sprites))
      expected[`${id}-${pose}`] = s.sha256;
    for (const k of Object.values(FX[id])) {
      const pose = `windup-${k.id}`;
      LOOK[id].h[pose] ??= k.windup.h;
      LOOK[id].face[pose] = m.look.face;
      k.hue =
        hue(LOOK[id].color) - hue(ELEMENTS[k.element]?.color ?? LOOK[id].color);
      expected[`${id}-${pose}`] = k.windup.sha256;
      for (const role of ["projectile", "strike", "impact"]) {
        if (!k[role]) continue;
        const key = `${id}-kit-${k.id}-${role}`;
        expected[key] = k[role].sha256;
        k[role] = { ...k[role], asset: key };
      }
    }
  }
  const need = ["bg-arena"];
  for (const id of Object.keys(T.fighters)) {
    for (const p of Object.keys(LOOK[id].h)) need.push(`${id}-${p}`);
    need.push(`${id}-cutin`);
  }
  need.push(...Object.keys(expected).filter((key) => key.includes("-kit-")));
  await Promise.all(
    need.map(async (n) => {
      const asset = manifest[n];
      if (!asset || !/^[a-zA-Z0-9_.-]+$/.test(asset.file))
        throw new Error("Invalid sprite path");
      const response = await fetch(base + asset.file);
      if (!response.ok) throw new Error("Missing sprite");
      const bytes = await response.arrayBuffer();
      if ((await digest(bytes)) !== asset.sha256)
        throw new Error("Sprite changed");
      if (n !== "bg-arena") {
        if (expected[n] !== asset.sha256)
          throw new Error("Sprite differs from fighter manifest");
      }
      const url = URL.createObjectURL(new Blob([bytes]));
      try {
        const im = new Image();
        im.src = url;
        await im.decode();
        IMG[n] = im;
        if (n.includes("-kit-")) {
          const id = Object.keys(T.fighters).find((id) =>
            n.startsWith(id + "-kit-")
          );
          const k = Object.values(FX[id])
            .flatMap((k) => [k.projectile, k.strike, k.impact])
            .find((s) => s?.asset === n);
          if (
            !k ||
            !Number.isInteger(k.cols) ||
            !Number.isInteger(k.rows) ||
            k.cols < 1 ||
            k.rows < 1 ||
            k.cols > 4 ||
            k.rows > 4 ||
            im.width % k.cols ||
            im.height % k.rows
          )
            throw new Error("Kit sheet grid changed");
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    })
  );
  for (const [fam, file] of [
    ["Bangers", "Bangers.ttf"],
    ["Russo One", "RussoOne.ttf"]
  ]) {
    const ff = new FontFace(fam, `url(${base}${file})`);
    await ff.load();
    document.fonts.add(ff);
  }
  build();
}

// ---------- timeline ----------
const VS_D = 3.4,
  READY_D = 2.0,
  INTRO_D = 3.6,
  BRACKET_D = 3.8;

function buildMatch(m) {
  const c = CH[m.id];
  const M = {
    ...m,
    c,
    L: m.fighterIds[0],
    R: m.fighterIds[1],
    label: c.label,
    final: m.id === T.matches[T.matches.length - 1].id
  };
  M.events = m.events.map((e, i) => ({
    ...e,
    i,
    kind: c.kinds?.[e.id] || LOOK[e.actorId].kind,
    kit:
      resolveAnimeKit(
        e.attackName,
        c.kinds?.[e.id] || LOOK[e.actorId].kind,
        LOADOUTS[e.actorId],
        c.kits?.[e.id]
      )?.id ?? null,
    short: c.names?.[e.id] || e.attackName.toUpperCase(),
    end: e.outcome === "interrupted" ? m.verdictSeconds : e.contact,
    ko:
      (e.outcome === "hit" || e.outcome === "guarded") &&
      e.contact >= m.verdictSeconds - 1e-6
  }));
  // Battle seconds per film second: half speed, quarter speed around releases and impacts.
  const marks = M.events.flatMap((e) => [e.release, e.end]);
  const speed = (b) => {
    if (b >= m.verdictSeconds) return b < m.settledSeconds ? 0.3 : 0.55;
    return marks.some((k) => Math.abs(b - k) < 0.12) ? 0.24 : 0.5;
  };
  const freezes = [
    ...c.cutins.map((ci) => ({
      b: ci.at,
      dur:
        Math.max(
          3.0,
          READ(ci.title || ""),
          ...Object.values(ci.quotes || { one: ci.quote || "" }).map((q) =>
            READ(q)
          )
        ) + 0.6,
      kind: "cutin",
      ci
    })),
    { b: m.verdictSeconds, dur: 1.2, kind: "ko" },
    ...M.events
      .filter((e) => ["hit", "guarded"].includes(e.outcome) && !e.ko)
      .map((e) => ({
        b: e.contact,
        dur: e.outcome === "hit" ? 0.14 : 0.08,
        kind: "hitstop"
      }))
  ].sort((a, z) => a.b - z.b);
  const bEnd = m.settledSeconds + 0.8,
    step = 0.005;
  const fa = [],
    ba = [],
    segs = [
      { f0: 0, f1: VS_D, kind: "vs" },
      { f0: VS_D, f1: VS_D + READY_D, kind: "ready" }
    ];
  let f = VS_D + READY_D,
    fi = 0;
  for (let k = 0; k * step <= bEnd + 1e-9; k++) {
    const b = k * step;
    while (fi < freezes.length && freezes[fi].b <= b + 1e-9) {
      const z = freezes[fi++];
      fa.push(f);
      ba.push(z.b);
      segs.push({ f0: f, f1: f + z.dur, kind: z.kind, ci: z.ci });
      f += z.dur;
    }
    fa.push(f);
    ba.push(b);
    f += step / speed(b + step / 2);
  }
  M.fa = fa;
  M.ba = ba;
  M.bEnd = bEnd;
  M.fight0 = VS_D + READY_D;
  M.fight1 = fa[fa.length - 1];
  const resultD = Math.max(M.final ? 7.0 : 5.4, READ(c.result) + 2.5);
  segs.push({ f0: M.fight1, f1: M.fight1 + resultD, kind: "result" });
  M.segs = segs;
  M.dur = M.fight1 + resultD;
  for (const e of M.events) {
    e.fStart = fOf(M, e.start);
    e.fRelease = fOf(M, e.release);
    e.fEnd = fOf(M, e.end);
    e.fDefStart = e.defense !== "none" ? fOf(M, e.defenseStart) : 0;
    e.fDefEnd = e.defense !== "none" ? fOf(M, e.defenseEnd) : 0;
  }
  M.fKo = fOf(M, m.verdictSeconds);
  M.fKoEnd = segs.find((s) => s.kind === "ko").f1;
  M.fSettled = fOf(M, m.settledSeconds);
  // callouts: each holds long enough to read, and yields to the same fighter's next attack
  for (const e of M.events) {
    const next = M.events
      .filter((x) => x.actorId === e.actorId && x.start > e.start)
      .sort((a, z) => a.start - z.start)[0];
    e.calloutEnd = e.fStart + Math.max(2.0, READ(e.short) + 0.4);
  }
  return M;
}

function bAt(M, f) {
  if (f <= M.fight0) return 0;
  if (f >= M.fight1) return M.bEnd;
  let lo = 0,
    hi = M.fa.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (M.fa[mid] <= f) lo = mid;
    else hi = mid;
  }
  const span = M.fa[hi] - M.fa[lo];
  return span <= 0 ? M.ba[lo] : lerp(M.ba[lo], M.ba[hi], (f - M.fa[lo]) / span);
}
function fOf(M, b) {
  let lo = 0,
    hi = M.ba.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (M.ba[mid] < b - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && M.ba[lo] > b) {
    const t = (b - M.ba[lo - 1]) / (M.ba[lo] - M.ba[lo - 1]);
    return lerp(M.fa[lo - 1], M.fa[lo], t);
  }
  return M.fa[lo];
}
const segAt = (M, f) =>
  M.segs.find((s) => f >= s.f0 && f < s.f1) || {
    kind: "fight",
    f0: M.fight0,
    f1: M.fight1
  };

function build() {
  SCENES = [];
  CUES = [];
  let t = 0;
  const add = (s) => {
    s.f0 = t;
    t += s.dur;
    s.f1 = t;
    SCENES.push(s);
  };
  add({ kind: "intro", dur: INTRO_D });
  T.matches.forEach((m, i) => {
    add({ kind: "bracket", stage: i, dur: BRACKET_D });
    const M = buildMatch(m);
    add({ kind: "match", M, dur: M.dur });
  });
  DURATION = t;
  const cue = (at, type, gain = 1) =>
    CUES.push({ t: +at.toFixed(3), type, gain });
  cue(0.2, "title");
  for (const s of SCENES) {
    if (s.kind === "bracket") cue(s.f0 + 0.15, "whoosh", 0.7);
    if (s.kind !== "match") continue;
    const M = s.M,
      o = s.f0;
    cue(o + 0.05, "whoosh");
    cue(o + 0.55, "slam");
    cue(o + VS_D + 0.2, "ready");
    cue(o + VS_D + 1.2, "slam");
    for (const g of M.segs) if (g.kind === "cutin") cue(o + g.f0, "cutin");
    for (const e of M.events) {
      cue(o + e.fStart, "charge", 0.7);
      if (e.outcome === "interrupted") continue;
      cue(o + e.fRelease, KIND[e.kind].cue);
      if (e.outcome === "dodged") {
        cue(o + e.fDefStart, "whoosh", 0.9);
        cue(o + e.fEnd + 0.08, e.kind === "jet" ? "splash" : "fizzle", 0.6);
      }
      if (e.outcome === "hit" || e.outcome === "guarded")
        cue(
          o + e.fEnd,
          e.ko ? "ko" : e.outcome === "guarded" ? "guard" : "impact"
        );
    }
    cue(o + M.fSettled, "thud");
    cue(o + M.fight1, "fanfare", M.final ? 1 : 0.6);
  }
  CUES.sort((a, b) => a.t - b.t);
}

// ---------- combat state ----------
function hpAt(M, id, b) {
  let hp = T.initialHealth;
  for (const e of M.events)
    if (e.targetId === id && b >= e.contact) {
      if (e.outcome === "hit") hp -= T.damage[e.attackClass];
      if (e.outcome === "guarded") hp -= T.damage[e.attackClass] / 2;
    }
  return Math.max(0, hp);
}
const baseX = (M, id, b) => {
  const c = M.c.pos[id];
  return c?.x ? keys(b, c.x) : id === M.L ? 380 : 900;
};

function stage(M, id, b, f) {
  const c = M.c.pos[id] || {},
    fly = T.fighters[id].locomotion === "flight",
    isL = id === M.L;
  const s = {
    id,
    fly,
    x: baseX(M, id, b),
    depth: c.depth ? keys(b, c.depth) : 0,
    face: c.face ? stepKeys(b, c.face) : isL ? 1 : -1,
    rot: c.rot ? keys(b, c.rot) : 0,
    pose: "idle",
    sx: 1,
    sy: 1
  };
  const baseY = (bb) =>
    (fly ? (c.y ? keys(bb, c.y) : 415) : GROUND) +
    (c.depth ? keys(bb, c.depth) : 0);
  s.y = baseY(b);
  if (fly) {
    s.y += Math.sin(f * 3.1 + (isL ? 1.3 : 0)) * 7;
    s.sy = 1 + Math.sin(f * 6.2 + (isL ? 2 : 0)) * 0.02;
  } else s.sy = 1 + Math.sin(f * 4.2 + (isL ? 1 : 0)) * 0.012;
  for (const e of M.events)
    if (
      e.actorId === id &&
      win(b, e.start, e.outcome === "interrupted" ? e.end : e.recoveryUntil)
    ) {
      s.pose = e.kind === "dash" && has(id, "dash") ? "dash" : "attack";
      const pose = e.kit && `windup-${e.kit}`;
      if (b < e.release && pose && has(id, pose)) {
        s.pose = pose;
        s.x -= s.face * 10 * smooth((b - e.start) / (e.release - e.start));
      }
    }
  for (const e of M.events)
    if (
      e.targetId === id &&
      e.defense !== "none" &&
      win(b, e.defenseStart, e.defenseEnd + 0.05)
    ) {
      const p = (b - e.defenseStart) / (e.defenseEnd + 0.05 - e.defenseStart);
      if (e.defense === "dodge") {
        if (has(id, "dodge")) s.pose = "dodge";
        if (fly) s.rot += Math.sin(Math.PI * p) * 0.38 * s.face;
        else s.y -= Math.sin(Math.PI * p) * 16;
      }
      if (e.defense === "guard" && has(id, "guard")) s.pose = "guard";
    }
  for (const e of M.events)
    if (
      e.targetId === id &&
      (e.outcome === "hit" || e.outcome === "guarded") &&
      b >= e.contact
    ) {
      const age = b - e.contact,
        dir = Math.sign(s.x - baseX(M, e.actorId, e.contact)) || 1;
      s.x += dir * (e.outcome === "hit" ? 22 : 10) * easeOut(age / 0.15);
      if (e.outcome === "hit" && age < 0.16) s.pose = "hurt";
      if (e.outcome === "guarded" && age < 0.12) s.x += Math.sin(age * 120) * 4;
      if (fly && age < 0.35) s.rot -= dir * 0.3 * (1 - age / 0.35);
    }
  if (id === M.loserId && b >= M.verdictSeconds) {
    const p = clamp(
      (b - M.verdictSeconds) / (M.settledSeconds - M.verdictSeconds)
    );
    const dir = Math.sign(s.x - baseX(M, M.winnerId, M.verdictSeconds)) || 1;
    s.x += dir * easeOut(p / 0.35) * 30;
    if (!fly) {
      if (p < 0.35) {
        s.pose = "hurt";
        s.rot = -0.22 * s.face * (p / 0.35);
      } else {
        const q = (p - 0.35) / 0.65;
        s.pose = "down";
        s.y -= 70 * (1 - q) * (1 - q);
        s.rot = -0.25 * s.face * (1 - q);
      }
    } else {
      const y0 = baseY(M.verdictSeconds),
        floor = GROUND + (c.depth ? keys(M.verdictSeconds, c.depth) : 0);
      if (p < 0.8) {
        const q = p / 0.8;
        s.pose = "hurt";
        s.y = lerp(y0, floor - 30, q * q);
        s.rot = -s.face * 1.1 * q;
      } else {
        const q = (p - 0.8) / 0.2;
        s.pose = "down";
        s.y = floor - 40 * (1 - q) * (1 - q);
        s.rot = 0;
      }
      s.sy = 1;
    }
  }
  if (!has(id, s.pose)) s.pose = "idle";
  return s;
}

function origin(s) {
  const L = LOOK[s.id],
    h = L.h.attack;
  return { x: s.x + s.face * L.origin[0] * h, y: s.y - L.origin[1] * h };
}
function torso(s) {
  const L = LOOK[s.id],
    h = L.h.idle;
  return { x: s.x + s.face * L.torso[0] * h, y: s.y - L.torso[1] * h };
}

// ---------- camera ----------
function camRaw(M, f) {
  const seg = segAt(M, f);
  if (seg.kind === "vs") return { cx: 640, cy: 380, zoom: 1.05 };
  const b = bAt(M, f),
    A = stage(M, M.L, b, f),
    B = stage(M, M.R, b, f),
    ta = torso(A),
    tb = torso(B);
  let cx = (ta.x + tb.x) / 2,
    cy = (ta.y + tb.y) / 2 + 40;
  let zoom =
    seg.kind === "ready"
      ? 1.02
      : clamp(1.6 - Math.abs(ta.x - tb.x) / 850, 1.05, 1.42);
  let wx = 0,
    wy = 0,
    ws = 0;
  for (const e of M.events) {
    const actor = e.actorId === M.L ? ta : tb,
      target = e.actorId === M.L ? tb : ta;
    const wa = bump(b, e.start, e.release, 0.12) * 0.3,
      wt = bump(b, e.release + 0.05, e.end + 0.15, 0.08) * 0.35;
    wx += actor.x * wa + target.x * wt;
    wy += actor.y * wa + target.y * wt;
    ws += wa + wt;
  }
  if (b >= M.verdictSeconds) {
    const lt = M.loserId === M.L ? ta : tb,
      w = 0.7 * (1 - smooth((b - M.settledSeconds) / 0.6));
    wx += lt.x * w;
    wy += (lt.y + 40) * w;
    ws += w;
    zoom += 0.25 * w;
  }
  if (ws > 0) {
    const k = Math.min(ws, 0.8);
    cx = lerp(cx, wx / ws, k);
    cy = lerp(cy, wy / ws, k * 0.6);
    zoom += 0.12 * Math.min(ws, 1);
  }
  return { cx, cy, zoom };
}
function camera(M, f) {
  let cx = 0,
    cy = 0,
    zoom = 0;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const c = camRaw(M, f + (i / (n - 1) - 0.5) * 0.7);
    cx += c.cx;
    cy += c.cy;
    zoom += c.zoom;
  }
  cx /= n;
  cy /= n;
  zoom /= n;
  for (const e of M.events)
    if (e.outcome !== "interrupted") {
      const age = f - e.fRelease;
      if (age >= 0 && age < 0.25) zoom *= 1 + 0.07 * (1 - age / 0.25) ** 2;
    }
  const hw = 640 / zoom,
    hh = 360 / zoom;
  return {
    cx: clamp(cx, -120 + hw, 1400 - hw),
    cy: clamp(cy, -47 + hh, 808 - hh),
    zoom
  };
}
function shake(M, f) {
  let a = 0;
  for (const e of M.events)
    if (e.outcome === "hit" || e.outcome === "guarded") {
      const age = f - e.fEnd;
      if (age >= 0 && age < 0.7)
        a +=
          (e.ko ? 26 : e.outcome === "hit" ? 16 : 8) *
          Math.pow(1 - age / 0.7, 2);
    }
  const st = f - (VS_D + 1.2);
  if (st >= 0 && st < 0.35) a += 10 * (1 - st / 0.35);
  return {
    x: (R(Math.floor(f * 60)) - 0.5) * 2 * a,
    y: (R(Math.floor(f * 60) + 7) - 0.5) * 2 * a
  };
}
const toScreen = (cam, p) => ({
  x: (p.x - cam.cx) * cam.zoom + W / 2,
  y: (p.y - cam.cy) * cam.zoom + H / 2
});

// ---------- drawing primitives ----------
function sprite(ctx, name, x, y, o = {}) {
  const im = IMG[name],
    id = Object.keys(LOOK).find((id) => name.startsWith(id + "-")),
    pose = name.slice(id.length + 1);
  const h = (o.h || LOOK[id]?.h[pose] || 250) * (o.scale || 1),
    w = (im.width / im.height) * h;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot || 0);
  ctx.scale(o.sx || 1, o.sy || 1);
  if (o.flip) ctx.scale(-1, 1);
  ctx.globalAlpha *= o.alpha ?? 1;
  if (o.filter) ctx.filter = o.filter;
  ctx.drawImage(im, -w / 2, -h, w, h);
  ctx.restore();
}
const spriteFace = (id, pose) => LOOK[id].face[pose] ?? LOOK[id].defFace;
function hue(hex) {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255
  );
  const max = Math.max(r, g, b),
    delta = max - Math.min(r, g, b);
  if (!delta) return 0;
  return (
    ((max === r
      ? (g - b) / delta
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4) *
      60 +
      360) %
    360
  );
}
function paintedFrame(ctx, sheet, frame, x, y, width, height) {
  const im = IMG[sheet.asset],
    rect = sheetFrame(im, frame, sheet);
  ctx.drawImage(im, rect.sx, rect.sy, rect.sw, rect.sh, x, y, width, height);
}
function shadow(ctx, x, y, w, a) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "#1d3b4a";
  ctx.beginPath();
  ctx.ellipse(x, y, w, w * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function star(ctx, x, y, r, rot, fill, stroke) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r,
      a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.restore();
}
function glow(ctx, x, y, r, color, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = clamp(a);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function text(ctx, str, x, y, size, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot || 0);
  ctx.scale(o.scale || 1, o.scale || 1);
  ctx.font = `${size}px ${o.font === "Russo One" ? "'Russo One'" : o.font || "Bangers"}`;
  ctx.textAlign = o.align || "center";
  ctx.textBaseline = "middle";
  if (o.maxWidth && ctx.measureText(str).width > o.maxWidth) {
    size *= o.maxWidth / ctx.measureText(str).width;
    ctx.font = `${size}px ${o.font === "Russo One" ? "'Russo One'" : o.font || "Bangers"}`;
  }
  ctx.globalAlpha *= clamp(o.alpha ?? 1);
  if (o.italic) ctx.transform(1, 0, -0.18, 1, 0, 0);
  ctx.lineJoin = "round";
  if (o.outer) {
    ctx.lineWidth = size * 0.32;
    ctx.strokeStyle = o.outer;
    ctx.strokeText(str, 0, 0);
  }
  ctx.lineWidth = size * (o.font === "Russo One" ? 0.18 : 0.14);
  ctx.strokeStyle = o.stroke || "#1a1030";
  ctx.strokeText(str, 0, 0);
  if (o.gradient) {
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    o.gradient.forEach((c, i) =>
      g.addColorStop(i / (o.gradient.length - 1), c)
    );
    ctx.fillStyle = g;
  } else ctx.fillStyle = o.fill || "#fff";
  ctx.fillText(str, 0, 0);
  ctx.restore();
}
function focusLines(ctx, cx, cy, f, color, n = 70, inner = 260) {
  ctx.save();
  ctx.fillStyle = color;
  const fr = Math.floor(f * 15);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R(fr * 131 + i) * 0.08,
      w = 0.004 + R(fr * 17 + i) * 0.012,
      r0 = inner + R(fr * 7 + i) * 120;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a - w) * 1500, cy + Math.sin(a - w) * 1500);
    ctx.lineTo(cx + Math.cos(a + w) * 1500, cy + Math.sin(a + w) * 1500);
    ctx.fill();
  }
  ctx.restore();
}
function speedLinesH(ctx, f, alpha) {
  ctx.save();
  const fr = Math.floor(f * 15);
  for (let i = 0; i < 40; i++) {
    const y = R(fr * 3 + i) * H,
      len = 200 + R(fr + i * 9) * 500,
      x = ((R(i * 5) * 2000 + f * 3000) % 2200) - 400;
    ctx.globalAlpha = alpha * (0.3 + R(i) * 0.7);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, len, 1 + R(i * 3) * 3);
  }
  ctx.restore();
}
function sparks(
  ctx,
  x,
  y,
  age,
  seed,
  n,
  colors,
  speed = 520,
  life = 0.6,
  grav = 600
) {
  if (age < 0 || age > life) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const a = R(seed + i) * Math.PI * 2,
      v = speed * (0.35 + R(seed + i * 3) * 0.8),
      l = life * (0.5 + R(seed + i * 7) * 0.5);
    if (age > l) continue;
    const px = x + Math.cos(a) * v * age,
      py = y + Math.sin(a) * v * age + grav * age * age,
      t = age / l,
      sz = (1 - t) * (3 + R(seed + i * 11) * 6);
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.moveTo(px - Math.cos(a) * sz * 3, py - Math.sin(a) * sz * 3);
    ctx.lineTo(px + sz, py);
    ctx.lineTo(px, py + sz);
    ctx.fill();
  }
  ctx.restore();
}
function leaves(ctx, x, y, age, seed, n) {
  if (age < 0 || age > 1.1) return;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const a = R(seed + i) * Math.PI * 2,
      v = 160 + R(seed + i * 3) * 300;
    ctx.globalAlpha = 1 - age / 1.1;
    ctx.fillStyle = i % 2 ? "#7ee05a" : "#3fae3a";
    ctx.save();
    ctx.translate(
      x + Math.cos(a) * v * age + Math.sin(age * 6 + i) * 12,
      y + Math.sin(a) * v * age + 260 * age * age
    );
    ctx.rotate(age * 8 + i);
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
function droplets(ctx, x, y, age, seed, n) {
  if (age < 0 || age > 0.9) return;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * (0.1 + R(seed + i) * 0.8),
      v = 180 + R(seed + i * 3) * 320;
    ctx.globalAlpha = 0.9 * (1 - age / 0.9);
    ctx.fillStyle = i % 3 ? "#7fd8ff" : "#ffffff";
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(a) * v * age,
      y + Math.sin(a) * v * age + 700 * age * age,
      3 + R(seed + i * 5) * 5,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}
function dust(ctx, x, y, age, seed, n = 9) {
  if (age < 0 || age > 0.9) return;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1,
      v = 90 + R(seed + i) * 140,
      r = 14 + age * 50 * (0.6 + R(seed + i * 2) * 0.6);
    ctx.globalAlpha = 0.55 * (1 - age / 0.9);
    ctx.fillStyle = "#efe2c4";
    ctx.beginPath();
    ctx.arc(
      x + dir * v * age * (1 - age * 0.5),
      y - 10 - R(seed + i * 5) * 30 * age,
      r,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

// ---------- attacks ----------
const isProjectile = (e) =>
  e.kind === "star" || e.kind === "orb" || !!eventKit(e)?.projectile;
function shotPath(M, e, f) {
  const from = origin(stage(M, e.actorId, e.release, f));
  const to = torso(
    stage(M, e.targetId, e.outcome === "dodged" ? e.defenseStart : e.contact, f)
  );
  return { from, to };
}
function drawProjectile(ctx, M, e, b, f) {
  if (b < e.release || e.outcome === "interrupted") return;
  const p = (b - e.release) / (e.contact - e.release),
    over = e.outcome === "dodged" ? 0.12 : 0;
  if (p > 1 + over) return;
  const { from, to } = shotPath(M, e, f);
  const pos = (q) => ({
    x: lerp(from.x, to.x, q),
    y: lerp(from.y, to.y, q) - Math.sin(Math.PI * clamp(q)) * 24
  });
  const orb = e.kind === "orb",
    r = /burst/i.test(e.attackName) ? 34 : 26;
  const kit = eventKit(e);
  for (let k = 14; k >= 1; k--) {
    const q = p - k * 0.03;
    if (q < 0) continue;
    const pt = pos(q);
    glow(
      ctx,
      pt.x,
      pt.y,
      r * (1.6 - k * 0.07),
      orb ? "rgba(90,140,255,0.6)" : "rgba(255,190,60,0.55)",
      (1 - k / 15) * (kit?.projectile ? 0.25 : 0.7)
    );
  }
  const pt = pos(p);
  if (kit?.projectile) {
    const sheet = kit.projectile,
      size = (150 * r) / 26;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.92;
    ctx.filter = `hue-rotate(${kit.hue}deg)`;
    ctx.translate(pt.x, pt.y);
    if (to.x > from.x) ctx.scale(-1, 1);
    paintedFrame(
      ctx,
      sheet,
      Math.floor(f * 14) % (sheet.cols * sheet.rows),
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
    return;
  }
  if (orb) {
    glow(ctx, pt.x, pt.y, r * 3.2, "rgba(120,170,255,0.9)");
    ctx.save();
    ctx.fillStyle = "#1d3fb8";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7fb0ff";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(
        pt.x,
        pt.y,
        r * (0.35 + i * 0.22),
        f * 9 + i * 2,
        f * 9 + i * 2 + 2.2
      );
      ctx.stroke();
    }
    ctx.restore();
  } else {
    glow(ctx, pt.x, pt.y, r * 3.2, "rgba(255,220,120,0.9)");
    star(ctx, pt.x, pt.y, r, f * 9, "#fff6c8", "#ff9a1f");
    star(ctx, pt.x, pt.y, r * 0.55, -f * 12, "#ffffff");
  }
}
function stroked(ctx, pts, layers) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [width, color] of layers) {
    ctx.strokeStyle = color;
    for (let i = 1; i < pts.length; i++) {
      ctx.lineWidth = width * (1 - (i / pts.length) * 0.55);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }
}
function drawVine(ctx, M, e, b, f) {
  if (b < e.release || e.outcome === "interrupted") return;
  const from = origin(stage(M, e.actorId, b, f));
  let to = torso(
    stage(
      M,
      e.targetId,
      e.outcome === "dodged" ? e.defenseStart : Math.min(b, e.contact),
      f
    )
  );
  if (e.outcome === "dodged") to = { x: to.x, y: to.y + 70 };
  const ext = clamp((b - e.release) / (e.contact - e.release)),
    ret = clamp((b - e.contact) / Math.max(0.12, e.recoveryUntil - e.contact));
  const reach = ext * (1 - smooth(ret));
  if (reach <= 0.01) return;
  const kit = eventKit(e);
  if (kit?.strike) {
    const sheet = kit.strike,
      im = IMG[sheet.asset],
      dist = Math.hypot(to.x - from.x, to.y - from.y) * 1.08;
    const frame =
      ret > 0 || ext < 0.85 ? 0 : Math.min(2, sheet.cols * sheet.rows - 1);
    const rect = sheetFrame(im, frame, sheet),
      height = ((dist * rect.sh) / rect.sw) * 1.3;
    ctx.save();
    ctx.translate(from.x, from.y);
    ctx.rotate(Math.atan2(to.y - from.y, to.x - from.x));
    ctx.beginPath();
    ctx.rect(-10, -height, dist * reach + 10, height * 2);
    ctx.clip();
    ctx.filter = `hue-rotate(${kit.hue}deg) brightness(.25)`;
    for (const [x, y] of [
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3]
    ])
      paintedFrame(ctx, sheet, frame, x, -height / 2 + y, dist, height);
    ctx.filter = `hue-rotate(${kit.hue}deg)`;
    paintedFrame(ctx, sheet, frame, 0, -height / 2, dist, height);
    ctx.restore();
    return;
  }
  const mx = lerp(from.x, to.x, 0.5),
    my = Math.min(from.y, to.y) - 110,
    pts = [];
  for (let i = 0; i <= 34; i++) {
    const q = (i / 34) * reach;
    pts.push({
      x: (1 - q) ** 2 * from.x + 2 * (1 - q) * q * mx + q * q * to.x,
      y:
        (1 - q) ** 2 * from.y +
        2 * (1 - q) * q * my +
        q * q * to.y +
        Math.sin(q * 14 - f * 22) * 14 * (1 - ext * 0.6) * q
    });
  }
  ctx.save();
  stroked(ctx, pts, [
    [24, "#173d12"],
    [16, "#3cab36"],
    [6, "#9cf07a"]
  ]);
  for (let i = 4; i < pts.length; i += 5) {
    const p = pts[i],
      q = pts[i - 1],
      a = Math.atan2(p.y - q.y, p.x - q.x) + (i % 10 ? 1.1 : -1.1);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a);
    ctx.fillStyle = "#4fc240";
    ctx.strokeStyle = "#173d12";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(10, 0, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  if (ext < 1)
    glow(
      ctx,
      pts[pts.length - 1].x,
      pts[pts.length - 1].y,
      40,
      "rgba(180,255,140,0.8)"
    );
  ctx.restore();
}
function jetTarget(M, e, f) {
  const tg = stage(
    M,
    e.targetId,
    e.outcome === "dodged" ? e.defenseStart : e.contact,
    f
  );
  // a dodged jet splashes the vacated line on the floor
  return e.outcome === "dodged"
    ? { x: tg.x, y: GROUND + tg.depth - 12 }
    : torso(tg);
}
function drawJet(ctx, M, e, b, f) {
  if (b < e.release || e.outcome === "interrupted") return;
  const from = origin(stage(M, e.actorId, Math.min(b, e.contact), f)),
    to = jetTarget(M, e, f);
  const ext = clamp((b - e.release) / (e.contact - e.release)),
    fade = clamp((b - e.contact - 0.08) / 0.25);
  if (fade >= 1) return;
  const tail = smooth(fade),
    pts = [];
  for (let i = 0; i <= 30; i++) {
    const q = lerp(tail, 1, i / 30) * ext;
    pts.push({
      x: lerp(from.x, to.x, q),
      y:
        lerp(from.y, to.y, q) -
        Math.sin(Math.PI * q) * 22 +
        Math.sin(q * 30 - f * 40) * 5 * q
    });
  }
  ctx.save();
  ctx.globalAlpha = 1 - fade * 0.3;
  stroked(ctx, pts, [
    [30, "#0f4fa8"],
    [22, "#2fa8ff"],
    [10, "#bff0ff"],
    [3, "#ffffff"]
  ]);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 16; i++) {
    const p =
      pts[Math.floor(R(e.i * 40 + i + Math.floor(f * 20)) * pts.length)];
    ctx.fillStyle = "rgba(220,250,255,0.8)";
    ctx.beginPath();
    ctx.arc(
      p.x + (R(i + f) - 0.5) * 26,
      p.y + (R(i * 3 + f) - 0.5) * 26,
      2 + R(i) * 3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}
function drawPuddles(ctx, M, b) {
  for (const e of M.events)
    if (e.kind === "jet" && e.outcome !== "interrupted" && b >= e.contact) {
      const tg = stage(
        M,
        e.targetId,
        e.outcome === "dodged" ? e.defenseStart : e.contact,
        0
      );
      const x = e.outcome === "dodged" ? tg.x : tg.x - tg.face * 50,
        y = GROUND + tg.depth + 6,
        g = easeOut((b - e.contact) / 0.3);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#4fb8ff";
      ctx.beginPath();
      ctx.ellipse(x, y, 80 * g, 15 * g, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#dff6ff";
      ctx.beginPath();
      ctx.ellipse(x - 18 * g, y - 3, 26 * g, 4 * g, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
}
function drawCharge(ctx, M, e, b, f) {
  if (
    !win(b, e.start, e.outcome === "interrupted" ? e.end : e.release) ||
    e.kind === "dash"
  )
    return;
  const s = stage(M, e.actorId, b, f),
    at = origin(s),
    p = (b - e.start) / (e.release - e.start),
    L = LOOK[e.actorId];
  glow(ctx, at.x, at.y, 20 + p * 60, L.light, 0.6 + p * 0.4);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i++) {
    const a = R(e.i * 50 + i) * Math.PI * 2,
      ph = (f * 1.8 + R(i * 3)) % 1,
      rr = (1 - ph) * 110;
    ctx.globalAlpha = ph * 0.9;
    ctx.fillStyle = L.light;
    ctx.beginPath();
    ctx.arc(
      at.x + Math.cos(a) * rr,
      at.y + Math.sin(a) * rr,
      2 + ph * 3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

// ---------- fighters ----------
function drawFighter(ctx, M, s, b, f, seg) {
  const id = s.id,
    name = `${id}-${s.pose}`,
    flip = spriteFace(id, s.pose) !== s.face;
  const ghost = (bb, alpha, filter) => {
    const g = stage(M, id, bb, f);
    sprite(ctx, `${id}-${g.pose}`, g.x, g.y, {
      rot: g.rot,
      flip: spriteFace(id, g.pose) !== g.face,
      alpha,
      filter
    });
  };
  for (const e of M.events) {
    if (
      e.targetId === id &&
      e.defense === "dodge" &&
      win(b, e.defenseStart, e.defenseEnd + 0.12)
    )
      for (let k = 3; k >= 1; k--)
        ghost(b - k * 0.045, 0.18 * (4 - k), "brightness(1.7) saturate(0.6)");
    if (
      e.actorId === id &&
      e.kind === "dash" &&
      e.outcome !== "interrupted" &&
      win(b, e.release - 0.05, e.contact + 0.12)
    )
      for (let k = 4; k >= 1; k--)
        ghost(b - k * 0.03, 0.14 * (5 - k), "brightness(1.5)");
  }
  let alpha = 1;
  if (seg.kind === "result" && id === M.winnerId)
    alpha = 1 - smooth((f - seg.f0) / 0.3);
  const onFloor = !s.fly || s.pose === "down";
  shadow(
    ctx,
    s.x,
    onFloor ? GROUND + s.depth + 4 : 560 + s.depth,
    onFloor ? 95 : Math.max(30, 70 - (560 - s.y) * 0.05),
    (onFloor ? 0.28 : 0.18) * alpha
  );
  const sc = 1 + s.depth * 0.002;
  for (const e of M.events)
    if (
      e.actorId === id &&
      e.outcome !== "interrupted" &&
      win(f, e.fRelease, e.fRelease + 2 / FPS)
    ) {
      sprite(ctx, `${id}-attack`, s.x - s.face * 40, s.y, {
        rot: s.rot,
        sx: 1.45,
        sy: 0.96,
        flip: spriteFace(id, "attack") !== s.face,
        scale: sc,
        alpha: 0.45 * alpha
      });
    }
  sprite(ctx, name, s.x, s.y, {
    rot: s.rot,
    sx: s.sx,
    sy: s.sy,
    flip,
    scale: sc,
    alpha
  });
  for (const e of M.events)
    if (e.targetId === id && (e.outcome === "hit" || e.outcome === "guarded")) {
      const age = f - e.fEnd;
      if (age >= 0 && age < 0.18 && Math.floor(age * 30) % 2 === 0)
        sprite(ctx, name, s.x, s.y, {
          rot: s.rot,
          sx: s.sx,
          sy: s.sy,
          flip,
          scale: sc,
          filter: "brightness(3) saturate(0)",
          alpha: 0.85 * alpha
        });
    }
}

function drawImpacts(ctx, M, b, f) {
  for (const e of M.events) {
    if (e.outcome === "hit" || e.outcome === "guarded") {
      const age = f - e.fEnd,
        tg = stage(M, e.targetId, e.contact, e.fEnd),
        t = torso(tg),
        K = KIND[e.kind],
        guard = e.outcome === "guarded";
      const kit = eventKit(e);
      if (age >= 0 && age < 0.35) {
        ctx.save();
        ctx.globalAlpha = 1 - age / 0.35;
        ctx.strokeStyle = guard ? "#bfe6ff" : "#fff";
        ctx.lineWidth = 10 * (1 - age / 0.35);
        ctx.beginPath();
        ctx.arc(
          t.x,
          t.y,
          30 + age * (e.ko ? 900 : guard ? 300 : 600),
          0,
          Math.PI * 2
        );
        ctx.stroke();
        ctx.restore();
        glow(
          ctx,
          t.x,
          t.y,
          e.ko ? 260 : guard ? 120 : 170,
          K.spark[0],
          1 - age / 0.35
        );
      }
      if (guard && age >= 0 && age < 0.5) {
        // hex shield flash on the braced side
        ctx.save();
        ctx.globalAlpha = 0.8 * (1 - age / 0.5);
        ctx.strokeStyle = "#9fe0ff";
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.lineTo(t.x + Math.cos(a) * 70, t.y + Math.sin(a) * 70);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
      sparks(
        ctx,
        t.x,
        t.y,
        age,
        e.i * 997 + M.id.length,
        e.ko ? 46 : guard ? 16 : 30,
        K.spark,
        e.ko ? 820 : 600,
        0.7,
        500
      );
      if (e.kind === "vine") leaves(ctx, t.x, t.y, age, e.i * 31, 16);
      if (e.kind === "jet") droplets(ctx, t.x, t.y, age, e.i * 13, 26);
      if (!tg.fly) dust(ctx, tg.x, GROUND + tg.depth, age, e.i * 7, 8);
      if (kit?.impact && age >= 0 && age < 0.3) {
        const sheet = kit.impact,
          size = e.ko ? 420 : 300;
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(R(e.i * 53 + 3) * Math.PI * 2);
        ctx.globalCompositeOperation = "lighter";
        ctx.filter = `hue-rotate(${kit.hue}deg)`;
        ctx.globalAlpha = age > 0.225 ? 1 - (age - 0.225) / 0.075 : 1;
        paintedFrame(
          ctx,
          sheet,
          Math.min(sheet.cols * sheet.rows - 1, Math.floor(age / 0.075)),
          -size / 2,
          -size / 2,
          size,
          size
        );
        ctx.restore();
      }
    }
    if (e.outcome === "dodged") {
      const endB =
          e.contact + (e.contact - e.release) * (isProjectile(e) ? 0.12 : 0),
        age = f - fOf(M, endB);
      if (isProjectile(e)) {
        const { from, to } = shotPath(M, e, f);
        sparks(
          ctx,
          lerp(from.x, to.x, 1.12),
          lerp(from.y, to.y, 1.12),
          age,
          4242 + e.i,
          22,
          KIND[e.kind].spark,
          380,
          0.55,
          300
        );
      }
      if (e.kind === "jet") {
        const t = jetTarget(M, e, f);
        droplets(ctx, t.x, t.y, age, e.i * 17, 30);
      }
    }
  }
  const lz = stage(M, M.loserId, M.bEnd, f);
  dust(ctx, lz.x, GROUND + lz.depth, f - M.fSettled, 555, 12);
}

// ---------- HUD & texts ----------
function hud(ctx, M, f, b, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const bar = (id, x, dir) => {
    const hp = hpAt(M, id, b),
      lag = hpAt(M, id, bAt(M, Math.max(0, f - 0.6))),
      w = 470,
      L = LOOK[id],
      fw = (v) => (v / T.initialHealth) * (w - 30);
    ctx.save();
    ctx.translate(x, 34);
    ctx.fillStyle = "rgba(20,12,40,0.85)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dir * w, 0);
    ctx.lineTo(dir * (w - 18), 30);
    ctx.lineTo(0, 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff3b5c";
    ctx.fillRect(dir > 0 ? 8 : -8 - fw(lag), 7, fw(lag), 16);
    const g = ctx.createLinearGradient(0, 7, 0, 23);
    g.addColorStop(0, L.light);
    g.addColorStop(1, L.color);
    ctx.fillStyle = g;
    ctx.fillRect(dir > 0 ? 8 : -8 - fw(hp), 7, fw(hp), 16);
    ctx.restore();
    text(ctx, T.fighters[id].name.toUpperCase(), x + dir * 14, 84, 30, {
      maxWidth: 340,
      align: dir > 0 ? "left" : "right",
      font: "Russo One"
    });
    text(ctx, `${hp} HP`, x + dir * (w - 10), 84, 24, {
      align: dir > 0 ? "right" : "left",
      font: "Russo One",
      fill: hp < T.initialHealth ? "#ffd0d8" : "#fff"
    });
  };
  bar(M.L, 40, 1);
  bar(M.R, W - 40, -1);
  ctx.fillStyle = "rgba(20,12,40,0.85)";
  ctx.beginPath();
  ctx.arc(W / 2, 48, 34, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, b.toFixed(2), W / 2, 44, 22, { font: "Russo One" });
  text(ctx, "SEC", W / 2, 66, 12, { font: "Russo One", fill: "#ccc" });
  ctx.restore();
}
function callout(ctx, M, e, f) {
  const age = f - e.fStart,
    life = e.calloutEnd - e.fStart;
  if (age < 0 || age > life) return;
  const other = e.actorId === M.L ? M.R : M.L,
    left = baseX(M, e.actorId, e.start) < baseX(M, other, e.start);
  const inP = easeOut(age / 0.2),
    outP = smooth((age - life + 0.2) / 0.2),
    y = 642;
  const x = left
    ? lerp(-520, 40, inP) - outP * 640
    : lerp(W + 520, W - 40, inP) + outP * 640;
  ctx.save();
  ctx.font = "44px Bangers";
  const tw = ctx.measureText(e.short).width + 60;
  ctx.translate(x, y);
  ctx.transform(1, 0, -0.25, 1, 0, 0);
  ctx.fillStyle = LOOK[e.actorId].color;
  ctx.fillRect(left ? 0 : -tw, -32, tw, 64);
  ctx.fillStyle = "#1a1030";
  ctx.fillRect(left ? 0 : -tw, 26, tw, 6);
  ctx.restore();
  text(ctx, e.short, left ? x + 30 : x - 30, y - 2, 44, {
    align: left ? "left" : "right"
  });
}
function popups(ctx, M, f, cam) {
  for (const e of M.events) {
    if (e.outcome === "hit" || e.outcome === "guarded") {
      const age = f - e.fEnd;
      if (age < 0 || age > 1.6) continue;
      const tg = stage(M, e.targetId, e.contact, e.fEnd),
        t = toScreen(cam, torso(tg)),
        side = tg.x < baseX(M, e.actorId, e.contact) ? -1 : 1;
      const fade = 1 - smooth((age - 1.3) / 0.3),
        dmg =
          e.outcome === "hit"
            ? T.damage[e.attackClass]
            : T.damage[e.attackClass] / 2;
      if (!e.ko) {
        const word = e.outcome === "guarded" ? "GUARD!" : KIND[e.kind].word,
          grad =
            e.outcome === "guarded"
              ? ["#ffffff", "#9fe0ff"]
              : ["#fff7b0", LOOK[e.actorId].color];
        text(
          ctx,
          word,
          clamp(t.x + side * 40, 170, W - 170),
          clamp(t.y - 130 - age * 25, 150, H - 150),
          84,
          {
            scale: easeOutBack(age / 0.2),
            rot: side * 0.16,
            alpha: fade,
            gradient: grad,
            outer: "#fff"
          }
        );
      }
      text(
        ctx,
        `-${dmg}`,
        clamp(t.x, 80, W - 80),
        clamp(t.y - 40 - age * 70, 130, H - 100),
        58,
        { alpha: fade, fill: "#ff3b5c", stroke: "#fff" }
      );
    }
    if (e.outcome === "dodged") {
      const age = f - e.fDefEnd;
      if (age < 0 || age > 1.4) continue;
      const t = toScreen(cam, torso(stage(M, e.targetId, e.defenseEnd, f)));
      text(
        ctx,
        "DODGE!",
        clamp(t.x, 150, W - 150),
        clamp(t.y - 160, 150, H - 150),
        64,
        {
          scale: easeOutBack(age / 0.2),
          rot: -0.08,
          alpha: 1 - smooth((age - 1.1) / 0.3),
          gradient: ["#ffffff", "#7fe3ff"],
          outer: "#14324a"
        }
      );
    }
    if (e.outcome === "interrupted") {
      const label = `${e.short}: INTERRUPTED`,
        age = f - M.fKoEnd,
        life = READ(label) + 0.4;
      if (age < 0 || age > life) continue;
      const s = stage(M, e.actorId, M.verdictSeconds, f),
        t = toScreen(cam, { x: s.x, y: GROUND + s.depth });
      text(
        ctx,
        label,
        clamp(t.x, 300, W - 300),
        Math.min(t.y + 40, H - 120),
        32,
        {
          font: "Russo One",
          alpha: smooth(age / 0.15) * (1 - smooth((age - life + 0.3) / 0.3))
        }
      );
    }
  }
}

// ---------- overlays ----------
function letterbox(ctx, a) {
  if (a <= 0) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, 70 * a);
  ctx.fillRect(0, H - 70 * a, W, 70 * a);
}
function band(ctx, img, age, y, h, fromLeft, color, name, line) {
  const inP = easeOut(age / 0.25),
    dx = (fromLeft ? -1 : 1) * (1 - inP) * W + (fromLeft ? 1 : -1) * age * 30;
  ctx.save();
  ctx.translate(dx, 0);
  ctx.beginPath();
  ctx.moveTo(-80, y + 30);
  ctx.lineTo(W + 80, y - 30);
  ctx.lineTo(W + 80, y + h - 30);
  ctx.lineTo(-80, y + h + 30);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.save();
  ctx.translate(0, -8);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(0, 8);
  ctx.fill();
  ctx.restore();
  ctx.clip();
  const sc = Math.max((W + 160) / img.width, (h + 80) / img.height) * 1.05;
  ctx.drawImage(
    img,
    W / 2 - (img.width * sc) / 2 + (fromLeft ? 1 : -1) * age * 20,
    y + h / 2 - (img.height * sc) / 2,
    img.width * sc,
    img.height * sc
  );
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(-100, y - 40, W + 200, h + 80);
  ctx.restore();
  const tx = fromLeft ? 60 + dx : W - 60 + dx;
  text(ctx, name, tx, y + h - 52, 66, {
    align: fromLeft ? "left" : "right",
    italic: true,
    gradient: ["#fff", color],
    outer: "#1a1030"
  });
  if (line) {
    ctx.save();
    ctx.font = "30px 'Russo One'";
    const lw = ctx.measureText(line).width + 36;
    ctx.restore();
    const ly = y + h - 116,
      lx = fromLeft ? tx - 6 : tx + 6,
      a = smooth((age - 0.25) / 0.2);
    ctx.save();
    ctx.globalAlpha *= a * 0.85;
    ctx.fillStyle = "#1a1030";
    ctx.fillRect(fromLeft ? lx : lx - lw, ly - 24, lw, 48);
    ctx.restore();
    text(ctx, line, fromLeft ? lx + 18 : lx - 18, ly, 30, {
      align: fromLeft ? "left" : "right",
      font: "Russo One",
      alpha: a
    });
  }
}
function drawCutin(ctx, M, seg, f) {
  const age = f - seg.f0,
    dur = seg.f1 - seg.f0,
    out = 1 - smooth((age - dur + 0.25) / 0.25),
    ci = seg.ci;
  ctx.save();
  ctx.globalAlpha = 0.6 * smooth(age / 0.15) * out;
  ctx.fillStyle = "#120a24";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = out;
  if (ci.type === "both") {
    focusLines(ctx, W / 2, H / 2, f, "rgba(255,255,255,0.3)", 50, 300);
    band(
      ctx,
      IMG[`${M.L}-cutin`],
      age,
      80,
      260,
      true,
      LOOK[M.L].color,
      T.fighters[M.L].name.toUpperCase(),
      ci.quotes[M.L]
    );
    band(
      ctx,
      IMG[`${M.R}-cutin`],
      age - 0.12,
      380,
      260,
      false,
      LOOK[M.R].color,
      T.fighters[M.R].name.toUpperCase(),
      ci.quotes[M.R]
    );
    if (age > 0.4)
      text(ctx, ci.title, W / 2, H / 2, 100, {
        scale: easeOutBack((age - 0.4) / 0.2),
        rot: -0.08,
        gradient: ["#fff", "#ffde59"],
        outer: "#1a1030"
      });
  } else {
    focusLines(ctx, W / 2, H / 2, f, "rgba(255,230,160,0.4)", 60, 260);
    band(
      ctx,
      IMG[`${ci.who}-cutin`],
      age,
      190,
      330,
      ci.who === M.L,
      LOOK[ci.who].color,
      ci.title,
      ci.quote
    );
  }
  ctx.restore();
}
function drawVs(ctx, M, age) {
  const p = easeOut(age / 0.3),
    A = M.L,
    B = M.R;
  const panel = (id, left) => {
    ctx.save();
    ctx.beginPath();
    if (left) {
      ctx.moveTo(0, 0);
      ctx.lineTo(W / 2 + 90, 0);
      ctx.lineTo(W / 2 - 90, H);
      ctx.lineTo(0, H);
    } else {
      ctx.moveTo(W / 2 + 90, 0);
      ctx.lineTo(W, 0);
      ctx.lineTo(W, H);
      ctx.lineTo(W / 2 - 90, H);
    }
    ctx.closePath();
    ctx.translate((left ? -1 : 1) * (1 - p) * W, 0);
    ctx.clip();
    const L = LOOK[id],
      g = ctx.createLinearGradient(left ? 0 : W, 0, W / 2, H);
    g.addColorStop(0, L.dark);
    g.addColorStop(1, L.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    focusLines(
      ctx,
      left ? 300 : 980,
      360,
      age + (left ? 3 : 3.3),
      "rgba(255,255,255,0.18)",
      40,
      160
    );
    const fly = T.fighters[id].locomotion === "flight";
    sprite(
      ctx,
      `${id}-idle`,
      (left ? 330 : 950) + (left ? 1 : -1) * age * 12,
      (fly ? 610 : 665) + (fly ? Math.sin(age * 3) * 8 : 0),
      { scale: 1.75, flip: spriteFace(id, "idle") !== (left ? 1 : -1) }
    );
    ctx.restore();
  };
  panel(A, true);
  panel(B, false);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(W / 2 + 90, 0);
  ctx.lineTo(W / 2 - 90, H);
  ctx.stroke();
  const sub = (id) =>
    `${T.fighters[id].species.toUpperCase()}  •  ${T.fighters[id].locomotion === "flight" ? "FLIGHT" : "GROUND"}`;
  text(ctx, T.fighters[A].name.toUpperCase(), 60 - (1 - p) * 400, 130, 96, {
    maxWidth: 520,
    align: "left",
    italic: true,
    gradient: ["#fff", LOOK[A].light]
  });
  text(ctx, sub(A), 66 - (1 - p) * 400, 192, 24, {
    align: "left",
    font: "Russo One"
  });
  text(ctx, T.fighters[B].name.toUpperCase(), W - 60 + (1 - p) * 400, 130, 96, {
    maxWidth: 520,
    align: "right",
    italic: true,
    gradient: ["#fff", LOOK[B].light]
  });
  text(ctx, sub(B), W - 66 + (1 - p) * 400, 192, 24, {
    align: "right",
    font: "Russo One"
  });
  ctx.save();
  ctx.fillStyle = "rgba(20,12,40,0.85)";
  ctx.fillRect(W / 2 - 170, 18, 340, 50);
  ctx.restore();
  text(ctx, M.label, W / 2, 44, 30, { font: "Russo One", fill: "#ffde59" });
  if (age > 0.5)
    text(ctx, "VS", W / 2, H / 2 + 20, 200, {
      scale: easeOutBack((age - 0.5) / 0.22) * (1 + (age - 0.5) * 0.03),
      rot: -0.1,
      gradient: ["#ffffff", "#ffe066", "#ff3b5c"],
      outer: "#1a1030"
    });
}
function drawReady(ctx, f) {
  const age = f - VS_D;
  if (age < READY_D)
    text(ctx, "READY…", W / 2, H / 2, 92, {
      scale: easeOutBack(age / 0.25),
      alpha: 1 - smooth((age - (READY_D - 0.25)) / 0.25),
      italic: true,
      gradient: ["#fff", "#bfe9ff"]
    });
  else
    text(ctx, "FIGHT!", W / 2, H / 2, 170, {
      scale: easeOutBack((age - 1.2) / 0.18),
      alpha: 1 - smooth((age - 1.75) / 0.2),
      rot: -0.06,
      gradient: ["#fff", "#ffe066", "#ff3b5c"],
      outer: "#1a1030"
    });
}
function drawResult(ctx, M, age, f) {
  const wid = M.winnerId,
    L = LOOK[wid];
  ctx.save();
  ctx.globalAlpha = smooth(age / 0.4) * 0.6;
  ctx.fillStyle = "#1a0f38";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = smooth(age / 0.4);
  focusLines(ctx, 900, 330, f, "rgba(255,230,170,0.35)", 50, 200);
  ctx.restore();
  const pose = has(wid, "victory") ? "victory" : "idle",
    fly = T.fighters[wid].locomotion === "flight";
  sprite(
    ctx,
    `${wid}-${pose}`,
    910,
    (fly ? 640 : 680) + (fly ? Math.sin(f * 2.4) * 8 : 0),
    {
      scale: 1.45 * easeOutBack((age - 0.15) / 0.4),
      alpha: smooth(age / 0.2),
      flip: spriteFace(wid, pose) !== -1
    }
  );
  for (let i = 0; i < 18; i++) {
    const t = (age * 0.6 + R(i)) % 1;
    star(
      ctx,
      660 + R(i * 3) * 520,
      120 + R(i * 7) * 460 - t * 40,
      6 + R(i) * 8,
      t * 6,
      `rgba(255,240,180,${(1 - t) * smooth(age / 0.5)})`
    );
  }
  const x = lerp(-420, 70, easeOut((age - 0.3) / 0.35)),
    a2 = smooth((age - 0.9) / 0.4),
    a3 = smooth((age - 1.5) / 0.4);
  const name = T.fighters[wid].name.toUpperCase();
  if (M.final) {
    text(ctx, "TOURNAMENT CHAMPION", x, 180, 40, {
      align: "left",
      font: "Russo One",
      fill: "#ffde59"
    });
    text(ctx, name, x - 4, 280, 160, {
      maxWidth: 1000,
      align: "left",
      italic: true,
      gradient: ["#ffffff", "#ffe066", "#ff8a3d"],
      outer: "#1a1030"
    });
  } else {
    text(ctx, `${M.label} WINNER`, x, 180, 34, {
      align: "left",
      font: "Russo One",
      fill: "#ffde59"
    });
    text(ctx, name, x - 4, 275, 150, {
      maxWidth: 1000,
      align: "left",
      italic: true,
      gradient: ["#ffffff", L.light, L.color],
      outer: "#1a1030"
    });
  }
  text(
    ctx,
    `${M.verdict.toUpperCase()} AT ${M.verdictSeconds.toFixed(2)}s  •  ${hpAt(M, wid, 99)} HP LEFT`,
    x,
    380,
    28,
    { align: "left", font: "Russo One", alpha: a2 }
  );
  text(ctx, M.c.result, x, 432, 28, {
    align: "left",
    font: "Russo One",
    fill: "#e9e3ff",
    alpha: a3
  });
  if (!M.final)
    text(ctx, "→ advances to the Grand Final", x, 484, 24, {
      align: "left",
      font: "Russo One",
      fill: "#ffde59",
      alpha: smooth((age - 2.1) / 0.4)
    });
}

function drawBg(ctx, cam) {
  const bg = IMG["bg-arena"],
    bw = 1520,
    bh = (bg.height / bg.width) * bw;
  ctx.drawImage(
    bg,
    640 - bw / 2 + (cam.cx - 640) * 0.06,
    360 - bh / 2 + 20,
    bw,
    bh
  );
}

function drawMatch(ctx, M, f) {
  const seg = segAt(M, f),
    b = bAt(M, f),
    cam = camera(M, f),
    sh = shake(M, f);
  ctx.save();
  ctx.translate(W / 2 + sh.x, H / 2 + sh.y);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.cx, -cam.cy);
  drawBg(ctx, cam);
  drawPuddles(ctx, M, b);
  for (const e of M.events)
    if (isProjectile(e) && e.outcome === "dodged")
      drawProjectile(ctx, M, e, b, f); // the abandoned line lies behind
  const bodies = [M.L, M.R]
    .map((id) => stage(M, id, b, f))
    .sort((p, q) => p.depth - q.depth || p.fly - q.fly);
  for (const s of bodies) drawFighter(ctx, M, s, b, f, seg);
  for (const e of M.events) {
    drawCharge(ctx, M, e, b, f);
    if (eventKit(e)?.strike || e.kind === "vine") drawVine(ctx, M, e, b, f);
    else if (e.kind === "jet" && !eventKit(e)?.projectile)
      drawJet(ctx, M, e, b, f);
    else if (isProjectile(e) && e.outcome !== "dodged")
      drawProjectile(ctx, M, e, b, f);
  }
  drawImpacts(ctx, M, b, f);
  ctx.restore();

  // inverted impact frames on clean hits and on the knockout
  for (const e of M.events)
    if (e.outcome === "hit" || e.ko) {
      const age = f - e.fEnd;
      if (age >= 0 && age < (e.ko ? 0.2 : 0.1)) {
        ctx.save();
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        const t = toScreen(cam, torso(stage(M, e.targetId, e.contact, e.fEnd)));
        focusLines(ctx, t.x, t.y, f, "rgba(0,0,0,0.9)", 60, 80);
      } else if (age >= 0 && age < 0.3) {
        ctx.save();
        ctx.globalAlpha = 0.5 * (1 - age / 0.3);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
  for (const e of M.events)
    if (e.outcome !== "interrupted" && win(f, e.fRelease, e.fEnd))
      speedLinesH(ctx, f, 0.3);

  const inFight = !["vs", "result"].includes(seg.kind);
  const hudA =
    seg.kind === "ready"
      ? smooth((f - VS_D - 0.4) / 0.4)
      : seg.kind === "result"
        ? 1 - smooth((f - seg.f0) / 0.4)
        : inFight
          ? 1
          : 0;
  if (seg.kind === "fight" || seg.kind === "hitstop")
    for (const e of M.events) callout(ctx, M, e, f);
  if (seg.kind !== "result" && seg.kind !== "vs") popups(ctx, M, f, cam);
  hud(ctx, M, f, b, hudA);
  if (seg.kind === "vs") drawVs(ctx, M, f);
  if (seg.kind === "ready") drawReady(ctx, f);
  if (seg.kind === "cutin") drawCutin(ctx, M, seg, f);
  if (f >= M.fKo && seg.kind !== "result") {
    const age = f - M.fKo,
      up = smooth((age - 1.0) / 0.4);
    text(
      ctx,
      M.verdict === "knockout" ? "K.O." : "DECISION",
      W / 2,
      lerp(H / 2 - 20, 165, up),
      210,
      {
        scale: easeOutBack(age / 0.18) * lerp(1, 0.55, up),
        rot: -0.06,
        gradient: ["#ffffff", "#ffe066", "#ff3b5c"],
        outer: "#1a1030"
      }
    );
  }
  letterbox(
    ctx,
    seg.kind === "ko"
      ? 1
      : seg.kind === "cutin"
        ? smooth((f - seg.f0) / 0.15) * (1 - smooth((f - seg.f1 + 0.2) / 0.2))
        : 0
  );
  if (seg.kind === "result") drawResult(ctx, M, f - seg.f0, f);
}

// ---------- intro & bracket ----------
function drawIntro(ctx, f) {
  const cam = { cx: lerp(760, 560, smooth(f / INTRO_D)), cy: 330, zoom: 1.3 };
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.cx, -cam.cy);
  drawBg(ctx, cam);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "rgba(18,10,40,0.45)";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const a = smooth((f - 0.2) / 0.4),
    grow = easeOut((f - 0.2) / 0.4);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(18,10,40,0.8)";
  ctx.translate(W / 2, 360);
  ctx.transform(1, 0, -0.25, 1, 0, 0);
  ctx.fillRect(-580 * grow, -100, 1160 * grow, 200);
  ctx.restore();
  text(ctx, "YUNIPALS ARENA", W / 2, 285, 30, {
    font: "Russo One",
    fill: "#ffde59",
    alpha: a
  });
  text(ctx, "TOURNAMENT", W / 2, 365, 120, {
    scale: easeOutBack((f - 0.35) / 0.3),
    italic: true,
    gradient: ["#ffffff", "#ffe066", "#ff8a3d"],
    outer: "#1a1030"
  });
  text(ctx, `${T.islandName.toUpperCase()}  •  4 FIGHTERS`, W / 2, 440, 26, {
    font: "Russo One",
    alpha: a
  });
}
function drawBracket(ctx, stageIdx, f) {
  const cam = { cx: 640, cy: 360, zoom: 1.15 };
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.cx, -cam.cy);
  drawBg(ctx, cam);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "rgba(14,8,32,0.78)";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const sf = T.semifinals,
    winners = T.matches.slice(0, 2).map((m) => m.winnerId),
    next = T.matches[stageIdx];
  const card = (id, x, y, state, appearAt) => {
    const w = 270,
      h = 92,
      k = appearAt == null ? 1 : easeOutBack((f - appearAt) / 0.4);
    if (k <= 0) return;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(k, k);
    ctx.translate(-w / 2, -h / 2);
    if (state === "out") ctx.globalAlpha = 0.38;
    ctx.fillStyle = "#211638";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 14);
    ctx.fill();
    if (id) {
      const L = LOOK[id];
      ctx.fillStyle = state === "out" ? "#555" : L.color;
      ctx.beginPath();
      ctx.roundRect(0, 0, 10, h, [14, 0, 0, 14]);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(16, 6, 96, 80, 10);
      ctx.clip();
      ctx.fillStyle = L.dark;
      ctx.fillRect(16, 6, 96, 80);
      sprite(ctx, `${id}-idle`, 64, 84, {
        h: 82,
        flip: spriteFace(id, "idle") !== 1,
        filter: state === "out" ? "grayscale(1)" : undefined
      });
      ctx.restore();
      text(ctx, T.fighters[id].name.toUpperCase(), 126, 36, 30, {
        maxWidth: 132,
        align: "left",
        font: "Russo One"
      });
      text(ctx, T.fighters[id].species, 126, 66, 18, {
        maxWidth: 132,
        align: "left",
        font: "Russo One",
        fill: "#cbbff0"
      });
    } else text(ctx, "?", w / 2, h / 2, 48, { fill: "#6d5b99" });
    if (state === "next") {
      ctx.strokeStyle = `rgba(255,222,89,${0.6 + 0.4 * Math.sin(f * 6)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(-3, -3, w + 6, h + 6, 16);
      ctx.stroke();
    }
    ctx.restore();
  };
  const line = (x1, y1, x2, y2, lit) => {
    ctx.strokeStyle = lit ? "#ffde59" : "#4a3b72";
    ctx.lineWidth = lit ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + 40, y1);
    ctx.lineTo(x1 + 40, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const c1 = 80,
    c2 = 505,
    c3 = 930,
    ys = [
      [150, 262],
      [438, 550]
    ],
    ws = [206, 494],
    yf = 350;
  sf.forEach((pair, k) =>
    pair.forEach((id, j) =>
      line(
        c1 + 270,
        ys[k][j] + 46,
        c2,
        ws[k] + 46,
        stageIdx > k && winners[k] === id
      )
    )
  );
  [0, 1].forEach((k) => line(c2 + 270, ws[k] + 46, c3, yf + 46, false));
  sf.forEach((pair, k) =>
    pair.forEach((id, j) => {
      const done = stageIdx > k,
        state = done
          ? winners[k] === id
            ? "won"
            : "out"
          : stageIdx === k
            ? "next"
            : "wait";
      card(id, c1, ys[k][j], state);
    })
  );
  [0, 1].forEach((k) => {
    const filled = stageIdx > k ? winners[k] : null;
    card(
      filled,
      c2,
      ws[k],
      stageIdx === 2 ? "next" : "won",
      filled && stageIdx === k + 1 ? 0.35 : null
    );
  });
  card(null, c3, yf, "wait");
  text(ctx, "CHAMPION", c3 + 135, yf - 26, 24, {
    font: "Russo One",
    fill: "#ffde59"
  });
  text(ctx, "UP NEXT", 1060, 80, 24, {
    font: "Russo One",
    fill: "#cbbff0",
    alpha: smooth(f / 0.3)
  });
  text(ctx, next ? CH[next.id].label : "", 1060, 132, 60, {
    italic: true,
    gradient: ["#fff", "#ffde59"],
    scale: easeOutBack((f - 0.2) / 0.3)
  });
}

// ---------- main ----------
function drawFrame(ctx, F) {
  F = clamp(F, 0, DURATION - 1e-6);
  const sc = SCENES.find((s) => F < s.f1) || SCENES[SCENES.length - 1],
    f = F - sc.f0;
  ctx.save();
  ctx.fillStyle = "#120a24";
  ctx.fillRect(0, 0, W, H);
  if (sc.kind === "intro") drawIntro(ctx, f);
  else if (sc.kind === "bracket") drawBracket(ctx, sc.stage, f);
  else drawMatch(ctx, sc.M, f);
  const vg = ctx.createRadialGradient(
    W / 2,
    H / 2,
    H * 0.45,
    W / 2,
    H / 2,
    H * 0.95
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(10,5,30,0.38)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  const edge = sc === SCENES[0] ? 0.5 : 0.22,
    tail = sc === SCENES[SCENES.length - 1] ? 0.8 : 0.22;
  const fade = Math.max(
    1 - smooth(f / edge),
    smooth((f - (sc.dur - tail)) / tail)
  );
  if (fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${fade})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

window.YunipalsFilm = {
  W,
  H,
  FPS,
  loadAssets,
  drawFrame,
  get DURATION() {
    return DURATION;
  },
  get CUES() {
    return CUES;
  },
  get CHAPTERS() {
    return SCENES.filter((s) => s.kind === "match").map((s) => ({
      id: s.M.id,
      label: s.M.label,
      t: s.f0 - BRACKET_D,
      winnerAt: s.f0 + s.M.fight1 + 1,
      events: s.M.events.map((e) => ({ id: e.id, contact: s.f0 + e.fEnd }))
    }));
  }
};
