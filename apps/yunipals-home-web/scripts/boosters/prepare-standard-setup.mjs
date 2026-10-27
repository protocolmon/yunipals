// Prepare reviewed calldata only. This script has no RPC client or signer.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { encodeFunctionData } from "viem";
import { packRegistryAbi } from "@protopals/yunipals-market-core/boosterAbi";
import { validateBoosterCatalog } from "@protopals/yunipals-market-core/boosterCatalog";
import {
  boosterSetupArguments,
  validateBoosterSetup
} from "../../src/lib/boosterSetup.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const app = fileURLToPath(new URL("../../", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const smokeBytes = await readFile(
  resolve(app, "public/boosters/mainnet-smoke-setup.json")
);
if (
  digest(smokeBytes) !==
  "bc1ab30332108dc40db4b3f86b8ac6c1a0efff456555f40af486389afb305d6e"
)
  throw Error(
    "The reviewed smoke bundle changed; preserve the existing smoke flow."
  );
const smoke = JSON.parse(smokeBytes);
const deployment = JSON.parse(
  await readFile(
    resolve(root, "docs/boosters/mainnet-smoke/deployment.confirmed.json")
  )
);
const addresses = Object.fromEntries(
  ["registry", "engine", "monsters"].map((name) => [
    name,
    deployment.contracts[name].proxy
  ])
);
validateBoosterSetup(smoke, addresses);
const pack = JSON.parse(
  await readFile(
    resolve(root, "docs/boosters/mainnet-launch/pack.standard.ready.json")
  )
);
const bundle = {
  ...smoke,
  expectedTypeCount: "1",
  pack,
  configureData: "0x",
  catalogHash: "0x"
};
const { rules, catalog } = boosterSetupArguments(bundle);
bundle.catalogHash = validateBoosterCatalog(catalog).catalogHash;
bundle.configureData = encodeFunctionData({
  abi: packRegistryAbi,
  functionName: "configureType",
  args: [0n, rules, catalog]
});
validateBoosterSetup(bundle, addresses, "standard");
const bytes = JSON.stringify(bundle, null, 2) + "\n";
for (const file of [
  resolve(app, "public/boosters/mainnet-standard-setup.json"),
  resolve(root, "docs/boosters/mainnet-launch/mainnet-standard-setup.json")
]) {
  try {
    await writeFile(file, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || (await readFile(file, "utf8")) !== bytes)
      throw error;
  }
}
console.log(
  JSON.stringify(
    {
      kind: "standard",
      expectedTypeCount: "1",
      supplyCap: "unlimited (onchain 0)",
      setupPackageSha256: digest(bytes),
      catalogHash: bundle.catalogHash,
      configureCalldataSha256: digest(bundle.configureData),
      mainnetBroadcasts: 0
    },
    null,
    2
  )
);
