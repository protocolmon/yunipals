import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicClient, Address, Hex } from "viem";
import {
  verifyNativeArenaAction,
  type NativeArenaActionObservation
} from "./nativeAction";
import { verifyNativeArenaFilm } from "./mediaAdoption";

function fixture() {
  const hash = (c: string) => `0x${c.repeat(64)}` as Hex,
    contract = `0x${"1".repeat(40)}` as Address,
    owner = `0x${"2".repeat(40)}` as Address;
  const event = {
    id: `8453:${contract}:${hash("3")}:0`,
    transactionHash: hash("3"),
    blockNumber: "10",
    blockHash: hash("a"),
    logIndex: 0
  };
  const observed: NativeArenaActionObservation = {
    releaseId: hash("e"),
    sourceId: `arena:8453:${contract}`,
    indexedThroughBlock: "10",
    observedThroughBlock: "9",
    tournament: {
      deployment: `8453:${contract}`,
      id: "1",
      incarnation: hash("f"),
      opened: { ...event, blockNumber: "1", blockHash: hash("b") },
      last: event,
      inputFrozen: event,
      state: {
        id: "1",
        phase: "resolving",
        deadline: 1234,
        rulesHash: hash("4"),
        poolHash: hash("5"),
        treasury: owner,
        islandBeneficiary: owner,
        islandId: "17",
        requestId: "1",
        randomWord: "42",
        ticket: 1,
        inputHash: hash("6"),
        commitments: [hash("7"), hash("7"), hash("7"), hash("7")],
        resultHash: null,
        winners: null,
        videoHash: null,
        automaticStrategyMask: 0,
        seats: [0, 1, 2, 3].map((seat) => ({
          seat,
          player: owner,
          nftChainId: 8453,
          collection: contract,
          tokenId: String(seat)
        }))
      }
    }
  };
  const live = {
    phase: 3,
    count: 4,
    deadline: 1234n,
    inputHash: hash("6"),
    resultHash: hash("0"),
    randomnessReceived: true,
    randomWord: 42n,
    requestId: 1n,
    islandId: 17,
    islandBeneficiary: owner,
    treasuryBeneficiary: owner,
    semifinalOneWinner: 0,
    semifinalTwoWinner: 0,
    champion: 0
  };
  let videoHash = hash("0");
  let chainId = 8453,
    mask = 0,
    stale = false,
    orphan = false,
    headChanged = false;
  const numbered: bigint[] = [],
    reads: Array<{ functionName: string; blockNumber: bigint }> = [];
  const client = {
    getChainId: async () => chainId,
    getBlock: async (input: { blockTag?: string; blockNumber?: bigint }) => {
      const number = input.blockNumber ?? 10n;
      if (input.blockNumber !== undefined) numbered.push(number);
      const blockHash =
        number === 1n
          ? orphan
            ? hash("c")
            : hash("b")
          : headChanged && numbered.length > 1
            ? hash("d")
            : hash("a");
      return {
        number,
        hash: blockHash,
        timestamp: BigInt(Math.floor(Date.now() / 1000) - (stale ? 1000 : 0))
      };
    },
    readContract: async (input: {
      functionName: string;
      blockNumber: bigint;
    }) => {
      reads.push(input);
      return input.functionName === "tournament"
        ? live
        : input.functionName === "publishedVideoHash"
          ? videoHash
          : mask;
    }
  } as unknown as PublicClient;
  return {
    observed,
    client,
    live,
    numbered,
    reads,
    setVideoHash: (value: Hex) => {
      videoHash = value;
    },
    setChain: (value: number) => {
      chainId = value;
    },
    setMask: (value: number) => {
      mask = value;
    },
    stale: () => {
      stale = true;
    },
    orphan: () => {
      orphan = true;
    },
    headChanged: () => {
      headChanged = true;
    }
  };
}

test("native action checks accept the latest complete block without an extra block wait", async () => {
  const f = fixture();
  await verifyNativeArenaAction(f.client, f.observed);
  assert.equal(f.reads.length, 2);
  assert.ok(f.reads.every((read) => read.blockNumber === 10n));
  assert.deepEqual(f.numbered, [1n, 10n, 10n]);
});

test("historical film verification checks its published hash at a canonical latest head", async () => {
  const f = fixture(),
    film = `0x${"8".repeat(64)}` as Hex;
  f.observed.tournament.state.phase = "settled";
  f.live.phase = 4;
  f.observed.tournament.state.videoHash = film;
  f.setVideoHash(film);
  await verifyNativeArenaFilm(f.client, f.observed);
  assert.equal(f.reads.length, 3);
  assert.ok(f.reads.every((read) => read.blockNumber === 10n));
  f.setVideoHash(`0x${"9".repeat(64)}`);
  await assert.rejects(
    verifyNativeArenaFilm(f.client, f.observed),
    /publication hash changed/
  );
  f.setVideoHash(film);
  const read = f.client.readContract;
  f.client.readContract = (async (
    input: Parameters<PublicClient["readContract"]>[0]
  ) => {
    const value = await read(input);
    if (input.functionName === "publishedVideoHash") f.headChanged();
    return value;
  }) as PublicClient["readContract"];
  await assert.rejects(
    verifyNativeArenaFilm(f.client, f.observed),
    /publication hash changed/
  );
});
test("native action checks reject orphaned evidence and phase, input or automatic-mask changes", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.orphan(),
    (f: ReturnType<typeof fixture>) => {
      f.live.phase = 4;
    },
    (f: ReturnType<typeof fixture>) => {
      f.live.inputHash = `0x${"9".repeat(64)}`;
    },
    (f: ReturnType<typeof fixture>) => f.setMask(1)
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(verifyNativeArenaAction(f.client, f.observed));
  }
});
test("native action checks reject wrong chains, stale heads and a reorg during point verification", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.setChain(1),
    (f: ReturnType<typeof fixture>) => f.stale(),
    (f: ReturnType<typeof fixture>) => f.headChanged()
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(verifyNativeArenaAction(f.client, f.observed));
  }
});
