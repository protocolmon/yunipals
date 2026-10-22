/** Read-only preparation. No keys, signing, or broadcasting. */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  toHex,
  type Hex
} from "viem";
import { boosterPacksAbi } from "../../../packages/yunipals-market-core/src/boosterAbi.js";
import { encodeBlockHeader, extractVrfProof } from "../lib/boosters/vrf-proof";

const { values } = parseArgs({
  options: {
    rpc: { type: "string", default: "https://mainnet.base.org" },
    engine: { type: "string" },
    request: { type: "string" },
    sender: { type: "string" },
    fulfillment: { type: "string" },
    checkpoint: { type: "boolean", default: false },
    anchor: { type: "string" },
    output: { type: "string", default: "booster-vrf-recovery.unsigned.json" }
  }
});
if (!values.engine || !values.request || !values.sender)
  throw new Error(
    "Required: --engine ADDRESS --request ID --sender ADDRESS; use --fulfillment TX_HASH or --checkpoint [--anchor BLOCK]."
  );
if (values.checkpoint === Boolean(values.fulfillment))
  throw new Error("Select exactly one: --fulfillment TX_HASH or --checkpoint.");
const engine = getAddress(values.engine);
const account = getAddress(values.sender);
const id = BigInt(values.request);
const client = createPublicClient({
  transport: http(values.rpc, { timeout: 30000 })
});
const chainId = await client.getChainId();
if (chainId !== 8453 && chainId !== 84532)
  throw new Error(
    "Use Base or Base Sepolia (the supported proof seed derivation)."
  );
const blockNumber = await client.getBlockNumber();
const [context, request] = await Promise.all([
  client.readContract({
    address: engine,
    abi: boosterPacksAbi,
    functionName: "proofContext",
    args: [id],
    blockNumber
  }),
  client.readContract({
    address: engine,
    abi: boosterPacksAbi,
    functionName: "getRequest",
    args: [id],
    blockNumber
  })
]);
if (!context.requestBlock || context.chainId !== BigInt(chainId))
  throw new Error(
    "No proof context for this request; old requests cannot be retrofitted by this tool."
  );
if (request.status !== 1 || request.received)
  throw new Error(
    "Request is not awaiting randomness; inspect seeded recovery or completed/burned status."
  );
let data: Hex;
let next: string;
let evidence: Record<string, unknown>;
if (values.checkpoint) {
  // Recent hashes can be saved with a compact request checkpoint. If older,
  // backfill at most 64 headers per invocation and resume from the returned anchor.
  if (!values.anchor && blockNumber - context.requestBlock < 250n) {
    data = encodeFunctionData({
      abi: boosterPacksAbi,
      functionName: "checkpointRequestBlock",
      args: [id]
    });
    next =
      "After confirmation, prepare --fulfillment TX_HASH when the original proof is available.";
    evidence = { requestBlock: context.requestBlock };
  } else {
    const anchor = values.anchor ? BigInt(values.anchor) : blockNumber - 16n;
    if (anchor <= context.requestBlock || anchor >= blockNumber)
      throw new Error(
        "Anchor must be after the request block and before the latest block."
      );
    const count = Number(
      anchor - context.requestBlock > 64n ? 64n : anchor - context.requestBlock
    );
    const headers: Hex[] = [];
    for (let i = 0; i < count; i++) {
      const raw = await client.request({
        method: "eth_getBlockByNumber",
        params: [toHex(anchor - BigInt(i)), false]
      });
      if (!raw) throw new Error("Archive RPC returned no block.");
      headers.push(encodeBlockHeader(raw));
    }
    data = encodeFunctionData({
      abi: boosterPacksAbi,
      functionName: "checkpointBlockHeaders",
      args: [anchor, headers]
    });
    const parent = anchor - BigInt(count);
    next =
      parent === context.requestBlock
        ? "After confirmation, prepare --fulfillment TX_HASH. The original request block is now checkpointed."
        : `After confirmation, repeat --checkpoint --anchor ${parent} until reaching request block ${context.requestBlock}.`;
    evidence = { anchor, parent, headerCount: count };
  }
} else {
  if (!/^0x[0-9a-fA-F]{64}$/.test(values.fulfillment!))
    throw new Error("Invalid fulfillment transaction hash.");
  const transaction = await client.getTransaction({
    hash: values.fulfillment as Hex
  });
  const { proof, commitment } = extractVrfProof(transaction.input, id);
  const wrapper = await client.readContract({
    address: engine,
    abi: boosterPacksAbi,
    functionName: "wrapper",
    blockNumber
  });
  if (
    commitment.blockNum !== context.requestBlock ||
    getAddress(commitment.sender) !== getAddress(wrapper)
  )
    throw new Error(
      "Fulfillment commitment does not match the recorded request block and wrapper."
    );
  data = encodeFunctionData({
    abi: boosterPacksAbi,
    functionName: "restoreRandomness",
    args: [id, proof]
  });
  next =
    "After this transaction confirms, use Finish reveal in the app (recover(requestId)). It is a separate transaction with freshly estimated gas. Do not request new randomness.";
  evidence = {
    fulfillmentTransaction: transaction.hash,
    coordinator: context.coordinator,
    requestBlock: context.requestBlock
  };
}
// Crucially validates the proof/anchor against the engine's state, never a local oracle assertion.
await client.call({ account, to: engine, data, blockNumber });
const gas = await client.estimateGas({ account, to: engine, data });
const plan = {
  status: "unsigned; simulation passed; recheck state before signing",
  chainId,
  blockNumber,
  requestId: id,
  evidence,
  transaction: {
    from: account,
    to: engine,
    data,
    value: "0x0",
    gas: toHex((gas * 120n) / 100n)
  },
  next
};
await writeFile(
  values.output!,
  JSON.stringify(
    plan,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  ) + "\n"
);
console.log(`Wrote ${values.output}. ${next}`);
