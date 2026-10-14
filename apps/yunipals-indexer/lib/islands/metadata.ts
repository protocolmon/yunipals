import { z } from "zod";
import { islandCollection } from "../constants.js";
import {
  ethereumIslandCollection,
  baseIslandUri,
  replacementSnapshotSha256,
  replacementDistributionRoot,
  type IslandCollection
} from "./collections.js";
import {
  immutableMetadata,
  validateMetadata
} from "../metadata/publication.js";
import { contentHash } from "../metadata/source/canonical.js";

export const islandsRendererVersion = "islands-json-v1";
export const islandMetadataHosts = new Set([
  "meta.polychainmonsters.com",
  "meta.yunipals.com",
  "islands-meta.yunipals.com"
]);

const rawDocumentSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
    image: z.string().optional(),
    animation_url: z.string().optional(),
    attributes: z
      .array(
        z.object({ trait_type: z.string(), value: z.unknown() }).passthrough()
      )
      .optional()
  })
  .passthrough();

export function canonicalTokenId(value: string) {
  return /^(0|[1-9]\d*)$/.test(value) && BigInt(value) < 2n ** 256n;
}

export function islandEdition(
  tokenId: string,
  genesisLimit = BigInt(islandCollection.genesisLimit)
) {
  if (!canonicalTokenId(tokenId) || genesisLimit < 0n)
    throw new Error("invalid_island_identity");
  return BigInt(tokenId) <= genesisLimit ? "Genesis" : "Personal";
}

export function islandMetadataUri(uri: string) {
  const url = new URL(uri);
  if (
    url.protocol !== "https:" ||
    !islandMetadataHosts.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(
      /^\/v1\/island-meta\/grassland\/(0|[1-9]\d*)$/.test(url.pathname) ||
      (url.hostname === "islands-meta.yunipals.com" &&
        /^\/v2\/base-islands\/[1-9]\d*$/.test(url.pathname))
    )
  ) {
    throw new Error("unsupported_island_metadata_uri");
  }
  if (!canonicalTokenId(url.pathname.split("/").at(-1)!))
    throw new Error("invalid_island_metadata_id");
  return url.href;
}

/** Token identity comes from the contract, including when many tokens share a URI. */
export function normalizeIslandMetadata(raw: unknown, tokenId: string) {
  if (!canonicalTokenId(tokenId)) throw new Error("invalid_island_identity");
  const { owner: _owner, ...document } = rawDocumentSchema.parse(raw);
  return validateMetadata(
    immutableMetadata({
      ...document,
      id: tokenId,
      description: document.description ?? "",
      attributes: document.attributes ?? []
    })
  );
}

export type IslandJob = {
  tokenId: string;
  lifecycle: number;
  mintTransactionHash: string;
  mintLogIndex: number;
  attempts: number;
};

export type IslandObservation = {
  uri: string;
  blockNumber: bigint;
  blockHash: string;
  metadataStorage: string | null;
  genesisLimit: bigint;
};

export function islandRevision(
  job: IslandJob,
  observation: IslandObservation,
  raw: unknown,
  collection: IslandCollection = ethereumIslandCollection
) {
  const uri = islandMetadataUri(observation.uri);
  if (
    observation.blockNumber < BigInt(collection.deploymentBlock) ||
    !/^0x[0-9a-f]{64}$/.test(observation.blockHash) ||
    (collection.metadataMode === "storage"
      ? !observation.metadataStorage ||
        !/^0x[0-9a-f]{40}$/.test(observation.metadataStorage)
      : observation.metadataStorage !== null ||
        uri !== baseIslandUri(job.tokenId) ||
        observation.genesisLimit !== 1000n) ||
    !Number.isSafeInteger(job.lifecycle) ||
    job.lifecycle < 1 ||
    !Number.isSafeInteger(job.mintLogIndex) ||
    job.mintLogIndex < 0 ||
    !/^0x[0-9a-f]{64}$/.test(job.mintTransactionHash)
  )
    throw new Error("invalid_island_evidence");
  const document = normalizeIslandMetadata(raw, job.tokenId);
  if (collection.metadataMode === "token") {
    const identity = z
      .object({
        properties: z.object({
          chain_id: z.literal(8453),
          contract: z.literal(collection.address),
          token_id: z.literal(job.tokenId),
          replacement_snapshot: z.object({
            sha256: z.literal(replacementSnapshotSha256),
            distribution_root: z.literal(replacementDistributionRoot)
          })
        })
      })
      .safeParse(raw);
    if (!identity.success) throw new Error("island_metadata_identity_mismatch");
  }
  const sourceHash = contentHash(raw);
  const documentHash = contentHash(document);
  const edition = islandEdition(job.tokenId, observation.genesisLimit);
  const revisionHash = contentHash({
    collection: collection.slug,
    chainId: collection.chainId,
    contractAddress: collection.address,
    tokenId: job.tokenId,
    lifecycle: job.lifecycle,
    mintTransactionHash: job.mintTransactionHash,
    mintLogIndex: job.mintLogIndex,
    uri,
    sourceHash,
    documentHash,
    rendererVersion: islandsRendererVersion,
    metadataStorage: observation.metadataStorage,
    genesisLimit: observation.genesisLimit.toString()
  });
  return { uri, document, sourceHash, documentHash, revisionHash, edition };
}
