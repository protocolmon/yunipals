import { rendererVersion } from "./render/snapshot.js";
import { contentHash } from "./source/canonical.js";

export type PublicationRequestInput = {
  asset_key: string | null;
  input_hash: string | null;
  event_transaction: string | null;
  event_log: number | null;
  event_block_hash: string | null;
};

/** Preserve the installed request identity unless inclusion-aware native Base
 * metadata is selected. Other chains must not be requeued by this migration.
 */
export function publicationRequestKey(
  input: PublicationRequestInput,
  includeInclusionHash = false
) {
  const fields: (string | number | null)[] = [
    rendererVersion,
    input.asset_key ?? null,
    input.input_hash ?? null,
    input.event_transaction ?? null,
    input.event_log ?? null
  ];
  if (includeInclusionHash) fields.push(input.event_block_hash ?? null);
  return contentHash(fields);
}
