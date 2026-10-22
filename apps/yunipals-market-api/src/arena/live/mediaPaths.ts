import { resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import { sha256 } from "../draw";
import type { ArenaTournamentContext } from "./intake";

export function mediaFolder(
  storage: string,
  deployment: string,
  id: string,
  incarnation?: string
) {
  if (!/^[1-9][0-9]{0,77}$/.test(id))
    throw new Error("Invalid media tournament ID.");
  if (incarnation !== undefined && !/^0x[0-9a-f]{64}$/.test(incarnation))
    throw new Error("Invalid media tournament origin.");
  return resolve(
    storage,
    sha256(deployment),
    id,
    ...(incarnation ? [incarnation] : [])
  );
}
export function mediaIncarnation(
  deployment: string,
  id: string,
  context: ArenaTournamentContext
) {
  if (context.cipherContext === `${deployment}/${id}`) return undefined;
  if (context.cipherContext !== `${deployment}/${id}/${context.incarnation}`)
    throw new Error("Unsupported media encryption context.");
  return context.incarnation;
}

/** Historical private identity, not proof of current canonical existence. It
 * lets an already-paid orphaned response recover into its own private folder. */
export async function savedMediaFolder(
  pool: Pick<Pool | PoolClient, "query">,
  storage: string,
  deployment: string,
  id: string,
  incarnation: string
) {
  if (!/^0x[0-9a-f]{64}$/.test(incarnation))
    throw new Error("An explicit media origin is required.");
  const row = (
    await pool.query<{ cipher_context: string }>(
      "SELECT cipher_context FROM yunipals_arena.tournament_identity WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
      [deployment, id, incarnation]
    )
  ).rows[0];
  if (!row) throw new Error("Saved media identity is unavailable.");
  const suffix =
    row.cipher_context === `${deployment}/${id}` ? undefined : incarnation;
  if (suffix && row.cipher_context !== `${deployment}/${id}/${incarnation}`)
    throw new Error("Saved media context is invalid.");
  return mediaFolder(storage, deployment, id, suffix);
}
