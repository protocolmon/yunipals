import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, sha256 } from "./draw";
import type { ArenaRules, Fighter, Island } from "./types";

export function loadArenaCatalog(root: string, genesisWeight: number) {
  if (
    !Number.isSafeInteger(genesisWeight) ||
    genesisWeight < 2 ||
    genesisWeight > 100
  )
    throw new Error("Set a Genesis weight between 2 and 100.");
  const published = join(
    root,
    "docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public"
  );
  const source = JSON.parse(
    readFileSync(
      join(root, "docs/islands/arena-reveal-results-v1/assignments.json"),
      "utf8"
    )
  ) as {
    assignments: Array<{
      tokenId: string;
      edition: Island["edition"];
      profileSha256: string;
      traits: Record<string, string>;
    }>;
  };
  if (source.assignments.length !== 898)
    throw new Error("Expected the published 898-island pool.");
  const profiles = new Map<string, Record<string, unknown>>();
  const islands: Island[] = source.assignments.map((entry) => {
    const metadata = JSON.parse(
      readFileSync(join(published, "metadata", `${entry.tokenId}.json`), "utf8")
    ) as {
      name: string;
      image: string;
      properties: { arena_profile_sha256: string };
    };
    if (metadata.properties.arena_profile_sha256 !== entry.profileSha256)
      throw new Error("Island profile differs from published assignment.");
    if (!profiles.has(entry.profileSha256)) {
      const raw = readFileSync(
        join(published, "profiles", `${entry.profileSha256}.json`),
        "utf8"
      );
      const profile = JSON.parse(raw) as Record<string, unknown>;
      if (sha256(canonicalJson(profile)) !== entry.profileSha256)
        throw new Error("Island profile checksum failed.");
      profiles.set(entry.profileSha256, profile);
    }
    return {
      ...entry,
      name: metadata.name,
      image: metadata.image,
      weight: entry.edition === "Genesis" ? genesisWeight : 1,
      profile: profiles.get(entry.profileSha256)!
    };
  });
  const rules = JSON.parse(
    readFileSync(join(root, "docs/arena/rules-v2/rules.json"), "utf8")
  ) as ArenaRules;
  rules.refereeInstructions = readFileSync(
    join(root, "docs/arena/rules-v2/referee-system.txt"),
    "utf8"
  );
  return { islands, rules };
}

export function loadArenaLabCatalog(root: string, genesisWeight: number) {
  const catalog = loadArenaCatalog(root, genesisWeight);
  const sourceFighters = JSON.parse(
    readFileSync(
      join(root, "docs/islands/arena-freeform-tournament-v7/roster.json"),
      "utf8"
    )
  ) as Fighter[];
  const fighters = sourceFighters.map(
    ({
      id,
      name,
      tokenId,
      chain,
      species,
      identity,
      image,
      sourcePage,
      locomotion
    }) => ({
      id,
      name,
      tokenId,
      chain,
      species,
      identity,
      image,
      sourcePage,
      locomotion
    })
  );
  return { ...catalog, fighters };
}
