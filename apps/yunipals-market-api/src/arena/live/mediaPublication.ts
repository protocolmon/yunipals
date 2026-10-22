import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { canonicalJson, sha256 } from "../draw";
import { ArenaIntake, ArenaRequestError } from "./intake";
import { within } from "./mediaApi";
import { mediaFolder, mediaIncarnation } from "./mediaPaths";

export const publishedMediaTypes: Record<string, string> = {
  "film.mp4": "video/mp4",
  "native-sfx.mp4": "video/mp4",
  "SF1.png": "image/png",
  "SF2.png": "image/png",
  "FINAL.png": "image/png",
  "input.json": "application/json",
  "outcome.json": "application/json",
  "prompts.json": "application/json",
  "film.json": "application/json",
  "receipts.json": "application/json",
  "media-policy.json": "application/json",
  "credits.txt": "text/plain; charset=utf-8"
};
type FileProof = { sha256: string; bytes: number };
export type MediaPublicationManifest = {
  version: 1;
  deployment: string;
  tournamentId: string;
  incarnation: string;
  inputHash: string;
  outcomeHash: string;
  filmSha256: string;
  files: Record<string, FileProof>;
};
const digest = (value: unknown) => `0x${sha256(canonicalJson(value))}`;
const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function parseMediaPublication(
  value: unknown,
  publicationHash: string
): MediaPublicationManifest {
  if (
    !record(value) ||
    value.version !== 1 ||
    !validHash(publicationHash) ||
    digest(value) !== publicationHash ||
    typeof value.deployment !== "string" ||
    !/^8453:0x[0-9a-f]{40}$/.test(value.deployment) ||
    typeof value.tournamentId !== "string" ||
    !/^[1-9][0-9]{0,77}$/.test(value.tournamentId) ||
    !validHash(value.incarnation) ||
    !validHash(value.inputHash) ||
    !validHash(value.outcomeHash) ||
    typeof value.filmSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.filmSha256) ||
    !record(value.files) ||
    Object.keys(value.files).sort().join() !==
      Object.keys(publishedMediaTypes).sort().join()
  )
    throw new Error("Media publication manifest is invalid.");
  for (const entry of Object.values(value.files)) {
    if (
      !record(entry) ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      typeof entry.bytes !== "number" ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.bytes > 128 * 1024 * 1024
    )
      throw new Error("Media publication file proof is invalid.");
  }
  if ((value.files["film.mp4"] as FileProof).sha256 !== value.filmSha256)
    throw new Error("Media publication film proof differs.");
  return value as MediaPublicationManifest;
}

