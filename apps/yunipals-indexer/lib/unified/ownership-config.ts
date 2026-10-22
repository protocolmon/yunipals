import type { OwnershipReadDefinition } from "../../../../packages/yunipals-indexer-server/src/ownership.js";
import type { RegisteredRelease } from "./releases.js";
import {
  collections,
  islandCollection,
  baseIslandCollection,
  baseIslandOwnershipPolicy
} from "../constants.js";

export function ownershipReadDefinitions(
  release: RegisteredRelease
): OwnershipReadDefinition[] {
  const definitions: OwnershipReadDefinition[] = [
    ...Object.values(collections).map((collection) => {
      const sourceId = `ownership:${collection.slug}`;
      const source = release.manifest.sources.find(
        (source) => source.id === sourceId
      );
      if (
        !source?.enabled ||
        source.chainId !== collection.chainId ||
        source.address !== collection.address ||
        source.startBlock !== String(collection.deploymentBlock)
      )
        throw new Error("Ownership deployment manifest mismatch.");
      const depths = source.policies.filter(
        (policy) => policy.kind === "depth"
      );
      if (
        collection.slug === "bnb" &&
        (depths.length !== 1 || depths[0]!.subsequentBlocks > 1000)
      )
        throw new Error("BNB confirmation policy requires review.");
      return {
        collection: collection.slug,
        sourceId,
        policy:
          collection.slug === "bnb" ? depths[0]! : ({ kind: "latest" } as const)
      };
    }),
    {
      collection: islandCollection.slug,
      sourceId: "islands:ethereum",
      policy: { kind: "latest" } as const
    }
  ];
  const baseIslands = release.manifest.sources.find(
    (source) => source.id === "islands:base:v2"
  );
  if (baseIslands?.enabled) {
    if (
      baseIslands.chainId !== baseIslandCollection.chainId ||
      baseIslands.address !== baseIslandCollection.address ||
      baseIslands.startBlock !== String(baseIslandCollection.deploymentBlock)
    )
      throw new Error("Base Islands deployment manifest mismatch.");
    definitions.push({
      collection: baseIslandCollection.slug,
      sourceId: baseIslands.id,
      policy: baseIslandOwnershipPolicy
    });
  }
  return definitions;
}
