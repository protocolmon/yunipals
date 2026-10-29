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
  recipe: { id: "anime-fighter-v1"; sha256: string };
  look: {
    attackKind: "vine" | "star" | "jet" | "orb" | "dash";
    palette: { color: string; light: string; dark: string };
    face: 1 | -1;
    stageHeight: Record<string, number>;
    origin: [number, number];
    torso: [number, number];
  };
  sprites: Record<string, AnimeSprite>;
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
    m.recipe?.id !== "anime-fighter-v1" ||
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
  for (const pose of Object.keys(m.look.stageHeight))
    if (!m.sprites[pose]) throw new Error("Stage height has no sprite.");
  for (const pose of Object.keys(m.sprites))
    if (pose !== "cutin" && !m.look.stageHeight[pose])
      throw new Error("Sprite has no stage height.");
  return m;
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