async function fileProof(path: string) {
  const before = await stat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.size < 1n ||
    before.size > 128n * 1024n * 1024n
  )
    throw new Error("Published media file is invalid.");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  const after = await stat(path, { bigint: true });
  const identity = (s: typeof before) =>
    `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  if (identity(before) !== identity(after))
    throw new Error("Published media file changed during verification.");
  return {
    sha256: hash.digest("hex"),
    bytes: Number(after.size),
    identity: identity(after)
  };
}
/** Private migration verification; unlike the public reader this accepts a
 * confined provider path as well as names in the publication allowlist. */
export async function mediaFileProof(folder: string, name: string) {
  const { sha256: checksum, bytes } = await fileProof(
    await within(folder, name)
  );
  return { sha256: checksum, bytes };
}
const verifiedFiles = new Map<string, string>();
export async function verifyPublicationFile(
  folder: string,
  name: string,
  expected: FileProof
) {
  if (!Object.hasOwn(publishedMediaTypes, name))
    throw new Error("Unknown published media file.");
  const path = await within(folder, name);
  const info = await stat(path, { bigint: true });
  const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  const key = `${path}/${expected.sha256}/${expected.bytes}`;
  if (!info.isFile() || info.size !== BigInt(expected.bytes))
    throw new Error("Published media file differs from its manifest.");
  if (verifiedFiles.get(key) !== identity) {
    const actual = await fileProof(path);
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes)
      throw new Error("Published media checksum differs from its manifest.");
    if (verifiedFiles.size >= 256)
      verifiedFiles.delete(verifiedFiles.keys().next().value!);
    verifiedFiles.set(key, actual.identity);
  }
  return path;
}

export async function buildMediaPublication(
  folder: string,
  identity: Omit<MediaPublicationManifest, "version" | "files" | "filmSha256">
) {
  const files: Record<string, FileProof> = {};
  for (const name of Object.keys(publishedMediaTypes).sort()) {
    const { sha256: checksum, bytes } = await fileProof(
      await within(folder, name)
    );
    files[name] = { sha256: checksum, bytes };
  }
  const film = JSON.parse(
    await readFile(await within(folder, "film.json"), "utf8")
  ) as { sha256?: string; outcomeSha256?: string };
  const input = JSON.parse(
    await readFile(await within(folder, "input.json"), "utf8")
  ) as { inputSha256?: string; input?: unknown };
  const outcome = JSON.parse(
    await readFile(await within(folder, "outcome.json"), "utf8")
  ) as { inputSha256?: string; outcomeSha256?: string; outcome?: unknown };
  if (
    film.sha256 !== files["film.mp4"]!.sha256 ||
    film.outcomeSha256 !== identity.outcomeHash.slice(2) ||
    input.inputSha256 !== identity.inputHash.slice(2) ||
    digest(input.input) !== identity.inputHash ||
    outcome.inputSha256 !== identity.inputHash.slice(2) ||
    outcome.outcomeSha256 !== identity.outcomeHash.slice(2) ||
    digest(outcome.outcome) !== identity.outcomeHash
  )
    throw new Error(
      "Media publication sidecars differ from the current input/result."
    );
  const manifest: MediaPublicationManifest = {
    version: 1,
    ...identity,
    filmSha256: files["film.mp4"]!.sha256,
    files
  };
  const publicationHash = digest(manifest);
  parseMediaPublication(manifest, publicationHash);
  return { manifest, publicationHash };
}

export async function nativeMediaPublication(
  service: ArenaIntake,
  storage: string,
  id: string
) {
  await service.ready();
  const context = await service.tournamentContext(id),
    t = context.observation!.tournament;
  if (
    context.state.phase !== "settled" ||
    !context.state.inputHash ||
    !context.state.resultHash
  )
    return null;
  const row = (
    await service.pool.query<{
      manifest: unknown;
      publication_hash: string;
      film_sha256: string;
    }>(
      `SELECT p.manifest,m.publication_hash,m.film_sha256 FROM yunipals_arena.media_job m
    JOIN yunipals_arena.media_publication p USING(deployment,tournament_id,incarnation,publication_hash)
    JOIN yunipals_arena.adjudication a USING(deployment,tournament_id,incarnation)
    JOIN yunipals_arena.frozen_input f USING(deployment,tournament_id,incarnation)
    WHERE m.deployment=$1 AND m.tournament_id=$2 AND m.incarnation=$3 AND m.state='ready'
      AND m.input_hash=$4 AND m.outcome_hash=$5 AND a.state='valid' AND a.input_hash=$4 AND a.outcome_hash=$5
      AND f.input_hash=$4 AND f.revealed_at IS NOT NULL AND f.revealed_event_id=$6 AND f.revealed_block_hash=$7`,
      [
        service.deployment,
        id,
        context.incarnation,
        context.state.inputHash,
        context.state.resultHash,
        t.inputFrozen?.id ?? null,
        t.inputFrozen?.blockHash ?? null
      ]
    )
  ).rows[0];
  if (!row) return null;
  const manifest = parseMediaPublication(row.manifest, row.publication_hash);
  if (
    manifest.deployment !== service.deployment ||
    manifest.tournamentId !== id ||
    manifest.incarnation !== context.incarnation ||
    manifest.inputHash !== context.state.inputHash ||
    manifest.outcomeHash !== context.state.resultHash ||
    manifest.filmSha256 !== row.film_sha256 ||
    (context.state.videoHash &&
      context.state.videoHash !== `0x${manifest.filmSha256}`)
  )
    throw new Error("Published media no longer matches its native result.");
  const folder = mediaFolder(
    join(storage, "published"),
    service.deployment,
    id,
    mediaIncarnation(service.deployment, id, context)
  );
  return { context, manifest, publicationHash: row.publication_hash, folder };
}

export async function requireNativePublication(
  service: ArenaIntake,
  storage: string,
  id: string,
  selector: { incarnation?: string; publication?: string } = {}
) {
  const current = await nativeMediaPublication(service, storage, id);
  if (
    !current ||
    (selector.incarnation &&
      selector.incarnation !== current.context.incarnation) ||
    (selector.publication && selector.publication !== current.publicationHash)
  )
    throw new ArenaRequestError(404, "Published video artifact not found.");
  return current;
}

export async function commitMediaPublication(
  db: PoolClient,
  service: ArenaIntake,
  publication: Awaited<ReturnType<typeof buildMediaPublication>>,
  evidence: unknown
) {
  await service.ready(db);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `arena/capacity/${service.deployment}`
  ]);
  await recordMediaPublication(db, publication, evidence);
  await db.query("DELETE FROM yunipals_arena.capacity WHERE deployment=$1", [
    service.deployment
  ]);
}

/** Caller must authorize current publication or explicit fenced adoption in
 * the same transaction. This only records the immutable manifest/pointer. */
export async function recordMediaPublication(
  db: PoolClient,
  publication: Awaited<ReturnType<typeof buildMediaPublication>>,
  evidence: unknown
) {
  const m = publication.manifest;
  await db.query(
    `INSERT INTO yunipals_arena.media_publication(deployment,tournament_id,incarnation,publication_hash,manifest,source_evidence)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [
      m.deployment,
      m.tournamentId,
      m.incarnation,
      publication.publicationHash,
      m,
      evidence
    ]
  );
  const saved = await db.query(
    `UPDATE yunipals_arena.media_job SET state='ready',detail=NULL,film_sha256=$4,publication_hash=$5,updated_at=now()
    WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND input_hash=$6 AND outcome_hash=$7`,
    [
      m.deployment,
      m.tournamentId,
      m.incarnation,
      m.filmSha256,
      publication.publicationHash,
      m.inputHash,
      m.outcomeHash
    ]
  );
  if (saved.rowCount !== 1)
    throw new Error("Media publication lost its bound job.");
}
