/** Public, deterministic deployment package. No credentials or network requests. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModeArenaCatalog } from "../../apps/yunipals-market-api/src/arena/live/catalog";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const registry = "0xdbcab53a8e32d43997de252fd49c43ab8df290bf";
const artifact = JSON.parse(
  await readFile(
    join(root, "contracts/arena/out/YunipalsArenaV2.sol/YunipalsArenaV2.json"),
    "utf8"
  )
);
const video = loadModeArenaCatalog(root, "video", undefined, 2),
  anime = loadModeArenaCatalog(root, "anime", registry, 2);
const value = {
  version: "arena-modes-browser-deployment/v2",
  chainId: 8453,
  admin: "0xB3883Cd96d72B08b8226452305A28D65974a3727",
  registry,
  roles: {
    admissionSigner: "0x6C2b7BC334f4C518970989c972a6016A7c8d81e4",
    referee: "0x807cfF7aAFE57834ceefb12886A7139284935b93",
    lobbyOperator: "0xA2c8eB2b777E791F24b03a348Af8Bd87855C0c4a"
  },
  rules: { video: video.manifest, anime: anime.manifest },
  rulesHashes: { video: video.rulesHash, anime: anime.rulesHash },
  arena: {
    creation: artifact.bytecode.object,
    runtime: artifact.deployedBytecode.object,
    immutableRanges: Object.values(
      artifact.deployedBytecode.immutableReferences ?? {}
    ).flat()
  }
};
const bytes = JSON.stringify(value, null, 2) + "\n";
const folder = join(root, "apps/yunipals-home-web/public/arena");
await mkdir(folder, { recursive: true });
await writeFile(join(folder, "shared-arena-deployment-v2.json"), bytes);
console.log(
  JSON.stringify({
    sha256: createHash("sha256").update(bytes).digest("hex"),
    runtimeBytes: (value.arena.runtime.length - 2) / 2,
    videoRulesHash: video.rulesHash,
    animeRulesHash: anime.rulesHash
  })
);
