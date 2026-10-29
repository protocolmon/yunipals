import { readArenaSettings } from "./protocol";
import pg from "pg";
import { parseAbi } from "viem";
import { AnimeFighters } from "./animeFighters";
import { ArenaCapacity } from "./capacity";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { ARENA_USDC } from "@protopals/yunipals-market-core/arena";
import { arenaConfig, arenaRpcClients, arenaSigner } from "./config";
import { StrategyCipher } from "./crypto";
import { ArenaIntake, ArenaRequestError } from "./intake";
import { createAdmission } from "./admission";
import {
  ArenaIdentities,
  indexerMetadata,
  loadIdentityProfiles
} from "./identity";
import {
  ARENA_ISLANDS,
  ARENA_POOL_HASH,
  loadLiveArenaCatalog,
  loadAnimeArenaCatalog,
  loadModeArenaCatalog
} from "./catalog";
import { ArenaInputCompiler } from "./input";
import { ArenaIdentityAnalysis } from "./identityAnalysis";
import { transaction } from "@/db/pool";
import { arenaNativeConfiguration } from "./nativeSource";
import { arenaTransactionMigration } from "./transactionSchema";
import { selectedArenaRuntimeSource } from "./selectedSourceRuntime";

export async function arenaRuntime(options: { native?: boolean } = {}) {
  const native = arenaNativeConfiguration();
  if (native.mode === "unified" && !options.native)
    throw new Error("This Arena entrypoint has not enabled native consumers.");
  const config = arenaConfig();
  const root = process.env.ARENA_REPOSITORY_ROOT;
  if (!root) throw new Error("ARENA_REPOSITORY_ROOT is required.");
  const catalog = loadModeArenaCatalog(
    root,
    config.mediaKind,
    config.eligibilityRegistry,
    config.contractVersion
  );
  if (catalog.rulesHash !== config.rulesHash)
    throw new Error("Local rules manifest differs from ARENA_RULES_HASH.");
  const clients = arenaRpcClients(),
    base = clients.get(8453)!;
  const settings = await readArenaSettings(base, {
    contract: config.deployment.contract,
    mediaKind: config.mediaKind,
    contractVersion: config.contractVersion
  });
  if (
    settings.paymentToken.toLowerCase() !== ARENA_USDC.toLowerCase() ||
    settings.entryFee !==
      (config.mediaKind === "anime" ? 1_000_000n : 2_000_000n) ||
    settings.winnerBps !== (config.mediaKind === "anime" ? 8000 : 7500) ||
    settings.islandBps !== 500 ||
    settings.joinWindow !== 604800 ||
    settings.strategyWindow !== 86400 ||
    settings.rulesHash !== config.rulesHash ||
    settings.poolHash !== ARENA_POOL_HASH ||
    settings.resolutionWindow !== catalog.manifest.timing.resolutionSeconds ||
    settings.islands.toLowerCase() !== ARENA_ISLANDS ||
    settings.wrapper.toLowerCase() !==
      "0xb0407dbe851f8318bd31404a49e658143c982f23"
  )
    throw new Error(
      "Arena contract settings do not match the approved launch configuration."
    );
  const anime =
    config.mediaKind === "anime"
      ? new AnimeFighters(
          base,
          config.eligibilityRegistry!,
          config.fighterAssetsOrigin,
          fetch,
          "media" in catalog.manifest
            ? catalog.manifest.media.recipeSha256
            : undefined
        )
      : undefined;
  if (anime) {
    const actual =
      settings.eligibility ??
      (await base.readContract({
        address: config.deployment.contract,
        abi: parseAbi(["function eligibility() view returns (address)"]),
        functionName: "eligibility"
      }));
    if (actual.toLowerCase() !== config.eligibilityRegistry)
      throw new Error("Anime eligibility registry differs from the contract.");
  }
  const signer = config.admissionKeyFile
    ? arenaSigner(config.admissionKeyFile)
    : null;
  if (
    signer &&
    signer.address.toLowerCase() !== settings.admissionSigner.toLowerCase()
  )
    throw new Error("Arena admission signer does not match the contract.");
  if (config.entriesEnabled && !signer)
    throw new Error("Paid entry requires the admission signer.");
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    application_name: "yunipals_arena",
    max: config.contractVersion === 2 ? 2 : 8,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    lock_timeout: 2000,
    idle_in_transaction_session_timeout: 15000
  });
  const sourcePool =
    native.mode === "unified"
      ? new pg.Pool({
          connectionString: native.databaseUrl,
          application_name: "arena_native_source",
          max: config.contractVersion === 2 ? 2 : 4,
          connectionTimeoutMillis: 2000,
          statement_timeout: 5000,
          lock_timeout: 2000,
          idle_in_transaction_session_timeout: 15000,
          options: "-c default_transaction_read_only=on"
        })
      : undefined;
  try {
    const { nativeSource, binding } = await selectedArenaRuntimeSource({
      pool,
      sourcePool,
      native,
      deployment: config.deployment,
      base,
      mediaKind: config.mediaKind
    });
    const service = new ArenaIntake(
      pool,
      config.deployment.id,
      config.deployment.contract,
      config.origin,
      new StrategyCipher(config.encryptionKey),
      {
        message: (input) => base.verifyMessage(input),
        strategy: (input) => base.verifyTypedData(input)
      },
      nativeSource,
      binding,
      config.mediaKind,
      config.contractVersion
    );
    const selected = (
      await pool.query("SELECT 1 FROM yunipals_arena.deployment WHERE id=$1", [
        config.deployment.id
      ])
    ).rowCount;
    // Existing deployments must match even when an old entrypoint would query
    // operational tables directly. A fresh legacy projector may still bootstrap
    // its absent row; native adoption is always explicit.
    if (selected || nativeSource) await service.assertSourceSelection();
    if (nativeSource) {
      const migration = (
        await pool.query<{ checksum: string }>(
          "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
          [arenaTransactionMigration.version]
        )
      ).rows[0];
      if (migration?.checksum !== arenaTransactionMigration.checksum)
        throw new Error(
          "Native Arena execution schema does not match this runtime."
        );
    }
    const capacity = new ArenaCapacity(
      pool,
      config.deployment.id,
      service,
      config.mediaKind
    );
    const identityAnalysis = new ArenaIdentityAnalysis(
      pool,
      config.deployment.id,
      config.openaiFundingMode,
      service,
      () => capacity.check(false)
    );
    const identities = new ArenaIdentities(
      pool,
      config.deployment.id,
      loadIdentityProfiles(root),
      indexerMetadata(fetch, config.indexerUrl),
      nativeSource
        ? (id) =>
            transaction(pool, (db) => service.tournamentContext(id, db, true))
        : undefined,
      (nft, payload, wallet) => identityAnalysis.resolve(nft, payload, wallet),
      anime
        ? async (nft) => {
            const block = await base.getBlock({ blockTag: "latest" });
            return anime.snapshot(nft, await anime.eligible(nft, block.number));
          }
        : undefined
    );
    const compiler = new ArenaInputCompiler(service, catalog, identities);
    const admit = signer
      ? createAdmission(
          service,
          signer,
          clients,
          (id, nft, wallet) =>
            identities.ensure(id, nft, nft.incarnation, wallet),
          anime
        )
      : undefined;
    return {
      close: async () => {
        await Promise.all([pool.end(), sourcePool?.end()]);
      },
      capacity,
      anime,
      sourcePool,
      config,
      clients,
      pool,
      service,
      identities,
      identityAnalysis,
      compiler,
      catalog,
      admit: admit
        ? async (...args: Parameters<typeof admit>) => {
            if (
              config.launchMode === "pilot" &&
              !config.pilotWallets.includes(args[1].toLowerCase())
            )
              throw new ArenaRequestError(
                403,
                "Paid entry is limited to the controlled pilot wallets while launch checks are completed."
              );
            await capacity.check(false);
            return admit(...args);
          }
        : undefined
    };
  } catch (error) {
    await Promise.all([pool.end(), sourcePool?.end()]);
    throw error;
  }
}
