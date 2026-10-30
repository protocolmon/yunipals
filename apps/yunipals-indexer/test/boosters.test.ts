import { describe, expect, it } from "vitest";
import { validateBoosterCatalog } from "../../../packages/yunipals-market-core/src/boosterCatalog.js";
import {
  accruedBoosterCredits,
  boosterBatchSize,
  boosterIdentity,
  type BoosterOriginal
} from "../../../packages/yunipals-market-core/src/boosters.js";
import { boosterContracts, boosterDeployment } from "../lib/boosters/config.js";

const address = "0x1111111111111111111111111111111111111111";
const hash = `0x${"ab".repeat(32)}` as const;
const original: BoosterOriginal = {
  id: boosterIdentity(address, "1"),
  collection: address,
  tokenId: "1",
  typeKey: "pack",
  engine: address,
  owner: address,
  revealedAt: "1000000",
  dailyCommitted: "0",
  minted: "1",
  remaining: "15",
  pendingRequest: null,
  burned: false,
  pack: {
    id: "pack",
    packTypeId: "1",
    registry: address,
    engine: address,
    paymentToken: address,
    price: "1000000000000000000",
    intervalSeconds: "86400",
    mintsPerInterval: 1,
    totalVariants: "16",
    maxBatch: 7,
    catalogHash: hash,
    ruleHash: hash,
    manifestUri: "ipfs://manifest",
    metadataBaseUri: "ipfs://metadata/",
    salesPaused: false,
    openings: "1"
  }
};

describe("booster accrual display agrees with purchased rights", () => {
  it("preserves partial days and caps the complete collection", () => {
    expect(accruedBoosterCredits(original, 1086399n).claimable).toBe(0n);
    expect(accruedBoosterCredits(original, 1086400n).claimable).toBe(1n);
    expect(accruedBoosterCredits(original, 1302400n).claimable).toBe(3n);
    expect(accruedBoosterCredits(original, 10000000n)).toEqual({
      claimable: 15n,
      nextAt: null
    });
    expect(boosterBatchSize(original, 10000000n)).toBe(7);
  });
  it("reserves pending credits and ends rights on burn", () => {
    const pending = {
      ...original,
      dailyCommitted: "3",
      pendingRequest: "request"
    };
    expect(accruedBoosterCredits(pending, 1345600n).claimable).toBe(1n);
    expect(boosterBatchSize(pending, 1345600n)).toBe(0);
    expect(
      accruedBoosterCredits({ ...pending, burned: true }, 10000000n).claimable
    ).toBe(0n);
    expect(
      accruedBoosterCredits({ ...original, minted: "0" }, 10000000n).claimable
    ).toBe(0n);
  });
  it("supports different future pack intervals and rates", () => {
    expect(
      accruedBoosterCredits(
        {
          ...original,
          pack: {
            ...original.pack,
            intervalSeconds: "172800",
            mintsPerInterval: 3
          }
        },
        1345600n
      ).claimable
    ).toBe(6n);
  });
});

describe("booster catalog and deployment validation", () => {
  const catalog = {
    types: [2, 7],
    colors: [0, 9],
    horns: [0, 6],
    glitters: [0, 1],
    allowed: [] as number[]
  };
  it("encodes the same catalog hash as the contract fixture", () => {
    expect(validateBoosterCatalog(catalog)).toEqual({
      totalVariants: 16,
      catalogHash:
        "0x40cb8c76f032917fe32cb82acd06482e1d65e9fccc8d0e92a5df0ca325fde6d6"
    });
    expect(
      validateBoosterCatalog({ ...catalog, allowed: [0, 15] }).totalVariants
    ).toBe(2);
  });
  it("rejects duplicate, missing, or unbalanced trait definitions", () => {
    expect(() => validateBoosterCatalog({ ...catalog, types: [] })).toThrow();
    expect(() =>
      validateBoosterCatalog({ ...catalog, types: [2, 2] })
    ).toThrow();
    expect(() =>
      validateBoosterCatalog({ ...catalog, allowed: [0, 1] })
    ).toThrow("equal probability");
    expect(() =>
      validateBoosterCatalog({ ...catalog, allowed: [0, 16] })
    ).toThrow();
  });
  it("disables unconfigured indexing and rejects partial deployments", () => {
    expect(boosterDeployment({})).toBeNull();
    expect(() => boosterDeployment({ BOOSTER_ENGINE: address })).toThrow();
    expect(() =>
      boosterDeployment({
        BOOSTER_ENGINE: address,
        BOOSTER_REGISTRY: address,
        BOOSTER_MONSTERS: address,
        BOOSTER_WRAPPER: address,
        BOOSTER_DEPLOYMENT_BLOCK: "0"
      })
    ).toThrow("deployment block");
  });
  it("preserves exact per-contract deployment blocks across source releases", () => {
    const env = {
      BOOSTER_ENGINE: address,
      BOOSTER_REGISTRY: address,
      BOOSTER_MONSTERS: address,
      BOOSTER_WRAPPER: address,
      BOOSTER_DEPLOYMENT_BLOCK: "52995007"
    };
    expect(boosterContracts(env).BoosterEngine.startBlock).toBe(52995007);
    const contracts = boosterContracts({
      ...env,
      BOOSTER_ENGINE_DEPLOYMENT_BLOCK: "52995174",
      BOOSTER_MONSTERS_DEPLOYMENT_BLOCK: "52995029"
    });
    expect(contracts.BoosterRegistry.startBlock).toBe(52995007);
    expect(contracts.BoosterEngine.startBlock).toBe(52995174);
    expect(contracts.BoosterMonsters.startBlock).toBe(52995029);
    for (const invalid of ["0", "-1", "1.5", "9007199254740992", ""]) {
      expect(() =>
        boosterContracts({ ...env, BOOSTER_ENGINE_DEPLOYMENT_BLOCK: invalid })
      ).toThrow("BOOSTER_ENGINE_DEPLOYMENT_BLOCK");
    }
    expect(() =>
      boosterContracts({ BOOSTER_ENGINE_DEPLOYMENT_BLOCK: "1" })
    ).toThrow("BOOSTER_ENGINE_DEPLOYMENT_BLOCK");
  });
  it("keeps same-chain collections distinct with exact large token IDs", () => {
    const id = "900719925474099300000";
    expect(boosterIdentity(address.toUpperCase(), id)).toBe(
      `8453:${address}:${id}`
    );
    expect(boosterIdentity(address, id)).not.toBe(
      boosterIdentity("0x2222222222222222222222222222222222222222", id)
    );
  });
});
