import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import {
  boosterPacksAbi,
  yunipalMonstersAbi
} from "../../../packages/yunipals-market-core/src/boosterAbi.js";
import {
  boosterPacksSourceAbi,
  boosterSourceAbiHashes,
  UnsupportedBoosterSourceAbi,
  yunipalMonstersSourceAbi
} from "../../../packages/yunipals-market-core/src/boosterSourceAbi.js";
import {
  boosterPacksAbiE8145098,
  yunipalMonstersAbiE8145098
} from "../../../packages/yunipals-market-core/src/boosterSourceAbi.e8145098.js";
import {
  decodeIndexedActionLog,
  indexedActionAbi,
  matchesIndexedAction,
  type IndexedAction
} from "../../../packages/yunipals-market-core/src/indexedAction.js";
import { manifestDigest } from "../../../packages/yunipals-indexer-server/src/identity.js";

const action: IndexedAction = {
  kind: "booster-request-created",
  requestId: "1",
  originalId: "2",
  packTypeId: "3",
  payer: `0x${"12".repeat(20)}`,
  quantity: 3,
  opening: true,
  paid: "17",
  ruleHash: `0x${"34".repeat(32)}`,
  callbackGas: 500000
};

describe("finite full booster source ABI catalog", () => {
  it("pins every full array digest and preserves the exact historical array sizes", () => {
    // Independent full-content hashes: RequestCreated alone is deliberately
    // insufficient, since both versions have that identical event ABI.
    expect(manifestDigest(boosterPacksAbiE8145098)).toBe(
      "0x4127c2493eff266363adae3bb24fcf53038b7da4d72af5f517600e2a7920635d"
    );
    expect(manifestDigest(yunipalMonstersAbiE8145098)).toBe(
      "0x680148b00be6884d25a426041f93861ac175dfe3535224636c46cdcb3daa3a94"
    );
    expect(manifestDigest(boosterPacksAbi)).toBe(
      "0x05373e5a7d5e3152ef7f2bb71695871ee789322f2d516004bff21a409e5aaf6c"
    );
    expect(manifestDigest(yunipalMonstersAbi)).toBe(
      "0x0929ebf2bcf3ca334e1e5425ebf1ce23faa35243f68aac7b1b3d3aca94b3718f"
    );
    expect(boosterPacksAbiE8145098).toHaveLength(71);
    expect(yunipalMonstersAbiE8145098).toHaveLength(62);
    expect(
      boosterPacksAbiE8145098.find((item) => item.name === "RequestCreated")
    ).toEqual(boosterPacksAbi.find((item) => item.name === "RequestCreated"));
  });

  it.each(["e8145098", "current"] as const)(
    "resolves and decodes the full %s source version",
    (version) => {
      const hashes = boosterSourceAbiHashes[version];
      const abi = boosterPacksSourceAbi(hashes.boosterPacks);
      expect(manifestDigest(abi)).toBe(hashes.boosterPacks);
      expect(
        manifestDigest(yunipalMonstersSourceAbi(hashes.yunipalMonsters))
      ).toBe(hashes.yunipalMonsters);
      expect(indexedActionAbi(action, hashes.boosterPacks)).toBe(abi);
      const log = {
        topics: encodeEventTopics({
          abi,
          eventName: "RequestCreated",
          args: { requestId: 1n, originalId: 2n, packTypeId: 3n }
        }) as string[],
        data: encodeAbiParameters(
          [
            { type: "address" },
            { type: "uint32" },
            { type: "bool" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "uint32" }
          ],
          [
            action.payer as `0x${string}`,
            action.quantity,
            action.opening,
            BigInt(action.paid),
            action.ruleHash as `0x${string}`,
            action.callbackGas
          ]
        )
      };
      expect(
        matchesIndexedAction(
          action,
          decodeIndexedActionLog(action, log, hashes.boosterPacks)
        )
      ).toBe(true);
    }
  );

  it("retains the current default without changing frontend ABI exports", () => {
    expect(indexedActionAbi(action)).toBe(boosterPacksAbi);
    expect(boosterPacksSourceAbi()).toBe(boosterPacksAbi);
    expect(yunipalMonstersSourceAbi()).toBe(yunipalMonstersAbi);
  });

  it("rejects unknown, event-only and cross-contract hashes before decoding", () => {
    for (const hash of [
      `0x${"ab".repeat(32)}`,
      manifestDigest(boosterPacksAbi.filter((item) => item.type === "event")),
      boosterSourceAbiHashes.e8145098.yunipalMonsters
    ]) {
      expect(() => indexedActionAbi(action, hash)).toThrow(
        UnsupportedBoosterSourceAbi
      );
      expect(() =>
        decodeIndexedActionLog(action, { topics: [], data: "0x" }, hash)
      ).toThrow(UnsupportedBoosterSourceAbi);
    }
    expect(() =>
      yunipalMonstersSourceAbi(boosterSourceAbiHashes.current.boosterPacks)
    ).toThrow(UnsupportedBoosterSourceAbi);
  });
});
