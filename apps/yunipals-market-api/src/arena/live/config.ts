import {
  createPublicClient,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, bsc, mainnet, polygon } from "viem/chains";
import { rpcBudgetProxyUrl } from "@/rpcBudgetProxyRegistry";
import { arenaTransport } from "./transport";
import { arenaOpenaiFundingMode } from "./funding";
import { readPrivateFile } from "./privateFile";

export { readPrivateFile } from "./privateFile";

function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}.`);
  return value;
}
export function arenaConfig(env: NodeJS.ProcessEnv = process.env) {
  const contract = required(env, "ARENA_CONTRACT");
  if (!isAddress(contract) || /^0x0{40}$/i.test(contract))
    throw new Error("Invalid ARENA_CONTRACT.");
  const start = required(env, "ARENA_DEPLOYMENT_BLOCK");
  if (!/^[1-9][0-9]*$/.test(start))
    throw new Error("Invalid arena deployment block.");
  const origin = new URL(env.ARENA_PUBLIC_ORIGIN ?? "https://www.yunipals.com");
  if (
    origin.protocol !== "https:" ||
    origin.origin !== origin.href.replace(/\/$/, "")
  )
    throw new Error("Arena origin must be an HTTPS origin.");
  const key = readPrivateFile(required(env, "ARENA_ENCRYPTION_KEY_FILE"));
  if (!/^[0-9a-f]{64}$/i.test(key))
    throw new Error("Arena encryption key must be 32 hexadecimal bytes.");
  const port = Number(
    env.ARENA_PORT ?? (env.ARENA_MEDIA_KIND === "anime" ? 53912 : 53911)
  );
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid arena API port.");
  const rulesHash = required(env, "ARENA_RULES_HASH") as Hex;
  if (!/^0x[0-9a-f]{64}$/i.test(rulesHash))
    throw new Error("Invalid arena rules hash.");
  const launchMode = env.ARENA_LAUNCH_MODE ?? "pilot";
  if (!["pilot", "public"].includes(launchMode))
    throw new Error("Invalid Arena launch mode.");
  const pilotWallets = (env.ARENA_PILOT_WALLETS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    pilotWallets.some(
      (value) => !isAddress(value) || /^0x0{40}$/i.test(value)
    ) ||
    pilotWallets.length > 20
  )
    throw new Error("Invalid pilot wallets.");
  if (
    env.ARENA_ENTRIES_ENABLED === "true" &&
    launchMode === "pilot" &&
    !pilotWallets.length
  )
    throw new Error("Controlled paid entry requires explicit pilot wallets.");
  const mediaKind = env.ARENA_MEDIA_KIND ?? "video";
  if (mediaKind !== "video" && mediaKind !== "anime")
    throw new Error("Invalid ARENA_MEDIA_KIND.");
  const eligibilityRegistry = env.ARENA_ELIGIBILITY_REGISTRY?.toLowerCase() as
    | Address
    | undefined;
  if (
    mediaKind === "anime" &&
    (!eligibilityRegistry ||
      !isAddress(eligibilityRegistry) ||
      /^0x0{40}$/.test(eligibilityRegistry))
  )
    throw new Error("Anime arena requires an eligibility registry.");
  if (mediaKind === "anime" && env.ARENA_INDEXER_MODE !== "unified")
    throw new Error("Anime arena requires unified indexing.");
  if (
    mediaKind === "anime" &&
    env.ARENA_INDEXER_SOURCE_KIND === "legacy_rollback"
  )
    throw new Error(
      "Anime arena requires the unified registry source, not a legacy rollback."
    );
  if (mediaKind === "video" && eligibilityRegistry)
    throw new Error("Eligibility registry requires anime media kind.");
  const fighterAssetsOrigin =
    env.ARENA_FIGHTER_ASSETS_ORIGIN ?? "https://assets-anime.yunipals.com";
  if (fighterAssetsOrigin !== "https://assets-anime.yunipals.com")
    throw new Error("Unsupported anime assets origin.");
  return {
    mediaKind: mediaKind as "video" | "anime",
    eligibilityRegistry,
    fighterAssetsOrigin,
    deployment: {
      id: `8453:${contract.toLowerCase()}`,
      contract: contract as Address,
      startBlock: BigInt(start)
    },
    origin: origin.origin,
    databaseUrl: required(env, "ARENA_DATABASE_URL"),
    encryptionKey: Buffer.from(key, "hex"),
    port,
    rulesHash,
    entriesEnabled: env.ARENA_ENTRIES_ENABLED === "true",
    launchMode: launchMode as "pilot" | "public",
    openaiFundingMode: arenaOpenaiFundingMode(env),
    pilotWallets,
    indexerUrl:
      env.ARENA_INDEXER_INTERNAL_URL?.trim() ||
      "https://api.yunipals.com/yunipals-indexer",
    admissionKeyFile: env.ARENA_ADMISSION_KEY_FILE
  };
}
export function arenaSigner(path: string) {
  const key = readPrivateFile(path);
  if (!/^0x[0-9a-f]{64}$/i.test(key))
    throw new Error("Invalid arena signing key file.");
  return privateKeyToAccount(key as Hex);
}
export function arenaRpcClients(): ReadonlyMap<number, PublicClient> {
  // All reads pass through the production CU coordinator. Its policy intentionally
  // blocks broadcasts, so only signed Base transactions use this explicit endpoint.
  const broadcastUrl = process.env.ARENA_BROADCAST_RPC_URL;
  if (broadcastUrl && broadcastUrl !== "https://mainnet.base.org")
    throw new Error("Unsupported Arena broadcast endpoint.");
  return new Map(
    [
      [mainnet, "ethereum"],
      [base, "base"],
      [polygon, "polygon"],
      [bsc, "bnb"]
    ].map(([chain, name]) => {
      const c = chain as typeof base;
      return [
        c.id,
        createPublicClient({
          chain: c,
          transport: arenaTransport(
            http(
              rpcBudgetProxyUrl(
                name as "base" | "ethereum" | "polygon" | "bnb",
                "production"
              ),
              { retryCount: 0, timeout: 15_000 }
            ),
            c.id === 8453 && broadcastUrl
              ? http(broadcastUrl, { retryCount: 0, timeout: 15_000 })
              : undefined
          )
        }) as PublicClient
      ];
    })
  );
}
