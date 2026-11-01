import {
  monsterAssetKey,
  parseMonsterVersionInfo,
  type MonsterVersionAsset
} from "@protopals/yunipals-market-core/monsterVersions";
import { record } from "@protopals/yunipals-market-core/validation";
import { environment } from "@/environment";
import { IndexerError } from "@/lib/yunipalsIndexer";
import type { MonsterVersionInfo } from "@protopals/yunipals-market-core/monsterVersions";
export { monsterAssetKey } from "@protopals/yunipals-market-core/monsterVersions";

async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${environment.yunipalsIndexerUrl}${path}`, {
    signal
  });
  if (!response.ok)
    throw new IndexerError(
      response.status,
      "monster_versions_unavailable",
      response.status === 409
        ? "This page has expired. Refresh the collection."
        : "Monster versions are temporarily unavailable."
    );
  return response.json();
}
export async function fetchVersionCapabilities(signal?: AbortSignal) {
  const data = record(await read("/v1/monster-version-capabilities", signal));
  return data.version === 1 &&
    data.enabled === true &&
    typeof data.revision === "string" &&
    /^[a-f0-9]{64}$/.test(data.revision)
    ? {
        revision: data.revision
      }
    : null;
}
export async function fetchVersionSummaries(
  assets: MonsterVersionAsset[],
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  for (const asset of assets)
    params.append("asset", `${monsterAssetKey(asset)}:${asset.lifecycle}`);
  const data = record(await read(`/v1/monster-versions?${params}`, signal));
  const items = record(data.items);
  const result: Record<string, MonsterVersionInfo> = {};
  for (const a of assets) {
    const info = parseMonsterVersionInfo(items[monsterAssetKey(a)], a);
    if (info) {
      if (info.revision !== data.revision)
        throw new Error("Version mapping changed. Refresh the collection.");
      result[monsterAssetKey(a)] = info;
    }
  }
  return result;
}
