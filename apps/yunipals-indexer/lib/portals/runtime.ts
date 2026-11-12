import pg from "pg";
import { connectPortalChain } from "./chain.js";
import { PortalAssets } from "./assets.js";
import { PortalLedgerStore } from "./ledger-store.js";
import { PortalStore } from "./store.js";
import { portalDatabaseOptions } from "./database.js";

export async function createPortalRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  const database = portalDatabaseOptions(env);
  if (!env.PORTALS_ASSET_DIRECTORY || !env.PORTALS_PUBLIC_ORIGIN)
    throw new Error("Portal artifact storage and public origin are required.");
  const chain = await connectPortalChain(env);
  const db = new pg.Pool(database);
  const store = new PortalStore(
    db,
    `${chain.deployment.chainId}:${chain.deployment.grading.toLowerCase()}`
  );
  const ledger = new PortalLedgerStore(
    db,
    `${chain.deployment.chainId}:${chain.deployment.collection.toLowerCase()}:${chain.deployment.grading.toLowerCase()}`
  );
  const origin = env.PORTALS_PUBLIC_ORIGIN;
  const hosts = [
    new URL(origin).hostname,
    ...(env.PORTALS_ARTWORK_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  ];
  const assets = new PortalAssets(
    env.PORTALS_ASSET_DIRECTORY,
    origin,
    hosts,
    env.PORTALS_IPFS_GATEWAY,
    env.PORTALS_ASSET_SHARED_READ === "true"
  );
  return { chain, store, assets, ledger, db, close: () => db.end() };
}
export type PortalRuntime = Omit<
  Awaited<ReturnType<typeof createPortalRuntime>>,
  "db"
>;
