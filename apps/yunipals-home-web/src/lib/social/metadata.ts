import { proposalPreviews } from "./proposals";

export const DEFAULT_TITLE = "Yunipals — Explore the Collection";
export const DEFAULT_DESCRIPTION =
  "Explore Yunipals across Ethereum, Base, Polygon, and BNB Chain. Discover traits, rarity, token histories, and collector profiles.";
export const TEMPLATE_VERSION = "2";

export const socialCards = {
  collection: [
    "Meet the Yunipals",
    "Explore the OG collection",
    "/images/bitcoin-unidragon-square.webp"
  ],
  airdrop: [
    "The OG Airdrop",
    "Yunipals on Base",
    "/images/yunipals-base-banner.webp"
  ],
  tcg: [
    "Your next adventure",
    "The Yunipals TCG collection",
    "/images/boosters/yunipals-pack-v1.png"
  ],
  boosters: [
    "Open a little magic",
    "Yunipals booster packs",
    "/images/boosters/yunipals-pack-v1.png"
  ],
  grading: [
    "A new kind of magic",
    "Yunipals grading portals · Artwork example",
    "/images/portals/dragon-after.webp"
  ],
  arena: [
    "Enter the arena",
    "Yunipals battles and adventures",
    "/images/arena/anime-turtle.webp"
  ],
  leaderboard: [
    "Meet the collectors",
    "Explore the Yunipals leaderboard",
    "/images/bitcoin-unidragon-square.webp"
  ],
  islands: [
    "Find your island",
    "Explore Yunipals Islands",
    "/images/yunipals-islands-square.webp"
  ],
  exomon: [
    "Discover Exomon",
    "The collection on Solana",
    "/images/og-source/exomon.webp"
  ],
  proposals: [
    "Imagine what’s next",
    "Community proposals · Design previews",
    "/images/bitcoin-unidragon-square.webp"
  ],
  brandkit: [
    "Made of Yunipals",
    "The Yunipals brandkit",
    "/images/brandkit/yunipals-logo.png"
  ],
  collector: [
    "A collection of magic",
    "Explore a Yunipals collector profile",
    "/images/bitcoin-unidragon-square.webp"
  ],
  utility: [
    "Welcome to Yunipals",
    "A world of collectible characters",
    "/images/bitcoin-unidragon-square.webp"
  ]
} satisfies Record<string, readonly [string, string, string]>;

export const staticPages = [
  "/",
  "/boosters",
  "/boosters/why-packs",
  "/grading",
  "/arena",
  "/arena/anime",
  "/arena/video",
  "/arena/rules",
  "/arena/history",
  "/arena/rewards",
  "/arena/watch",
  "/arena/me",
  "/arena/hosting",
  "/arena/setup",
  "/arena/anime/me",
  "/arena/anime/hosting",
  "/arena/anime/studio",
  "/arena/anime/setup",
  "/arena/anime/pilot",
  "/arena/video/me",
  "/arena/video/hosting",
  "/arena/anime/rules",
  "/arena/anime/rewards",
  "/arena/anime/watch",
  "/arena/video/rules",
  "/arena/video/rewards",
  "/arena/video/watch",
  "/leaderboard",
  "/proposals",
  "/brandkit",
  "/contracts",
  "/wrap",
  "/terms",
  "/privacy",
  "/settings",
  "/orders",
  "/orders/activity",
  "/orders/recovery",
  ...Object.keys(proposalPreviews).map((slug) => `/proposals/${slug}`),
  "/grading/mine",
  "/grading/admin",
  "/grading/airdrop",
  "/boosters/setup",
  "/boosters/setup/ypal",
  "/boosters/setup/metadata",
  "/boosters/setup/standard",
  "/boosters/setup/batch",
  "/boosters/setup/permit"
];

export type SocialCard = keyof typeof socialCards;
export type SocialConfig = {
  siteOrigin: string;
  exomonEnabled: boolean;
  staticRevision?: string;
};
export type PreviewAsset =
  | { kind: "monster"; collection: string; id: string }
  | { kind: "token"; collection: string; id: string }
  | { kind: "portal-token"; collection: "grading"; id: string }
  | { kind: "portal-card"; collection: "grading"; id: string };
