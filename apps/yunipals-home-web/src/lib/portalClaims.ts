import { type Address, type PublicClient } from "viem";
import {
  portalCollectionAbi,
  portalRegistryAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";
import { environment } from "@/environment";
import { portalTokenSchema } from "@/lib/portals";

/** Derive every contract from the locally pinned approval/claim target. */
export async function readPortalContracts(client: PublicClient) {
  const grading = environment.portalGrading;
  if (!grading) throw new Error("Portal claims are being prepared.");
  const [block, chainId] = await Promise.all([
    client.getBlock(),
    client.getChainId()
  ]);
  if (chainId !== environment.portalChainId)
    throw new Error("Portal network configuration changed.");
  const at = { blockNumber: block.number };
  const [registry, usdc, cards, version] = await Promise.all([
    client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "registry",
      ...at
    }),
    client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "usdc",
      ...at
    }),
    client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "cards",
      ...at
    }),
    client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "portalEconomicsVersion",
      ...at
    })
  ]);
  const collection = await client.readContract({
    address: registry,
    abi: portalRegistryAbi,
    functionName: "collection",
    ...at
  });
  const controller = await client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "claimController",
    ...at
  });
  if (version !== 2n || controller.toLowerCase() !== grading.toLowerCase())
    throw new Error("Portal burn-and-claim setup is incomplete.");
  return {
    deployment: { chainId, grading, registry, collection, usdc, cards },
    block
  };
}

/** Owner exits use direct chain reads and remain usable during indexer/AI outages. */
export async function readPortalClaim(client: PublicClient, tokenId: string) {
  if (!/^[1-9][0-9]*$/.test(tokenId) || BigInt(tokenId) >= 2n ** 256n)
    throw new Error("Enter a valid portal number.");
  const context = await readPortalContracts(client);
  const { deployment, block } = context;
  const at = { blockNumber: block.number };
  const kindId = await client.readContract({
    address: deployment.collection,
    abi: portalCollectionAbi,
    functionName: "tokenKind",
    args: [BigInt(tokenId)],
    ...at
  });
  if (kindId === 0n) throw new Error("Portal not found.");
  const [record, kind, amount, round] = await Promise.all([
    client.readContract({
      address: deployment.collection,
      abi: portalCollectionAbi,
      functionName: "portalRecord",
      args: [BigInt(tokenId)],
      ...at
    }),
    client.readContract({
      address: deployment.collection,
      abi: portalCollectionAbi,
      functionName: "getKind",
      args: [kindId],
      ...at
    }),
    client.readContract({
      address: deployment.grading,
      abi: portalGradingAbi,
      functionName: "claimable",
      args: [BigInt(tokenId)],
      ...at
    }),
    client.readContract({
      address: deployment.registry,
      abi: portalRegistryAbi,
      functionName: "activePortal",
      ...at
    })
  ]);
  const token = portalTokenSchema.parse({
    id: tokenId,
    kindId: kindId.toString(),
    name: kind.definition.name,
    imageURI: kind.definition.imageURI,
    gates: record[1],
    owner: record[2],
    retired: /^0x0{40}$/i.test(record[2]),
    claimable: amount.toString(),
    active: round[1] && round[0].portalId === BigInt(tokenId),
    slotEndsAt:
      round[0].portalId === BigInt(tokenId) ? round[0].endsAt.toString() : "0",
    asOfBlock: block.number.toString(),
    asOfBlockHash: block.hash
  });
  return { ...context, token, owner: record[2] as Address };
}
