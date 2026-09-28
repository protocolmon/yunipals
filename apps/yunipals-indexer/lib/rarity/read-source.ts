export const rarityReadSource = process.env.RARITY_READ_SOURCE ?? "metadata";
if (rarityReadSource !== "metadata") {
  throw new Error("Only RARITY_READ_SOURCE=metadata is supported in this repository");
}

export const localRarityJoin = "";

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

export const rarityPointsSql = upstreamRaw;

export const rarityPointsCappedSql = upstreamCapped;
