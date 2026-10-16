/** Offline release inspection: no database connection, RPC or provider request. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { Hono } from "hono";
import { isAddress } from "viem";
import { loadLiveArenaCatalog } from "./catalog";
import { loadIdentityProfiles } from "./identity";

const root = process.env.ARENA_REPOSITORY_ROOT;
if (!root || Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("Arena release requires a root and Node 24+.");
const catalog = loadLiveArenaCatalog(root);
const profiles = loadIdentityProfiles(root);
for (const profile of profiles) {
  const bytes = readFileSync(
    join(
      root,
      "docs/arena/identity-registry-v1/references",
      profile.imageSha256 + ".img"
    )
  );
  if (createHash("sha256").update(bytes).digest("hex") !== profile.imageSha256)
    throw new Error("Fighter reference checksum differs.");
}
const pub = join(
  root,
  "docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public"
);
for (const island of catalog.islands) {
  const meta = JSON.parse(
    readFileSync(join(pub, "metadata", island.tokenId + ".json"), "utf8")
  );
  if (
    createHash("sha256")
      .update(readFileSync(join(pub, "images", island.tokenId + ".png")))
      .digest("hex") !== meta.properties.image_sha256
  )
    throw new Error("Published island image checksum differs.");
}
if (
  typeof pg.Pool !== "function" ||
  typeof new Hono().request !== "function" ||
  !isAddress(catalog.pool.contract)
)
  throw new Error("Runtime dependency failed.");
console.log(
  JSON.stringify({
    mode: "offline-release-check",
    node: process.version,
    rulesHash: catalog.rulesHash,
    islands: catalog.islands.length,
    fighterProfiles: profiles.length,
    publishedImageChecksumsVerified: true,
    externalRequests: 0
  })
);
