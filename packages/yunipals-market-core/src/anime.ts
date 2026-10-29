/** Shared wire format. SHA-256 commits to recursively key-sorted UTF-8 JSON. */
export const ANIME_BASE_COLLECTION =
  "0x98433df878e8c898cb907345c3a7756e5f72240f" as const;
export const ANIME_ASSETS_ORIGIN = "https://assets-anime.yunipals.com";
export const ANIME_STATUSES = [
  "None",
  "Applied",
  "Approved",
  "Rejected",
  "Revoked"
] as const;
export type AnimeStatus = (typeof ANIME_STATUSES)[number];
export const ANIME_REASONS: Record<number, string> = {
  0: "Other — see curator note",
  1: "Artwork not supported yet (unrevealed or placeholder)",
  2: "A consistent fighter could not be produced; reapply after a recipe update",
  3: "Duplicate artwork already in the queue",
  4: "Queue closed for now",
  5: "Traits changed after approval"
};
export type AnimeTraits = {
  monsterType: number;
  color: number;
  horn: number;
  background: number;
  glitter: number;
};
export type AnimeSprite = {
  file: string;
  sha256: string;
  w: number;
  h: number;
};
export type AnimeSheet = {
  sheet: string;
  sha256: string;
  cols: number;
  rows: number;
  blend: "add" | "alpha";
};
export type AnimeKit = {
  id: string;
  name: string;
  kind: "projectile" | "strike" | "dash";
  element: string;
  description: string;
  windup: AnimeSprite;
  projectile?: AnimeSheet;
  strike?: AnimeSheet;
  impact: AnimeSheet;
};
export type AnimeLoadout = [string, string];
export type AnimeKnownKit = Pick<
  AnimeKit,
  "id" | "name" | "kind" | "description"
