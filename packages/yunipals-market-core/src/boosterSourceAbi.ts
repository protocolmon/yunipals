import type { Abi } from "viem";
import { boosterPacksAbi, yunipalMonstersAbi } from "./boosterAbi.js";
import {
  boosterPacksAbiE8145098,
  yunipalMonstersAbiE8145098
} from "./boosterSourceAbi.e8145098.js";

/** Full canonical-JSON SHA-256 digests, including functions and errors. These
 * identify source definitions, not just a compatible event signature. */
export const boosterSourceAbiHashes = {
  e8145098: {
    boosterPacks:
      "0x4127c2493eff266363adae3bb24fcf53038b7da4d72af5f517600e2a7920635d",
    yunipalMonsters:
      "0x680148b00be6884d25a426041f93861ac175dfe3535224636c46cdcb3daa3a94"
  },
  current: {
    boosterPacks:
      "0x05373e5a7d5e3152ef7f2bb71695871ee789322f2d516004bff21a409e5aaf6c",
    yunipalMonsters:
      "0x0929ebf2bcf3ca334e1e5425ebf1ce23faa35243f68aac7b1b3d3aca94b3718f"
  }
} as const;

export class UnsupportedBoosterSourceAbi extends Error {
  constructor() {
    super("Unsupported booster source ABI.");
  }
}

/** Select only a known full ABI. Evidence readers must additionally recompute
 * its digest against the manifest, so compiled-content drift fails closed. */
export function boosterPacksSourceAbi(sourceAbiHash?: string): Abi {
  switch (sourceAbiHash) {
    case undefined:
    case boosterSourceAbiHashes.current.boosterPacks:
      return boosterPacksAbi;
    case boosterSourceAbiHashes.e8145098.boosterPacks:
      return boosterPacksAbiE8145098;
    default:
      throw new UnsupportedBoosterSourceAbi();
  }
}

export function yunipalMonstersSourceAbi(sourceAbiHash?: string): Abi {
  switch (sourceAbiHash) {
    case undefined:
    case boosterSourceAbiHashes.current.yunipalMonsters:
      return yunipalMonstersAbi;
    case boosterSourceAbiHashes.e8145098.yunipalMonsters:
      return yunipalMonstersAbiE8145098;
    default:
      throw new UnsupportedBoosterSourceAbi();
  }
}
