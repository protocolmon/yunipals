import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import type { Hex } from "viem";
import { mediaFolder, mediaIncarnation } from "./mediaPaths";
import { within } from "./mediaApi";
import type { ArenaTournamentContext } from "./intake";
import {
  parseMediaPublication,
  verifyPublicationFile,
  type MediaPublicationManifest
} from "./mediaPublication";

export { mediaIncarnation } from "./mediaPaths";

/** Match the completed film served by the public artifact route to its saved hash.
 * A provider completion or an unfinished local file cannot unlock anyone's funds. */
export async function publishedPayoutFilm(
  pool: Pool,
  deployment: string,
  id: string,
  storage?: string,
  context?: ArenaTournamentContext
): Promise<Hex> {
  if (!storage)
    throw new Error("Payout release requires published media storage.");
  const row = (
    await pool.query<{
      film_sha256: string | null;
      manifest?: MediaPublicationManifest;
      publication_hash?: string;
    }>(
      context
        ? `SELECT m.film_sha256,p.manifest,m.publication_hash FROM yunipals_arena.media_job m
      JOIN yunipals_arena.media_publication p USING(deployment,tournament_id,incarnation,publication_hash)
      JOIN yunipals_arena.adjudication a ON a.deployment=m.deployment AND a.tournament_id=m.tournament_id AND a.incarnation=m.incarnation
      JOIN yunipals_arena.frozen_input f ON f.deployment=m.deployment AND f.tournament_id=m.tournament_id AND f.incarnation=m.incarnation
      WHERE m.deployment=$1 AND m.tournament_id=$2 AND m.incarnation=$3 AND m.state='ready'
        AND a.state='valid' AND a.input_hash=$4 AND a.outcome_hash=$5 AND m.input_hash=$4 AND m.outcome_hash=$5
        AND f.input_hash=$4 AND f.revealed_at IS NOT NULL AND f.revealed_event_id=$6 AND f.revealed_block_hash=$7`
        : `SELECT m.film_sha256 FROM yunipals_arena.media_job m
     JOIN yunipals_arena.tournament t ON t.deployment=m.deployment AND t.id=m.tournament_id
     WHERE m.deployment=$1 AND m.tournament_id=$2 AND m.state='ready' AND t.state->>'phase'='settled'`,
      context
        ? [
            deployment,
            id,
            context.incarnation,
            context.state.inputHash,
            context.state.resultHash,
            context.observation?.tournament.inputFrozen?.id ?? null,
            context.observation?.tournament.inputFrozen?.blockHash ?? null
          ]
        : [deployment, id]
    )
  ).rows[0];
  if (
    !row?.film_sha256 ||
    !/^[0-9a-f]{64}$/.test(row.film_sha256) ||
    /^0{64}$/.test(row.film_sha256)
  )
    throw new Error("Payouts wait for the completed published film.");
  if (context && context.state.phase !== "settled")
    throw new Error("Payouts require the current settled origin.");
  const folder = mediaFolder(
    join(storage, "published"),
    deployment,
    id,
    context ? mediaIncarnation(deployment, id, context) : undefined
  );
  if (context) {
    const manifest = parseMediaPublication(row.manifest, row.publication_hash!);
    if (
      manifest.deployment !== deployment ||
      manifest.tournamentId !== id ||
      manifest.incarnation !== context.incarnation ||
      manifest.inputHash !== context.state.inputHash ||
      manifest.outcomeHash !== context.state.resultHash ||
      manifest.filmSha256 !== row.film_sha256
    )
      throw new Error(
        "Payout publication differs from its current input/result."
      );
    for (const [name, proof] of Object.entries(manifest.files))
      await verifyPublicationFile(folder, name, proof);
    return `0x${row.film_sha256}`;
  }
  const file = await within(folder, "film.mp4");
  const info = await stat(file);
  if (!info.isFile() || info.size === 0 || info.size > 128 * 1024 * 1024)
    throw new Error("Published film is missing or invalid.");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  if (hash.digest("hex") !== row.film_sha256)
    throw new Error("Published film checksum differs; payouts remain held.");
  return `0x${row.film_sha256}`;
}