export type PageMetadata = {
  title: string;
  description: string;
  canonical: string;
  image: string;
  imageAlt: string;
  robots: string;
  card: SocialCard;
  asset?: PreviewAsset;
  redirect?: string;
  status: number;
};

const uint = /^(0|[1-9][0-9]{0,77})$/;
export function validTokenId(id: string) {
  return uint.test(id) && BigInt(id) < 2n ** 256n;
}

export function assetImagePath(asset: PreviewAsset) {
  return `/api/og/${asset.kind}/${asset.collection}/${asset.id}.png?v=${TEMPLATE_VERSION}`;
}

export function resolvePageMetadata(
  input: URL,
  config: SocialConfig
): PageMetadata {
  const path = input.pathname.replace(/\/$/, "") || "/";
  const query = input.searchParams;
  let canonicalPath = path;
  let title = DEFAULT_TITLE;
  let description = DEFAULT_DESCRIPTION;
  let card: SocialCard = "utility";
  let asset: PreviewAsset | undefined;
  let redirect: string | undefined;
  let status = 200;
  const noindex =
    /(?:^\/orders(?:\/|$)|^\/settings$|\/(?:setup|admin|airdrop|studio|pilot|hosting|me|mine)(?:\/|$)|^\/arena-lab$)/.test(
      path
    );
  if (path === "/collection") redirect = `/${input.search}`;
  if (path === "/portals" || path.startsWith("/portals/"))
    redirect = `${path.replace(/^\/portals/, "/grading")}${input.search}`;
  if (path === "/exomon" && config.exomonEnabled) redirect = "/?chain=solana";
  if (/^\/arena\/[^/]+$/.test(path) && !staticPages.includes(path))
    redirect = "/arena";
  const legacy = /^\/collection\/([0-9]+)$/.exec(path);
  if (legacy) redirect = `/collection/ethereum/${legacy[1]}${input.search}`;
  if (path.startsWith("/collection/base-islands/"))
    redirect = `${path.replace("/base-islands/", "/base-islands-v2/")}${input.search}`;
  if (path === "/" || path === "/collection" || path === "/exomon") {
    card =
      query.get("collection") === "islands"
        ? "islands"
        : query.get("edition") === "tcg"
          ? "tcg"
          : query.get("edition") === "airdrop" ||
              (query.getAll("chain").length > 0 &&
                query.getAll("chain").every((v) => v === "base"))
            ? "airdrop"
            : config.exomonEnabled &&
                (path === "/exomon" ||
                  query.getAll("chain").join(",") === "solana")
              ? "exomon"
              : "collection";
    const variant =
      card === "islands"
        ? "?collection=islands"
        : card === "exomon"
          ? "?chain=solana"
          : card === "tcg" || card === "airdrop"
            ? `?edition=${card}`
            : "";
    canonicalPath = `/${variant}`;
  } else if (path.startsWith("/boosters")) card = "boosters";
  else if (path.startsWith("/grading") || path.startsWith("/portals"))
    card = "grading";
  else if (path.startsWith("/arena")) card = "arena";
  else if (path === "/leaderboard") {
    card =
      config.exomonEnabled && query.get("chain") === "solana"
        ? "exomon"
        : "leaderboard";
    if (card === "exomon") canonicalPath += "?chain=solana";
  } else if (path.startsWith("/collector/")) card = "collector";
  else if (path.startsWith("/proposals")) card = "proposals";
  else if (path === "/brandkit") card = "brandkit";
  const monster = /^\/monsters\/(0x[0-9a-fA-F]{40})\/([^/]+)$/.exec(path);
  const token =
    /^\/collection\/(ethereum|polygon|bnb|base|ethereum-islands|base-islands-v2|solana)\/([^/]+)$/.exec(
      path
    );
  const graded = /^\/grading\/(cards|tokens)\/([^/]+)$/.exec(path);
  if (monster && validTokenId(monster[2])) {
    asset = {
      kind: "monster",
      collection: monster[1].toLowerCase(),
      id: monster[2]
    };
    card = "tcg";
  } else if (
    token &&
    (token[1] === "solana"
      ? config.exomonEnabled && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token[2])
      : validTokenId(token[2]))
  ) {
    asset = { kind: "token", collection: token[1], id: token[2] };
    card =
      token[1] === "solana"
        ? "exomon"
        : token[1].includes("islands")
          ? "islands"
          : token[1] === "base"
            ? "airdrop"
            : "collection";
  } else if (graded && validTokenId(graded[2])) {
    asset = {
      kind: graded[1] === "cards" ? "portal-card" : "portal-token",
      collection: "grading",
      id: graded[2]
    };
    card = "grading";
  } else if (/^\/(?:collection|monsters)\//.test(path) || graded) status = 404;
  const known =
    staticPages.includes(path) ||
    Boolean(asset) ||
    /^\/collector\/(?:0x[0-9a-fA-F]{40}|[a-zA-Z0-9.-]+\.eth)$/.test(path) ||
    (config.exomonEnabled &&
      /^\/collector\/solana\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(path)) ||
    /^\/arena\/(?:anime|video)\/[a-zA-Z0-9_-]{1,100}$/.test(path);
  if (!known && !redirect) status = 404;
  title =
    card === "collection" && !asset
      ? DEFAULT_TITLE
      : `${socialCards[card][0]} — Yunipals`;
  description = socialCards[card][1];
  if (card === "utility" && status === 200)
    title = `${path
      .split("/")
      .filter(Boolean)
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" · ")} — Yunipals`;
  if (asset) {
    const label =
      asset.kind === "portal-token"
        ? "Portal"
        : card === "islands"
          ? "Island"
          : card === "exomon"
            ? "Exomon"
            : "Yunipal";
    title = `${label} #${asset.id} — Yunipals`;
    canonicalPath =
      asset.kind === "monster"
        ? `/monsters/${asset.collection}/${asset.id}`
        : path;
  }
  const slug = path.startsWith("/proposals/")
    ? path.slice("/proposals/".length)
    : "";
  const proposal = proposalPreviews[slug as keyof typeof proposalPreviews];
  if (slug && !proposal) status = 404;
  if (proposal) {
    title = `${proposal.title} — Yunipals`;
    description = proposal.description;
  }
  if (path === "/exomon" && !config.exomonEnabled) status = 404;
  if (status === 404) {
    title = "Page unavailable — Yunipals";
    description = "Explore the Yunipals collection.";
  }
  return {
    title,
    description,
    card,
    asset,
    redirect,
    status,
    canonical: new URL(canonicalPath, config.siteOrigin).href,
    image: new URL(
      asset
        ? assetImagePath(asset)
        : staticImagePath(
            card,
            config,
            proposal ? `proposal-${slug}` : undefined
          ),
      config.siteOrigin
    ).href,
    imageAlt: asset ? `${title}. ${description}` : socialCards[card][1],
    robots: noindex || status !== 200 ? "noindex, follow" : "index, follow"
  };
}

