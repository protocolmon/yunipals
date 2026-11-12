import { loadEnvFile } from "node:process";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  boosterPacksAbi,
  packRegistryAbi,
  yunipalMonstersAbi
} from "@protopals/yunipals-market-core/boosterAbi";
import { portalCardAbi } from "../lib/portals/chain.js";
import {
  readHistoricalCardFacts,
  type HistoricalCardFacts
} from "../lib/portals/backfill.js";

if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);
const importAbi = parseAbi([
  "function importCardFacts(uint256[] ids,uint32[] sequences,uint64[] times)",
  "function closeCardFactsImport()",
  "function cardFactsImportClosed() view returns(bool)"
]);

async function main() {
  const cards = process.env.PORTALS_CARDS_ADDRESS,
    engine = process.env.PORTALS_ENGINE_ADDRESS;
  if (
    !cards ||
    !engine ||
    !isAddress(cards) ||
    !isAddress(engine) ||
    !process.env.PORTALS_RPC_URL ||
    !process.env.PORTALS_CARD_START_BLOCK ||
    !process.env.PORTALS_PACK_TYPE_ID
  )
    throw new Error(
      "Configure the verified cards, engine, RPC, deployment block and pack type before backfilling."
    );
  const client = createPublicClient({
    transport: http(process.env.PORTALS_RPC_URL)
  });
  const chainId = await client.getChainId();
  if (chainId !== Number(process.env.PORTALS_CHAIN_ID ?? 8453))
    throw new Error("Backfill RPC chain mismatch.");
  if (
    ![8453, 84532].includes(chainId) &&
    !(chainId === 31337 && process.env.PORTALS_ALLOW_LOCAL_CHAIN === "true")
  )
    throw new Error("Unsupported backfill chain.");
  const [registry, engineRegistry, engineCards] = await Promise.all([
    client.readContract({
      address: cards,
      abi: yunipalMonstersAbi,
      functionName: "registry"
    }),
    client.readContract({
      address: engine,
      abi: boosterPacksAbi,
      functionName: "registry"
    }),
    client.readContract({
      address: engine,
      abi: boosterPacksAbi,
      functionName: "monsters"
    })
  ]);
  const pack = await client.readContract({
    address: registry,
    abi: packRegistryAbi,
    functionName: "getPack",
    args: [BigInt(process.env.PORTALS_PACK_TYPE_ID)]
  });
  if (
    registry.toLowerCase() !== engineRegistry.toLowerCase() ||
    engineCards.toLowerCase() !== cards.toLowerCase() ||
    pack.rules.engine.toLowerCase() !== engine.toLowerCase() ||
    !pack.active ||
    pack.totalVariants !== 264
  )
    throw new Error(
      "Historical backfill must use the active 264-variant TCG stack."
    );
  const execute = process.argv.includes("--execute");
  const privateKey = process.env.PORTALS_ADMIN_PRIVATE_KEY;
  if (execute && (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)))
    throw new Error(
      "An authorized admin wallet is required for direct backfill transactions."
    );
  const wallet = privateKey
    ? createWalletClient({
        account: privateKeyToAccount(privateKey as Hex),
        transport: http(process.env.PORTALS_RPC_URL)
      })
    : null;
  const confirmations = BigInt(process.env.PORTALS_CONFIRMATIONS ?? "12");
  const head = await client.getBlockNumber();
  if (head < confirmations)
    throw new Error("Wait for historical mint confirmations.");
  let pending: HistoricalCardFacts[] = [];
  let checked = 0,
    imported = 0;
  async function flush() {
    if (!pending.length) return;
    const data = encodeFunctionData({
      abi: importAbi,
      functionName: "importCardFacts",
      args: [
        pending.map((f) => f.tokenId),
        pending.map((f) => f.sequence),
        pending.map((f) => f.mintedAt)
      ]
    });
    if (execute && wallet) {
      const hash = await wallet.sendTransaction({
        chain: null,
        to: cards as Address,
        data
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Card facts import reverted.");
    } else console.log(JSON.stringify({ to: cards, value: "0", data }));
    imported += pending.length;
    pending = [];
  }
  for await (const fact of readHistoricalCardFacts(client, {
    cards: cards as Address,
    engine: engine as Address,
    packTypeId: BigInt(process.env.PORTALS_PACK_TYPE_ID),
    fromBlock: BigInt(process.env.PORTALS_CARD_START_BLOCK),
    toBlock: head - confirmations
  })) {
    checked++;
    const existing = await client.readContract({
      address: cards as Address,
      abi: portalCardAbi,
      functionName: "cardFacts",
      args: [fact.tokenId]
    });
    if (existing[2]) {
      if (existing[0] !== fact.sequence || existing[1] !== fact.mintedAt)
        throw new Error("Existing facts conflict with canonical mint history.");
      continue;
    }
    pending.push(fact);
    if (pending.length === 200) await flush();
  }
  await flush();
  // Sealing is a separate explicit action after the engine upgrade and the full direct import.
  if (process.argv.includes("--seal")) {
    if (!execute)
      throw new Error(
        "Seal only after the direct import and upgraded engine have been verified."
      );
    if (!process.argv.includes("--engine-upgrade-verified"))
      throw new Error(
        "Verify the sequence-aware engine upgrade before closing historical imports."
      );
    const hash = await wallet!.writeContract({
      chain: null,
      address: cards as Address,
      abi: importAbi,
      functionName: "closeCardFactsImport"
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error("Closing the import reverted.");
  }
  console.error(
    JSON.stringify({
      checked,
      imports: imported,
      executed: execute,
      sealed: process.argv.includes("--seal")
    })
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Card facts backfill failed."
  );
  process.exitCode = 1;
});
