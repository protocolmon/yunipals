import type { Address, PublicClient } from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import {
  arenaMode,
  type ArenaContractVersion,
  type ArenaMediaKind
} from "@protopals/yunipals-market-core/arenaProtocol";

type Selection = {
  contract: Address;
  mediaKind: ArenaMediaKind;
  contractVersion: ArenaContractVersion;
};

export function readArenaPaused(
  client: PublicClient,
  selection: Selection,
  blockNumber?: bigint
) {
  return selection.contractVersion === 2
    ? client.readContract({
        address: selection.contract,
        abi: arenaV2Abi,
        functionName: "entriesPaused",
        args: [BigInt(arenaMode(selection.mediaKind))],
        blockNumber
      })
    : client.readContract({
        address: selection.contract,
        abi: arenaAbi,
        functionName: "entriesPaused",
        blockNumber
      });
}

export function readArenaNextId(
  client: PublicClient,
  selection: Selection,
  blockNumber?: bigint
) {
  return selection.contractVersion === 2
    ? client.readContract({
        address: selection.contract,
        abi: arenaV2Abi,
        functionName: "nextTournamentId",
        args: [BigInt(arenaMode(selection.mediaKind))],
        blockNumber
      })
    : client.readContract({
        address: selection.contract,
        abi: arenaAbi,
        functionName: "nextTournamentId",
        blockNumber
      });
}

export async function readArenaSettings(
  client: PublicClient,
  selection: Selection
) {
  const address = selection.contract;
  const common = await client.multicall({
    allowFailure: false,
    contracts: [
      { address, abi: arenaAbi, functionName: "paymentToken" },
      { address, abi: arenaAbi, functionName: "joinWindow" },
      { address, abi: arenaAbi, functionName: "strategyWindow" },
      { address, abi: arenaAbi, functionName: "poolHash" },
      { address, abi: arenaAbi, functionName: "admissionSigner" },
      { address, abi: arenaAbi, functionName: "resolutionWindow" },
      { address, abi: arenaAbi, functionName: "islands" },
      { address, abi: arenaAbi, functionName: "i_vrfV2PlusWrapper" }
    ]
  });
  const mode =
    selection.contractVersion === 2
      ? await client.readContract({
          address,
          abi: arenaV2Abi,
          functionName: "modeConfig",
          args: [arenaMode(selection.mediaKind)]
        })
      : await (async () => {
          const values = await client.multicall({
            allowFailure: false,
            contracts: [
              { address, abi: arenaAbi, functionName: "entryFee" },
              { address, abi: arenaAbi, functionName: "winnerBps" },
              { address, abi: arenaAbi, functionName: "islandBps" },
              { address, abi: arenaAbi, functionName: "rulesHash" }
            ]
          });
          return {
            entryFee: values[0],
            winnerBps: values[1],
            islandBps: values[2],
            rulesHash: values[3],
            eligibility: null
          };
        })();
  return {
    ...mode,
    paymentToken: common[0],
    joinWindow: common[1],
    strategyWindow: common[2],
    poolHash: common[3],
    admissionSigner: common[4],
    resolutionWindow: common[5],
    islands: common[6],
    wrapper: common[7]
  };
}