export function staticImagePath(
  card: SocialCard,
  config: SocialConfig,
  key: string = card
) {
  return `/images/og/${key}.${config.staticRevision || TEMPLATE_VERSION}.png`;
}

export function metadataEntries(
  meta: PageMetadata
): [string, string, string][] {
  return [
    ["name", "description", meta.description],
    ["name", "robots", meta.robots],
    ["property", "og:type", "website"],
    ["property", "og:site_name", "Yunipals"],
    ["property", "og:title", meta.title],
    ["property", "og:description", meta.description],
    ["property", "og:url", meta.canonical],
    ["property", "og:image", meta.image],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", meta.imageAlt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", meta.title],
    ["name", "twitter:description", meta.description],
    ["name", "twitter:image", meta.image],
    ["name", "twitter:image:alt", meta.imageAlt]
  ];
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}

export function metadataHtml(meta: PageMetadata) {
  return (
    `<title>${escapeHtml(meta.title)}</title>\n<link rel="canonical" href="${escapeHtml(meta.canonical)}" />\n` +
    metadataEntries(meta)
      .map(
        ([attribute, key, value]) =>
          `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`
      )
      .join("\n")
  );
}

export function injectMetadata(html: string, meta: PageMetadata) {
  if (
    !html.includes("<!-- social:start -->") ||
    !html.includes("<!-- social:end -->")
  )
    throw new Error("Missing social metadata markers.");
  return html.replace(
    /<!-- social:start -->[\s\S]*?<!-- social:end -->/,
    () => `<!-- social:start -->\n${metadataHtml(meta)}\n<!-- social:end -->`
  );
}
