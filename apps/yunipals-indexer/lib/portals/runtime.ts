import pg from "pg";
import { connectPortalChain } from "./chain.js";
import { PortalAssets } from "./assets.js";
import { PortalLedgerStore } from "./ledger-store.js";
import { PortalStore } from "./store.js";
import { portalDatabaseOptions } from "./database.js";
import { configuredPortalIntake } from "./intake.js";
import { SharedPortalLedger } from "./shared-ledger.js";

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
  const mode = env.PORTALS_INDEXER_MODE ?? "legacy";
  if (!["legacy", "unified"].includes(mode))
    throw new Error("Invalid portal indexer mode.");
  const readPool =
    mode === "unified"
      ? new pg.Pool({
          connectionString: env.PORTALS_INDEXER_DATABASE_URL,
          max: 4,
          connectionTimeoutMillis: 5000,
          statement_timeout: 10000
        })
      : null;
  if (
    mode === "unified" &&
    (!env.PORTALS_INDEXER_DATABASE_URL ||
      !env.PORTALS_INDEXER_RELEASE_ID ||
      !env.PORTALS_INDEXER_READ_SCHEMA ||
      !env.PORTALS_COMPETITION)
  )
    throw new Error(
      "Explicit shared portal database, release, read schema and competition required."
    );
  const ledger = readPool
    ? new SharedPortalLedger(
        readPool,
        {
          releaseId: env.PORTALS_INDEXER_RELEASE_ID!,
          readSchema: env.PORTALS_INDEXER_READ_SCHEMA!,
          competition: env.PORTALS_COMPETITION!.toLowerCase(),
          confirmations: Number(env.PORTALS_CONFIRMATIONS ?? "12")
        },
        chain
      )
    : new PortalLedgerStore(
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
  const intake = configuredPortalIntake(env);
  return {
    chain,
    store,
    assets,
    ledger,
    intake,
    db,
    close: async () => {
      await Promise.all([db.end(), readPool?.end()]);
    }
  };
}
export type PortalRuntime = Omit<
  Awaited<ReturnType<typeof createPortalRuntime>>,
  "db" | "intake"
> & { intake?: ReturnType<typeof configuredPortalIntake> };
