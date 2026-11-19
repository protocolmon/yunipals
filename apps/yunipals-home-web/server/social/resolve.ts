import { createHash } from "node:crypto";

import { portalArtworkUri } from "../../src/lib/portalArtwork";
import {
  matchesPortalDeployment,
  parseMonsterArtwork,
  selectMonsterArtwork,
  type MonsterArtwork
} from "../../src/lib/social/artwork";
import {
  socialCards,
  TEMPLATE_VERSION,
  type PageMetadata
} from "../../src/lib/social/metadata";
import type { PreviewConfig } from "./config";
import { assetUrl, PreviewError, readJson, type PreviewReader } from "./fetch";

export type Preview = {
  name: string;
  subtitle: string;
  image: string | null;
  traits: string[];
  state: "ready" | "pending" | "fallback";
  revision: string;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.slice(0, 200) : fallback;

export async function resolvePreview(
  meta: PageMetadata,
  config: PreviewConfig,
  read: PreviewReader,
  signal: AbortSignal
): Promise<Preview> {
  const asset = meta.asset;
  if (!asset) throw new PreviewError(404, "Collectible not found.");
  if (!config.indexerUrl)
    throw new PreviewError(503, "Preview data is not configured.");
  let name = meta.title.replace(" — Yunipals", "");
  let subtitle = socialCards[meta.card][1];
  let artwork: MonsterArtwork | undefined;
  let burned = false;
  let degraded = false;
  const parse = (value: unknown) =>
    parseMonsterArtwork(value, (uri) => assetUrl(uri, config));
  const loadArtwork = async (uri: unknown) => {
    const url = typeof uri === "string" && assetUrl(uri, config);
    if (!url) return undefined;
    try {
      return parse(await readJson(read, url, signal));
    } catch {
      return undefined;
    }
  };
  if (asset.kind === "portal-token") {
    if (!config.portalsEnabled)
      throw new PreviewError(404, "Portals are unavailable.");
    const data = await readJson(
      read,
      `${config.portalUrl}/v1/portals/tokens/${asset.id}`,
      signal
    );
    const token = record(data.token);
    if (String(token.id) !== asset.id)
      throw new PreviewError(503, "Preview data does not match this portal.");
    name = `${text(token.name, "Portal")} #${asset.id}`;
    artwork = parse({
      name,
      image: portalArtworkUri({
        name: text(token.name),
        kindId: text(token.kindId) || undefined,
        imageURI: text(token.imageURI)
      })
    });
    subtitle = token.retired ? "Portal · Redeemed" : "Yunipals portal · Base";
  } else if (asset.kind === "monster" || asset.kind === "portal-card") {
    const collection =
      asset.kind === "monster" ? asset.collection : config.monsters;
    if (
      (asset.kind === "monster" && !config.boostersEnabled) ||
      (asset.kind === "portal-card" && !config.portalsEnabled) ||
      !config.monsters ||
      collection !== config.monsters
    )
      throw new PreviewError(404, "Unsupported collection.");
    const data = await readJson(
      read,
      `${config.indexerUrl}/v1/boosters/monsters/${collection}/${asset.id}`,
      signal
    );
    const item = record(data.item);
    if (
      String(item.tokenId) !== asset.id ||
      text(item.collection).toLowerCase() !== collection
    )
      throw new PreviewError(503, "Preview data does not match this card.");
    burned = item.burned === true;
    const originalPromise = loadArtwork(item.metadataUri);
    let graded: MonsterArtwork | undefined;
    if (config.portalsEnabled && !burned) {
      try {
        const status = await readJson(
          read,
          `${config.portalUrl}/v1/portals`,
          signal
        );
        const deployment = record(status.deployment);
        if (
          status.enabled === true &&
          matchesPortalDeployment(
            {
              chainId: Number(deployment.chainId),
              grading: text(deployment.grading),
              cards: text(deployment.cards)
            },
            {
              chainId: config.portalChainId,
              grading: config.portalGrading,
              cards: collection
            }
          )
        ) {
          graded = await loadArtwork(
            `${config.portalUrl}/v1/portals/cards/${asset.id}.json`
          );
          if (!graded) degraded = true;
        }
      } catch {
        degraded = true;
      }
    }
    artwork = selectMonsterArtwork(await originalPromise, graded);
    if (
      graded?.image &&
      graded.portalVersion !== "0" &&
      graded.status === "ready"
    )
      degraded = false;
    subtitle = `TCG collection · Base · ${item.isOriginal ? "Original" : "Offspring"}`;
    if (degraded) subtitle += " · Original artwork";
  } else {
    const island = asset.collection.includes("islands");
    const path = island
      ? `/v2/collections/${asset.collection}/tokens/${asset.id}`
      : `/v1/tokens/${asset.collection}/${asset.id}`;
    const data = await readJson(read, `${config.indexerUrl}${path}`, signal);
    const token = record(data.token);
    const returnedId = token.tokenId ?? token.token_id;
    if (returnedId !== undefined && String(returnedId) !== asset.id)
      throw new PreviewError(
        503,
        "Preview data does not match this collectible."
      );
    if (!Object.keys(token).length)
      throw new PreviewError(503, "Preview data is unavailable.");
    burned = token.burned === true;
    artwork = parse(island ? record(token.metadata) : token);
    subtitle = `${island ? "Yunipals Islands" : asset.collection === "solana" ? "Exomon" : "Yunipals"} · ${asset.collection.replace(/-/g, " ")}`;
  }
  if (artwork?.name) name = artwork.name;
  if (burned) subtitle += " · Burned";
  const traits = ["type", "color", "horn", "glitter"]
    .flatMap((key) =>
      artwork?.attributes[key]
        ? [`${key[0].toUpperCase()}${key.slice(1)}: ${artwork.attributes[key]}`]
        : []
    )
    .slice(0, 3);
  const state =
    artwork?.image && artwork.status === "ready"
      ? degraded
        ? "fallback"
        : "ready"
      : "pending";
  if (state === "pending") subtitle = "Artwork is being prepared";
  const image = state === "pending" ? null : (artwork?.image ?? null);
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        TEMPLATE_VERSION,
        asset,
        name,
        subtitle,
        traits,
        image,
        artwork?.portalVersion
      ])
    )
    .digest("hex")
    .slice(0, 20);
  return { name, subtitle, traits, image, state, revision };
}
