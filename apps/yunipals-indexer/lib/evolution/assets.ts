import pg from "pg";
import { EvolutionReader } from "../../../../packages/yunipals-indexer-server/src/evolution.js";
import { PortalAssets } from "../portals/assets.js";
import { PortalUserError } from "../portals/errors.js";

export function createEvolutionAssetRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  if (
    !env.PORTALS_INDEXER_DATABASE_URL ||
    !env.PORTALS_INDEXER_RELEASE_ID ||
    !env.PORTALS_ASSET_DIRECTORY ||
    !env.PORTALS_PUBLIC_ORIGIN
  )
    throw new Error("Evolution publication storage is not configured.");
  const pool = new pg.Pool({
    connectionString: env.PORTALS_INDEXER_DATABASE_URL,
    max: 4,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000
  });
  const reader = new EvolutionReader(pool, env.PORTALS_INDEXER_RELEASE_ID);
  const assets = new PortalAssets(
    env.PORTALS_ASSET_DIRECTORY,
    env.PORTALS_PUBLIC_ORIGIN,
    [],
    undefined,
    false,
    "/v1/evolution/assets"
  );
  return { reader, assets, close: () => pool.end() };
}

export type EvolutionAssetRuntime = Pick<
  ReturnType<typeof createEvolutionAssetRuntime>,
  "reader" | "assets"
>;

export async function readPublishedEvolutionAsset(
  runtime: EvolutionAssetRuntime,
  file: string,
  artwork?: string
) {
  const match = /^([0-9a-f]{64})\.(png|json)$/.exec(file);
  if (
    !match ||
    (artwork !== undefined &&
      (!/^[0-9a-f]{64}$/.test(artwork) || match[2] !== "png"))
  )
    throw new PortalUserError("Invalid asset.", 404);
  const publications = await runtime.reader.publications(
    `0x${artwork ?? match[1]}`
  );
  let published = publications.some(
    (p) =>
      (match[2] === "json" ? p.metadataHash : p.artworkHash) === `0x${match[1]}`
  );
  if (artwork) {
    published = false;
    for (const record of publications) {
      if (record.artworkHash !== `0x${artwork}`) continue;
      const metadata = JSON.parse(
        (
          await runtime.assets.read(record.metadataHash.slice(2), "json")
        ).toString()
      );
      const expected = `${runtime.assets.origin}/v1/evolution/layers/${artwork}/${file}`;
      if (Object.values(metadata.yunipals?.holo ?? {}).includes(expected)) {
        published = true;
        break;
      }
    }
  }
  if (!published) throw new PortalUserError("Asset not published.", 404);
  return {
    bytes: await runtime.assets.read(match[1], match[2] as "png" | "json"),
    contentType: match[2] === "png" ? "image/png" : "application/json"
  };
}
