import { erc721Abi, parseAbi, type Address, type PublicClient } from "viem";
import { animeRegistryAbi } from "@protopals/yunipals-market-core/animeRegistryAbi";
import { animeArenaAbi } from "@protopals/yunipals-market-core/animeArenaAbi";
import {
  canonicalAnimeJson,
  parseAnimeManifest
} from "@protopals/yunipals-market-core/anime";
import { animeSha256 } from "./animeDeployment";

export const animePilot = {
  admin: "0xB3883Cd96d72B08b8226452305A28D65974a3727",
  wallet: "0x08820403d7edb694a2e91eba5bcc73dbcd24ab23",
  registry: "0xdbcab53a8e32d43997de252fd49c43ab8df290bf",
  arena: "0x576790deff75af86fa638d9a1427e1eee7007094",
  collection: "0x98433df878e8c898cb907345c3a7756e5f72240f",
  wrapper: "0xb0407dbe851f8318bd31404a49e658143c982f23",
  rulesHash:
    "0x5f3e761ba928f464ced77cc645d6e4f8fc112e7cb054dd5e49c5a39ef52c98e1",
  reserveWei: 10000000000000n,
  fighters: [
    {
      tokenId: "1000702255",
      name: "Yellow Yunidonkey",
      manifestHash:
        "0x21ae742e3288e9d8f79f4aa32d697aaed92512da88d594d91da7727c6903fefc"
    },
    {
      tokenId: "1000702258",
      name: "Red Yuniturtle",
      manifestHash:
        "0x42f3c0f215884d343b399b2c30898b958d14de36d818eba33f8387912d685893"
    },
    {
      tokenId: "10003506584",
      name: "Yellow Yunichick",
      manifestHash:
        "0x71031200def3f6a9d0ef6e4f463b484e819e9f4eae2c1ec523f6d39a84b27035"
    },
    {
      tokenId: "20000002689",
      name: "Green Yunichick",
      manifestHash:
        "0x08beeb30c42b630d5817d31a988309b88124eaf040978d3fd2c50239f870bac8"
    }
  ]
} as const;
const wrapperAbi = parseAbi([
  "function estimateRequestPriceNative(uint32,uint32,uint256) view returns (uint256)"
]);
export async function readAnimePilotState(client: PublicClient) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const registry = {
    address: animePilot.registry,
    abi: animeRegistryAbi,
    blockNumber
  };
  const arena = { address: animePilot.arena, abi: animeArenaAbi, blockNumber };
  const [
    owner,
    curator,
    applicationsOpen,
    paused,
    rulesHash,
    eligibility,
    balance,
    vrfMax,
    vrfPrice,
    fighters
  ] = await Promise.all([
    client.readContract({ ...registry, functionName: "owner" }),
    client.readContract({ ...registry, functionName: "curator" }),
    client.readContract({ ...registry, functionName: "applicationsOpen" }),
    client.readContract({ ...arena, functionName: "entriesPaused" }),
    client.readContract({ ...arena, functionName: "rulesHash" }),
    client.readContract({ ...arena, functionName: "eligibility" }),
    client.getBalance({ address: animePilot.arena, blockNumber }),
    client.readContract({ ...arena, functionName: "maxVrfCost" }),
    // A missing price blocks new paid entry, while owner controls and fighter
    // status remain available. The quote is checked again before enabling.
    client
      .getGasPrice()
      .then((gasPrice) =>
        client.readContract({
          address: animePilot.wrapper,
          abi: wrapperAbi,
          functionName: "estimateRequestPriceNative",
          args: [120000, 1, gasPrice * 2n],
          blockNumber
        })
      )
      .catch(() => null),
    Promise.all(
      animePilot.fighters.map(async (fighter) => {
        const [value, holder] = await Promise.all([
          client.readContract({
            ...registry,
            functionName: "fighters",
            args: [BigInt(fighter.tokenId)]
          }),
          client.readContract({
            address: animePilot.collection,
            abi: erc721Abi,
            functionName: "ownerOf",
            args: [BigInt(fighter.tokenId)],
            blockNumber
          })
        ]);
        return {
          ...fighter,
          status: value[0],
          onchainHash: value[3],
          owner: holder
        };
      })
    )
  ]);
  const arenaOwner = await client.readContract({
    ...arena,
    functionName: "owner"
  });
  if (
    [owner, curator, arenaOwner].some(
      (value) => value.toLowerCase() !== animePilot.admin.toLowerCase()
    ) ||
    rulesHash !== animePilot.rulesHash ||
    eligibility.toLowerCase() !== animePilot.registry
  )
    throw Error(
      "The deployed arena settings differ from this pilot. Stop and review the deployment."
    );
  return { applicationsOpen, paused, balance, vrfMax, vrfPrice, fighters };
}
export function animePilotDrawBlocker(
  state: Pick<
    Awaited<ReturnType<typeof readAnimePilotState>>,
    "balance" | "vrfMax" | "vrfPrice"
  >
) {
  if (state.vrfPrice === null || state.vrfPrice <= 0n)
    return "The island draw price is temporarily unavailable. Paid entry can be enabled after the price is checked. This page checks again every 15 seconds.";
  if (state.vrfPrice > state.vrfMax)
    return "Base gas is currently too high for the island draw's fixed spending cap. Adding funds cannot increase this cap. This page checks again every 15 seconds.";
  if (state.balance < state.vrfPrice)
    return "The island draw reserve needs funding before paid entry can be enabled.";
  return null;
}
export async function verifyPilotManifest(
  tokenId: string,
  expectedHash: string,
  signal?: AbortSignal
) {
  const response = await fetch(
    `https://assets-anime.yunipals.com/fighters/v1/${tokenId}/manifest.json`,
    { signal, redirect: "error", cache: "no-store" }
  );
  if (!response.ok)
    throw Error("The reviewed fighter artwork is not published yet.");
  const text = await response.text();
  if (text.length > 262144) throw Error("Fighter manifest is too large.");
  const manifest = parseAnimeManifest(JSON.parse(text), tokenId);
  const hash = `0x${await animeSha256(new TextEncoder().encode(canonicalAnimeJson(manifest)))}`;
  if (
    hash !== expectedHash ||
    manifest.recipe.id !== "anime-fighter-v2" ||
    manifest.kits?.length !== 3
  )
    throw Error("The published fighter differs from its reviewed v2 artwork.");
  return manifest;
}
export function pilotOwnsFighters(
  state: Awaited<ReturnType<typeof readAnimePilotState>>,
  wallet: Address
) {
  return state.fighters.every(
    (fighter) => fighter.owner.toLowerCase() === wallet.toLowerCase()
  );
}
