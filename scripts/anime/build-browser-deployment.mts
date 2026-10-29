/** Freeze public creation code and rules for two browser-signed, closed deployments. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnimeArenaCatalog } from "../../apps/yunipals-market-api/src/arena/live/catalog";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const contract = async (name: string) => {
  const v = JSON.parse(
    await readFile(
      join(root, `contracts/arena/out/${name}.sol/${name}.json`),
      "utf8"
    )
  );
  return {
    creation: v.bytecode.object,
    runtime: v.deployedBytecode.object,
    immutableRanges: Object.values(
      v.deployedBytecode.immutableReferences ?? {}
    ).flat()
  };
};
const value = {
  version: "anime-browser-deployment/v1",
  chainId: 8453,
  roles: {
    admissionSigner: "0x6C2b7BC334f4C518970989c972a6016A7c8d81e4",
    referee: "0x807cfF7aAFE57834ceefb12886A7139284935b93",
    lobbyOperator: "0xA2c8eB2b777E791F24b03a348Af8Bd87855C0c4a"
  },
  maxVrfCostWei: "10000000000000",
  registry: await contract("AnimeFighterRegistry"),
  arena: await contract("YunipalsArena"),
  rulesTemplate: loadAnimeArenaCatalog(root, `0x${"1".repeat(40)}`).manifest
};
const bytes = JSON.stringify(value, null, 2) + "\n";
const folder = join(root, "apps/yunipals-home-web/public/arena");
await mkdir(folder, { recursive: true });
await writeFile(join(folder, "anime-deployment-v1.json"), bytes);
console.log(createHash("sha256").update(bytes).digest("hex"));
