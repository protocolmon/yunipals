import type { PublicClient, Address } from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import type {
  NativeArenaObservation,
  NativeArenaTournament
} from "./nativeSource";

export type NativeArenaActionObservation = NativeArenaObservation & {
  tournament: NativeArenaTournament;
};
const zeroHash = `0x${"0".repeat(64)}`;
const zeroAddress = `0x${"0".repeat(40)}`;
const phases = {
  open: 1,
  strategies: 2,
  resolving: 3,
  settled: 4,
  expired: 5
} as const;

/** Bounded point reads only. Verify the event branch and current contract
 * phase/input at one recent head before disclosure or an external action.
 */
export async function verifyNativeArenaAction(
  client: PublicClient,
  observed: NativeArenaActionObservation
) {
  if ((await client.getChainId()) !== 8453)
    throw new Error("Native Arena action requires Base.");
  const t = observed.tournament,
    state = t.state;
  const head = await client.getBlock({ blockTag: "latest" });
  if (
    !head.hash ||
    Math.abs(Number(head.timestamp) * 1000 - Date.now()) > 120000 ||
    head.number < BigInt(t.last.blockNumber)
  )
    throw new Error("Native Arena action head is unavailable.");
  const anchors = new Map<string, string>();
  for (const event of [t.opened, t.last, t.inputFrozen].filter(
    (event) => event !== null
  )) {
    const prior = anchors.get(event.blockNumber);
    if (prior && prior !== event.blockHash)
      throw new Error("Native Arena event anchors disagree.");
    anchors.set(event.blockNumber, event.blockHash);
  }
  await Promise.all(
    [...anchors].map(async ([number, hash]) => {
      if (
        (
          await client.getBlock({ blockNumber: BigInt(number) })
        ).hash?.toLowerCase() !== hash
      )
        throw new Error("Native Arena action event is no longer canonical.");
    })
  );
  const contract = t.deployment.slice(5) as Address;
  const [live, mask] = await Promise.all([
    client.readContract({
      address: contract,
      abi: arenaAbi,
      functionName: "tournament",
      args: [BigInt(t.id)],
      blockNumber: head.number
    }),
    client.readContract({
      address: contract,
      abi: arenaAbi,
      functionName: "automaticStrategyMask",
      args: [BigInt(t.id)],
      blockNumber: head.number
    })
  ]);
  if (
    live.phase !== phases[state.phase] ||
    live.count !== state.seats.length ||
    live.deadline !== BigInt(state.deadline) ||
    live.inputHash.toLowerCase() !== (state.inputHash ?? zeroHash) ||
    live.resultHash.toLowerCase() !== (state.resultHash ?? zeroHash) ||
    mask !== (state.automaticStrategyMask ?? 0) ||
    live.requestId !== BigInt(state.requestId ?? "0") ||
    live.randomnessReceived !== (state.randomWord !== null) ||
    live.randomWord !== BigInt(state.randomWord ?? "0") ||
    String(live.islandId) !== (state.islandId ?? "0") ||
    live.islandBeneficiary.toLowerCase() !==
      (state.islandBeneficiary ?? zeroAddress) ||
    live.treasuryBeneficiary.toLowerCase() !==
      (state.treasury ?? zeroAddress) ||
    (state.winners !== null &&
      (live.semifinalOneWinner !== state.winners[0] ||
        live.semifinalTwoWinner !== state.winners[1] ||
        live.champion !== state.winners[2]))
  )
    throw new Error("Native Arena action state changed.");
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash)
    throw new Error("Native Arena action head changed during verification.");
}