>;
export const animeSpeciesSlug = (species: string) =>
  species
    .toLowerCase()
    .replace(/\byuni/g, "uni")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export type AnimeManifest = {
  version: "anime-fighter/v1";
  chainId: 8453;
  collection: string;
  tokenId: string;
  traits: AnimeTraits;
  traitsHash: string;
  artwork: { url: string; sha256: string };
  identity: {
    species: string;
    color: string;
    horn: string;
    text: string;
    locomotion: "ground" | "flight";
    identityVersion: "anime-fighter-v1";
  };
  recipe: { id: "anime-fighter-v1" | "anime-fighter-v2"; sha256: string };
  look: {
    attackKind: "vine" | "star" | "jet" | "orb" | "dash";
    palette: { color: string; light: string; dark: string };
    face: 1 | -1;
    stageHeight: Record<string, number>;
    origin: [number, number];
    torso: [number, number];
  };
  sprites: Record<string, AnimeSprite>;
  kits?: AnimeKit[];
  defaultLoadout?: AnimeLoadout;
  generatedWith: "codex-subscription";
  reviewedAt: string;
};
export type AnimeFighter = {
  tokenId: string;
  status: AnimeStatus;
  recipeVersion: number;
  manifestHash: string;
  applications: number;
  applicant: string | null;
  reasonCode: number | null;
  note: string | null;
  appliedBlock: string | null;
  queuePosition?: number | null;
  reviewRequired?: boolean;
};
export function canonicalAnimeJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalAnimeJson).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalAnimeJson(object[key])}`)
      .join(",")}}`;
  }
  throw new Error("Invalid canonical anime JSON.");
}
export function animeTokenId(value: string): string {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 2n ** 256n)
    throw new Error("Invalid Base token ID.");
  return value;
}
export function parseAnimeManifest(
  value: unknown,
  tokenId: string
): AnimeManifest {
  const m = value as AnimeManifest;
  const hash = (v: unknown) =>
    typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const text = (v: unknown, max: number) =>
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= max &&
    !/[\u0000-\u001f]/.test(v);
  if (
    !m ||
    m.version !== "anime-fighter/v1" ||
    m.chainId !== 8453 ||
    m.collection !== ANIME_BASE_COLLECTION ||
    m.tokenId !== animeTokenId(tokenId) ||
    !m.traits ||
    Object.keys(m.traits).sort().join(",") !==
      "background,color,glitter,horn,monsterType" ||
    !Object.entries(m.traits).every(
      ([k, v]) =>
        Number.isInteger(v) &&
        v >= 0 &&
        v <= (["background", "glitter"].includes(k) ? 255 : 65535)
    ) ||
    !/^0x[a-f0-9]{64}$/.test(m.traitsHash) ||
    !hash(m.artwork?.sha256) ||
    !/^https:\/\/drive\.polychainmonsters\.com\/ipfs\/[A-Za-z0-9]+$/.test(
      m.artwork?.url ?? ""
    ) ||
    !m.identity ||
    !["species", "color", "horn"].every((key) =>
      text(m.identity[key as "species"], 100)
    ) ||
    !text(m.identity.text, 1500) ||
    !["ground", "flight"].includes(m.identity.locomotion) ||
    m.identity.identityVersion !== "anime-fighter-v1" ||
    !["anime-fighter-v1", "anime-fighter-v2"].includes(m.recipe?.id) ||
    !hash(m.recipe.sha256) ||
    !m.look ||
    !["vine", "star", "jet", "orb", "dash"].includes(m.look.attackKind) ||
    ![1, -1].includes(m.look.face) ||
    !["color", "light", "dark"].every((k) =>
      /^#[a-fA-F0-9]{6}$/.test(m.look.palette?.[k as "color"] ?? "")
    ) ||
    ![m.look.origin, m.look.torso].every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((v) => Number.isFinite(v) && v >= -1 && v <= 1)
    ) ||
    !m.look.stageHeight ||
    !Object.values(m.look.stageHeight).every(
      (n) => Number.isFinite(n) && n > 0 && n <= 720
    ) ||
    !m.sprites ||
    !["idle", "attack", "guard", "hurt", "down", "victory", "cutin"].every(
      (p) => !!m.sprites[p]
    ) ||
    !(m.sprites.dash || m.sprites.dodge) ||
    Object.entries(m.sprites).some(
      ([pose, s]) =>
        ![
          "idle",
          "attack",
          "dodge",
          "dash",
          "guard",
          "hurt",
          "down",
          "victory",
          "cutin"
        ].includes(pose) ||
        !s ||
        !hash(s.sha256) ||
        s.file !== `${pose}.${s.sha256.slice(0, 8)}.webp` ||
        !Number.isInteger(s.w) ||
        !Number.isInteger(s.h) ||
        Math.min(s.w, s.h) < 1 ||
        Math.max(s.w, s.h) > 4096
    ) ||
    m.generatedWith !== "codex-subscription" ||
    !Number.isFinite(Date.parse(m.reviewedAt))
  )
    throw new Error("Invalid anime fighter manifest.");
  const kits = m.kits;
  if (
    kits !== undefined ||
    m.defaultLoadout !== undefined ||
    m.recipe.id === "anime-fighter-v2"
  ) {
    if (
      m.recipe.id !== "anime-fighter-v2" ||
      !Array.isArray(kits) ||
      kits.length !== 3
    )
      throw new Error("Recipe v2 requires exactly three attack kits.");
    const ids = new Set<string>();
    const slug = (v: unknown) =>
      typeof v === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(v);
    for (const k of kits) {
      if (
        !k ||
        !slug(k.id) ||
        ids.has(k.id) ||
        !text(k.name, 24) ||
        !/^[A-Za-z0-9][A-Za-z0-9 '!\-]*$/.test(k.name) ||
        k.name.trim() !== k.name ||
        k.name.split(/\s+/).length > 2 ||
        !["projectile", "strike", "dash"].includes(k.kind) ||
        !slug(k.element) ||
        !text(k.description, 120) ||
        !k.windup ||
        !hash(k.windup.sha256) ||
        k.windup.file !==
          `windup-${k.id}.${k.windup.sha256.slice(0, 8)}.webp` ||
        ![k.windup.w, k.windup.h].every(
          (n) => Number.isInteger(n) && n > 0 && n <= 4096
        ) ||
        !m.look.stageHeight[`windup-${k.id}`] ||
        (k.kind === "projectile") !== !!k.projectile ||
        (k.kind === "strike") !== !!k.strike
      )
        throw new Error("Invalid anime attack kit.");
      ids.add(k.id);
      for (const role of ["projectile", "strike", "impact"] as const) {
        const sheet = k[role];
        if (!sheet && role !== "impact") continue;
        const directory =
          role === "impact"
            ? `elements-${k.element}`
            : animeSpeciesSlug(m.identity.species);
        const filename = role === "impact" ? "impact" : `${k.id}.${role}`;
        if (
          !sheet ||
          !hash(sheet.sha256) ||
          sheet.sheet !==
            `recipes/anime-fighter-v2/species/${directory}/${filename}.${sheet.sha256.slice(0, 8)}.webp` ||
          ![sheet.cols, sheet.rows].every(
            (n) => Number.isInteger(n) && n >= 1 && n <= 4
          ) ||
          !(role === "strike" ? [2, 4] : [4]).includes(
            sheet.cols * sheet.rows
          ) ||
          sheet.blend !== (role === "strike" ? "alpha" : "add")
        )
          throw new Error("Invalid anime kit sheet.");
      }
    }
    parseAnimeLoadout(m, m.defaultLoadout);
  }
  for (const pose of Object.keys(m.look.stageHeight))
    if (!m.sprites[pose] && !kits?.some((k) => pose === `windup-${k.id}`))
      throw new Error("Stage height has no sprite.");
  for (const pose of Object.keys(m.sprites))
    if (pose !== "cutin" && !m.look.stageHeight[pose])
      throw new Error("Sprite has no stage height.");
  return m;
}

/** Only the loadout is public; neither it nor kit vocabulary affects combat rules. */
export function parseAnimeLoadout(
  m: Pick<AnimeManifest, "kits" | "defaultLoadout">,
  value?: unknown
): AnimeLoadout | undefined {
  if (!m.kits) {
    if (value !== undefined)
      throw new Error("This fighter has no attack kits.");
    return undefined;
  }
  const chosen = value === undefined ? m.defaultLoadout : value;
  if (
    !Array.isArray(chosen) ||
    chosen.length !== 2 ||
    chosen[0] === chosen[1] ||
    chosen.some(
      (id) => typeof id !== "string" || !m.kits!.some((k) => k.id === id)
    )
  )
    throw new Error("Choose two different kits from this fighter.");
  return [chosen[0], chosen[1]];
}

export function arenaEconomics(kind: "video" | "anime" = "video") {
  return kind === "anime"
    ? {
        entry: 1000000n,
        winner: 3200000n,
        island: 200000n,
        operations: 600000n
      }
    : {
        entry: 2000000n,
        winner: 6000000n,
        island: 400000n,
        operations: 1600000n
      };
}
