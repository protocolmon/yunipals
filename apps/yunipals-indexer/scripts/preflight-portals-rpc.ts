import { randomBytes } from "node:crypto";
import { loadEnvFile } from "node:process";
import { isAddress, isHash, toHex } from "viem";
import {
  portalRpcUrls,
  preflightPortalRpc,
  portalLogBlockRange
} from "../lib/portals/rpc.js";

async function main() {
  if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);
  const chainId = Number(process.env.PORTALS_CHAIN_ID ?? 8453);
  const grading = process.env.PORTALS_GRADING_ADDRESS;
  const knownTransaction = process.env.PORTALS_RPC_PROBE_TRANSACTION;
  const start = process.env.PORTALS_START_BLOCK;
  if (
    ![8453, 84532].includes(chainId) &&
    !(chainId === 31337 && process.env.PORTALS_ALLOW_LOCAL_CHAIN === "true")
  )
    throw new Error("Unsupported portal chain.");
  if (
    !grading ||
    !isAddress(grading) ||
    !knownTransaction ||
    !isHash(knownTransaction) ||
    !start ||
    !/^[1-9][0-9]*$/.test(start)
  )
    throw new Error(
      "Configure grading address, deployment start block and a known successful RPC probe transaction."
    );
  const report = await preflightPortalRpc(portalRpcUrls(process.env), {
    chainId,
    grading,
    startBlock: BigInt(start),
    logBlockRange: portalLogBlockRange(process.env),
    knownTransaction,
    absentTransaction: toHex(randomBytes(32))
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Portal RPC preflight could not run. Check private configuration; no changes were made."
  );
  process.exitCode = 1;
});
