import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import type { Hex } from "viem";
import { mediaFolder } from "./media";
import { within } from "./mediaApi";

/** Match the completed film served by the public artifact route to its saved hash.
 * A provider completion or an unfinished local file cannot unlock anyone's funds. */
export async function publishedPayoutFilm(
  pool: Pool,
  deployment: string,
  id: string,
  storage?: string
): Promise<Hex> {
  if (!storage)
    throw new Error("Payout release requires published media storage.");
  const row = (
    await pool.query<{ film_sha256: string | null }>(
      `SELECT m.film_sha256 FROM yunipals_arena.media_job m
     JOIN yunipals_arena.tournament t ON t.deployment=m.deployment AND t.id=m.tournament_id
     WHERE m.deployment=$1 AND m.tournament_id=$2 AND m.state='ready' AND t.state->>'phase'='settled'`,
      [deployment, id]
    )
  ).rows[0];
  if (
    !row?.film_sha256 ||
    !/^[0-9a-f]{64}$/.test(row.film_sha256) ||
    /^0{64}$/.test(row.film_sha256)
  )
    throw new Error("Payouts wait for the completed published film.");
  const folder = mediaFolder(join(storage, "published"), deployment, id);
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
