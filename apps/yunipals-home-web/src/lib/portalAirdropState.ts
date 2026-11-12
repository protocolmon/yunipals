import { z } from "zod";
import { keccak256, toHex, type Address, type PublicClient } from "viem";
import { portalCollectionAbi } from "@protopals/yunipals-market-core/portalAbi";
import { portalRequest } from "@/lib/portals";
import {
  airdropAllocationIsExpected,
  airdropFirstSerial,
  matchesAirdropRequest,
  type PortalAirdrop
} from "@/lib/portalAirdrop";

const progressSchema = z.object({
  requestId: z.string().regex(/^[1-9][0-9]*$/),
  kindId: z.string(),
  quantity: z.number().int(),
  delivered: z.number().int(),
  ready: z.boolean(),
  complete: z.boolean(),
  indexing: z.boolean()
});
export async function readAirdrop(client: PublicClient, plan: PortalAirdrop) {
  const block = await client.getBlock();
  const [kind, allowed, list] = await Promise.all([
    client.readContract({
      address: plan.collection as Address,
      abi: portalCollectionAbi,
      functionName: "getKind",
      args: [BigInt(plan.kindId)],
      blockNumber: block.number
    }),
    client.readContract({
      address: plan.collection as Address,
      abi: portalCollectionAbi,
      functionName: "hasRole",
      args: [keccak256(toHex("CONFIG_ROLE")), plan.admin as Address],
      blockNumber: block.number
    }),
    portalRequest(`/mint-requests?owner=${plan.admin}`).then((value) =>
      z.object({ requests: z.array(progressSchema) }).parse(value)
    )
  ]);
  if (
    kind.configurationHash.toLowerCase() !==
    plan.kindConfigurationHash.toLowerCase()
  )
    throw new Error(
      "The portal artwork or gates changed. This allocation needs to be reviewed again."
    );
  if (!allowed)
    throw new Error(
      "The prepared admin no longer has permission to mint this portal kind."
    );
  if (!airdropAllocationIsExpected(plan, kind.allocated))
    throw new Error(
      "Other mint allocations changed this portal kind. Stop and review the airdrop before continuing."
    );
  const total = plan.batches.reduce((n, b) => n + b.recipients.length, 0);
  if (plan.expectedAllocated + total > kind.definition.cap)
    throw new Error("This allocation exceeds the portal kind’s cap.");
  const requests = await Promise.all(
    list.requests
      .filter((r) => r.kindId === plan.kindId)
      .map(async (summary) => ({
        summary,
        request: await client.readContract({
          address: plan.collection as Address,
          abi: portalCollectionAbi,
          functionName: "getMintRequest",
          args: [BigInt(summary.requestId)]
        })
      }))
  );
  const batches = plan.batches.map((batch, index) => {
    const first = airdropFirstSerial(plan, index);
    const found = requests.find((r) => r.request.firstSerial === first);
    if (found && !matchesAirdropRequest(plan, index, found.request))
      throw new Error(
        "An existing commitment has different recipients. Stop and review this allocation."
      );
    const summary = found?.summary;
    const current =
      summary &&
      found?.request.processed === summary.delivered &&
      summary.quantity === batch.recipients.length;
    return {
      committed: kind.allocated >= first + batch.recipients.length - 1,
      requestId: summary?.requestId,
      delivered: current ? summary.delivered : 0,
      ready: Boolean(current && summary.ready && !summary.indexing),
      complete: Boolean(current && summary.complete && !summary.indexing),
      indexing: Boolean(summary && (!current || summary.indexing))
    };
  });
  return { kind, batches };
}
