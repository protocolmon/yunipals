import { animeRepository } from "./animeRepository";
/** Prepare reviewable public deployment artifacts. Does not sign or broadcast. */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encodeAbiParameters, isAddress, type Address, type Hex } from "viem";
import { animeArenaAbi } from "@protopals/yunipals-market-core/animeArenaAbi";
import { loadAnimeArenaCatalog } from "./catalog";
const [registry, configFile, output] = process.argv.slice(2);
if (!registry || !isAddress(registry) || !configFile || !output)
  throw new Error(
    "Usage: arena-anime-deployment REGISTRY CONSTRUCTOR.json OUTPUT_DIRECTORY"
  );
const root = animeRepository();
const catalog = loadAnimeArenaCatalog(root, registry.toLowerCase());
const config = JSON.parse(await readFile(configFile, "utf8")) as Record<
  string,
  string
>;
const address = (key: string): Address => {
  if (!isAddress(config[key] ?? "") || /^0x0{40}$/i.test(config[key]!))
    throw new Error(`Missing ${key}`);
  return config[key] as Address;
};
const admin = address("admin");
const value = {
  admin,
  lobbyOperator: address("lobbyOperator"),
  admissionSigner: address("admissionSigner"),
  referee: address("referee"),
  treasury: admin,
  islands: "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168" as Address,
  vrfWrapper: "0xb0407dbe851f8318bd31404a49e658143c982f23" as Address,
  eligibility: registry,
  paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  entryFee: 1000000n,
  winnerBps: 8000,
  islandBps: 500,
  joinWindow: 604800,
  strategyWindow: 86400,
  resolutionWindow: 86400,
  maxVrfCost: BigInt(config.maxVrfCostWei ?? "0"),
  rulesHash: catalog.rulesHash as Hex
};
if (value.maxVrfCost <= 0n || value.maxVrfCost >= 2n ** 128n)
  throw new Error("Provide the reviewed VRF cost cap.");
const constructor = animeArenaAbi.find((v) => v.type === "constructor")!;
await mkdir(output, { recursive: true });
await writeFile(
  join(output, "anime-rules-manifest-v1.json"),
  JSON.stringify(catalog.manifest, null, 2) + "\n"
);
await writeFile(join(output, "anime-rules-hash.txt"), catalog.rulesHash + "\n");
await writeFile(
  join(output, "anime-constructor-arguments.hex"),
  encodeAbiParameters(constructor.inputs, [value]) + "\n"
);
await writeFile(
  join(output, "anime-constructor.json"),
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  ) + "\n"
);
console.log(
  "Public anime rules and constructor arguments prepared; no transactions broadcast."
);
