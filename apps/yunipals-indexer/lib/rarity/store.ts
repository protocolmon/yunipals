import {
  rarityFormulaVersion,
  type RarityCalculation
} from "./calculate.js";

export type StoredRarityCalculation = RarityCalculation & {
  collection: string;
  tokenId: string;
  lifecycle: number;
  metadataContentHash: string | null;
};

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

export async function storeRarityCalculations(
  client: Queryable,
  calculations: readonly StoredRarityCalculation[]
) {
  if (!calculations.length) return;
  await client.query(
    `INSERT INTO metadata.token_rarity
      (collection, token_id, lifecycle, formula_version, metadata_content_hash,
       input_fingerprint, status, rarity_points, rarity_points_capped, error_code,
       calculated_at)
    SELECT collection, token_id, lifecycle, formula_version, metadata_content_hash,
      input_fingerprint, status, rarity_points, rarity_points_capped, error_code, now()
    FROM jsonb_to_recordset($1::jsonb) AS x(
      collection text, token_id numeric, lifecycle integer, formula_version text,
      metadata_content_hash text, input_fingerprint text, status text,
      rarity_points numeric, rarity_points_capped numeric, error_code text)
    ON CONFLICT (collection, token_id, lifecycle, formula_version) DO UPDATE SET
      metadata_content_hash=EXCLUDED.metadata_content_hash,
      input_fingerprint=EXCLUDED.input_fingerprint,
      status=EXCLUDED.status,
      rarity_points=EXCLUDED.rarity_points,
      rarity_points_capped=EXCLUDED.rarity_points_capped,
      error_code=EXCLUDED.error_code,
      calculated_at=EXCLUDED.calculated_at
    WHERE metadata.token_rarity.input_fingerprint IS DISTINCT FROM EXCLUDED.input_fingerprint
      OR metadata.token_rarity.metadata_content_hash IS DISTINCT FROM EXCLUDED.metadata_content_hash`,
    [
      JSON.stringify(
        calculations.map((item) => ({
          collection: item.collection,
          token_id: item.tokenId,
          lifecycle: item.lifecycle,
          formula_version: rarityFormulaVersion,
          metadata_content_hash: item.metadataContentHash,
          input_fingerprint: item.inputFingerprint,
          status: item.status,
          rarity_points: item.rarityPoints,
          rarity_points_capped: item.rarityPointsCapped,
          error_code: item.errorCode
        }))
      )
    ]
  );
}
