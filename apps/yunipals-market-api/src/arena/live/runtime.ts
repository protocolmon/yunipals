import pg from "pg";
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
  loadLiveArenaCatalog
} from "./catalog";
import { ArenaInputCompiler } from "./input";
import { ArenaIdentityAnalysis } from "./identityAnalysis";

export async function arenaRuntime() {
  const config = arenaConfig();
  const root = process.env.ARENA_REPOSITORY_ROOT;
  if (!root) throw new Error("ARENA_REPOSITORY_ROOT is required.");
  const catalog = loadLiveArenaCatalog(root);
  if (catalog.rulesHash !== config.rulesHash)
    throw new Error("Local rules manifest differs from ARENA_RULES_HASH.");
  const clients = arenaRpcClients(),
    base = clients.get(8453)!;
  const values = await base.multicall({
    allowFailure: false,
    contracts: [
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "paymentToken"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "entryFee"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "winnerBps"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "islandBps"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "joinWindow"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "strategyWindow"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "rulesHash"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "poolHash"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "admissionSigner"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "resolutionWindow"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "islands"
      },
      {
        address: config.deployment.contract,
        abi: arenaAbi,
        functionName: "i_vrfV2PlusWrapper"
      }
    ]
  });
  if (
    values[0].toLowerCase() !== ARENA_USDC.toLowerCase() ||
    values[1] !== 2_000_000n ||
    values[2] !== 7500 ||
    values[3] !== 500 ||
    values[4] !== 604800 ||
    values[5] !== 86400 ||
    values[6] !== config.rulesHash ||
    values[7] !== ARENA_POOL_HASH ||
    values[9] !== catalog.manifest.timing.resolutionSeconds ||
    values[10].toLowerCase() !== ARENA_ISLANDS ||
    values[11].toLowerCase() !== "0xb0407dbe851f8318bd31404a49e658143c982f23"
  )
    throw new Error(
      "Arena contract settings do not match the approved launch configuration."
    );
  const signer = config.admissionKeyFile
    ? arenaSigner(config.admissionKeyFile)
    : null;
  if (signer && signer.address.toLowerCase() !== values[8].toLowerCase())
    throw new Error("Arena admission signer does not match the contract.");
  if (config.entriesEnabled && !signer)
    throw new Error("Paid entry requires the admission signer.");
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    application_name: "yunipals_arena",
    max: 8,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    lock_timeout: 2000,
    idle_in_transaction_session_timeout: 15000
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
    }
  );
  const identityAnalysis = new ArenaIdentityAnalysis(
    pool,
    config.deployment.id,
    config.openaiFundingMode
  );
  const identities = new ArenaIdentities(
    pool,
    config.deployment.id,
    loadIdentityProfiles(root),
    indexerMetadata(fetch, config.indexerUrl),
    (nft, payload, wallet) => identityAnalysis.resolve(nft, payload, wallet)
  );
  const compiler = new ArenaInputCompiler(service, catalog, identities);
  const capacity = new ArenaCapacity(pool, config.deployment.id);
  const admit = signer
    ? createAdmission(service, signer, clients, (id, nft, wallet) =>
        identities.ensure(id, nft, wallet)
      )
    : undefined;
  return {
    capacity,
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
}
