import { rarityFormulaVersion } from "./calculate.js";

export const rarityReadSource = process.env.RARITY_READ_SOURCE ?? "metadata";
if (rarityReadSource !== "metadata" && rarityReadSource !== "local") {
  throw new Error("RARITY_READ_SOURCE must be metadata or local");
}

export const localRarityJoin =
  rarityReadSource === "local"
    ? `LEFT JOIN metadata.token_rarity local_rarity
        ON local_rarity.collection=m.collection
        AND local_rarity.token_id=m.token_id
        AND local_rarity.lifecycle=m.lifecycle
        AND local_rarity.formula_version='${rarityFormulaVersion}'`
    : "";

const upstreamRaw = `CASE
  WHEN m.document->>'rarity' ~ '^-?[0-9]+(\\.[0-9]+)?$'
    THEN (m.document->>'rarity')::numeric
  WHEN rp.value ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN rp.value::numeric
END`;
const upstreamCapped = `COALESCE(
  CASE WHEN m.document->>'rarityCapped' ~ '^-?[0-9]+(\\.[0-9]+)?$'
    THEN (m.document->>'rarityCapped')::numeric END,
  ${upstreamRaw}
)`;

export const rarityPointsSql =
  rarityReadSource === "local"
    ? `COALESCE(CASE WHEN local_rarity.status='valid'
        THEN local_rarity.rarity_points END, ${upstreamRaw})`
    : upstreamRaw;

export const rarityPointsCappedSql =
  rarityReadSource === "local"
    ? `COALESCE(CASE WHEN local_rarity.status='valid'
        THEN local_rarity.rarity_points_capped END, ${upstreamCapped})`
    : upstreamCapped;
