import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export const ARENA_MEDIA_QUOTA_BYTES = 20 * 1024 ** 3;
export const ARENA_MEDIA_TOURNAMENT_RESERVED_BYTES = 3 * 1024 ** 3;
export const ARENA_MEDIA_RESERVED_BYTES =
  2 * ARENA_MEDIA_TOURNAMENT_RESERVED_BYTES;
export const ARENA_MEDIA_FILE_BYTES = 128 * 1024 ** 2;

export type MediaStorageBudget = {
  mediaStoredBytes: number;
  mediaQuotaBytes: number;
  mediaReserveBytes: number;
};

/** Admission allocation, separate from actual filesystem free space. Never deletes
 * or follows links. Fixed asset counts, bounded downloads and the media service's
 * per-file limit bound each accepted tournament to a three-GiB reserve. The
 * capacity gate scales that reserve with the number of unpublished tournaments. */
export async function arenaMediaStorageBudget(
  root: string,
  quotaBytes = ARENA_MEDIA_QUOTA_BYTES,
  reserveBytes = ARENA_MEDIA_RESERVED_BYTES,
  maxEntries = 100000
): Promise<MediaStorageBudget> {
  if (
    !Number.isSafeInteger(quotaBytes) ||
    !Number.isSafeInteger(reserveBytes) ||
    reserveBytes < 1 ||
    quotaBytes <= reserveBytes ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1
  )
    throw new Error("Invalid Arena media storage allocation.");
  const pending = [root];
  let mediaStoredBytes = 0;
  let entries = 0;
  while (pending.length) {
    if (++entries > maxEntries)
      throw new Error("Arena media storage inventory exceeds its scan bound.");
    const path = pending.pop()!;
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error("Arena media storage must not contain symbolic links.");
    // The backup layout also retains root-only deployment recovery records here.
    // They are administrative archives, never worker-controlled battle assets.
    if (path === join(root, "_deployment")) {
      if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o077) !== 0)
        throw new Error(
          "Arena deployment archive must remain private and root-owned."
        );
      continue;
    }
    if (info.isDirectory()) {
      const children = await readdir(path);
      if (children.length + pending.length + entries > maxEntries)
        throw new Error(
          "Arena media storage inventory exceeds its scan bound."
        );
      pending.push(...children.map((name) => join(path, name)));
    } else if (info.isFile()) {
      // Sparse logical files also count; allocated blocks include actual disk use.
      mediaStoredBytes += Math.max(info.size, info.blocks * 512);
      if (!Number.isSafeInteger(mediaStoredBytes))
        throw new Error("Arena media storage size is invalid.");
      if (mediaStoredBytes + reserveBytes > quotaBytes)
        throw new Error("Arena media storage allocation is full.");
    } else {
      throw new Error("Arena media storage contains an unsupported file type.");
    }
  }
  return {
    mediaStoredBytes,
    mediaQuotaBytes: quotaBytes,
    mediaReserveBytes: reserveBytes
  };
}
