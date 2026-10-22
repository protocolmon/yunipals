import {
  ownershipReadConfig,
  ponderSchema,
  unifiedOwnershipReads
} from "../offchain/sql.js";

export function generationOwnershipProof(alias: string) {
  if (!/^[a-z_]+$/.test(alias))
    throw new Error("Invalid projection proof alias.");
  return unifiedOwnershipReads
    ? `EXISTS(SELECT 1 FROM ${ponderSchema}._unified_read_release ownership_release WHERE ownership_release.singleton
      AND ownership_release.release_id='${ownershipReadConfig.releaseId}'
      AND ${alias}.ownership_release_id=ownership_release.release_id AND ${alias}.ownership_read_identity=ownership_release.identity)`
    : `COALESCE(to_jsonb(${alias})->>'ownership_release_id','')=''`;
}
