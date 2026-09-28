// This source snapshot reads the current metadata tables. Archive publication
// is a separate production change and must be reconciled before a cutover.
export const metadataReadRelation = "metadata.token_metadata";
export const metadataSearchReadRelation = "metadata.token_search";
export const metadataTraitReadRelation = "metadata.token_trait";
