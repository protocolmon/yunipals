import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import {
  encodeFunctionData,
  isAddress,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import { portalCollectionAbi } from "@protopals/yunipals-market-core/portalAbi";
import { createPortalRuntime } from "../lib/portals/runtime.js";
import { preparePortalSetup } from "../lib/portals/prepare.js";

if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);
function address(name: string): Address {
  const value = process.env[name];
  if (!value || !isAddress(value) || /^0x0{40}$/i.test(value))
    throw new Error(`Set ${name} to the verified wallet or contract.`);
  return value;
}
function setting(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}
async function main() {
  const runtime = await createPortalRuntime();
  try {
    const deployment = runtime.chain.deployment;
    const count = await runtime.chain.client.readContract({
      address: deployment.collection,
      abi: portalCollectionAbi,
      functionName: "kindCount"
    });
    if (count !== 0n)
      throw new Error(
        "This initial setup requires a new collection with no portal kinds."
      );
    const controller = await runtime.chain.client.readContract({
      address: deployment.collection,
      abi: portalCollectionAbi,
      functionName: "claimController"
    });
    if (!/^0x0{40}$/i.test(controller))
      throw new Error("Fresh setup requires an unbound claim controller.");
    const entries = JSON.parse(
      await readFile(setting("PORTALS_BASE_ART_JSON"), "utf8")
    ) as { variantId: number; uri: string; path: string }[];
    const baseArt = await Promise.all(
      entries.map(async (entry) => {
        const bytes = await readFile(entry.path);
        if (
          !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        )
          throw new Error("Base artwork must be a verified PNG.");
        return {
          variantId: entry.variantId,
          uri: entry.uri,
          hash: `0x${createHash("sha256").update(bytes).digest("hex")}` as Hex
        };
      })
    );
    const rainbow = await readFile(setting("PORTALS_RAINBOW_ART_FILE"));
    const setup = preparePortalSetup({
      ...deployment,
      grader: address("PORTALS_GRADER_ADDRESS"),
      intakeSigner: address("PORTALS_INTAKE_ADDRESS"),
      competition: address("PORTALS_COMPETITION_ADDRESS"),
      aiRecipient: address("PORTALS_AI_RECIPIENT"),
      rainbowURI: setting("PORTALS_RAINBOW_ART_URI"),
      rainbowHash: `0x${createHash("sha256").update(rainbow).digest("hex")}`,
      rubricURI: setting("PORTALS_RUBRIC_URI"),
      baseArt
    });
    const upgradeAbi = parseAbi(["function upgradeToAndCall(address,bytes)"]);
    const upgrades = (
      [
        ["PORTALS_CARDS_IMPLEMENTATION", deployment.cards],
        ["PORTALS_ENGINE_IMPLEMENTATION", process.env.PORTALS_ENGINE_ADDRESS]
      ] as const
    ).flatMap(([name, target]) => {
      if (!process.env[name]) return [];
      if (!target || !isAddress(target))
        throw new Error(
          "Set the verified existing engine address before preparing its upgrade."
        );
      return [
        {
          purpose: `Upgrade ${name.includes("CARDS") ? "cards" : "mint engine"} after storage and bytecode checks`,
          to: target,
          value: "0",
          data: encodeFunctionData({
            abi: upgradeAbi,
            functionName: "upgradeToAndCall",
            args: [address(name), "0x"]
          })
        }
      ];
    });
    console.log(
      JSON.stringify(
        {
          chainId: deployment.chainId,
          requiredChecks: [
            "Run the permit release tests and storage checks.",
            "Verify current proxy and implementation bytecode, roles, registry, wrapper and USDC.",
            "Pause new pack requests during both upgrades; recover pending requests with the same seed.",
            "Backfill canonical card facts directly, check sequence-aware mints, then seal imports.",
            "Verify all public artwork bytes match these hashes before write-once registration.",
            "Simulate every call from the actual admin immediately before execution.",
            "Use the admin screen for the approved airdrop after configuration."
          ],
          upgrades,
          ...setup
        },
        null,
        2
      )
    );
  } finally {
    await runtime.close();
  }
}
main().catch(() => {
  console.error(
    "Portal setup preparation failed. Check the private launch settings and artwork inputs."
  );
  process.exitCode = 1;
});
