/** The canonical journal preserves the ABI decoder's numeric uint40 value.
 * Legacy metadata represents rarityScore as a decimal string. Keep that
 * conversion in compatibility reads, without changing the canonical evidence.
 * All callers bind the canonical_event relation to the fixed alias `e`.
 */
export const nativeBaseTraitsSql = `jsonb_set(e.args::jsonb->'yunipal',
  '{rarityScore}',to_jsonb(e.args::jsonb->'yunipal'->>'rarityScore'),false)`;
