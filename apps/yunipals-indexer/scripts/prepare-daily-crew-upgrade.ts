/** Outputs unsigned calls only; no RPC, key loading or submission. */
import { encodeFunctionData, isAddress, parseAbi, type Address } from "viem";
import { adventureAbi } from "@protopals/yunipals-market-core/evolutionAbi";
const address = (name: string): Address => {
  const value = process.env[name];
  if (!value || !isAddress(value) || /^0x0{40}$/i.test(value))
    throw new Error(`Configure ${name}.`);
  return value;
};
const upgradeAbi = parseAbi(["function upgradeToAndCall(address,bytes)"]);
// Registry first: the upgraded engine reads its frozen daily policy even for legacy packs.
const upgrades = [
  ["BOOSTER_REGISTRY", "CREW_REGISTRY_IMPLEMENTATION"],
  ["PORTALS_CARDS_ADDRESS", "CREW_CARDS_IMPLEMENTATION"],
  ["PORTALS_ENGINE_ADDRESS", "CREW_ENGINE_IMPLEMENTATION"],
  ["PORTALS_GRADING_ADDRESS", "CREW_GRADING_IMPLEMENTATION"],
  ["ADVENTURES_ADDRESS", "CREW_ADVENTURES_IMPLEMENTATION"]
];
const calls = upgrades.map(([proxy, implementation]) => ({
  purpose: `Upgrade ${proxy}; verify storage and runtime size first`,
  to: address(proxy),
  value: "0",
  data: encodeFunctionData({
    abi: upgradeAbi,
    functionName: "upgradeToAndCall",
    args: [address(implementation), "0x"]
  })
}));
calls.push({
  purpose:
    "Enable daily crews after the shared indexer and worker are ready; accepted solo requests keep their original odds",
  to: address("ADVENTURES_ADDRESS"),
  value: "0",
  data: encodeFunctionData({
    abi: adventureAbi,
    functionName: "enableCrewAdventures"
  })
});
console.log(
  JSON.stringify(
    { chainId: Number(process.env.PORTALS_CHAIN_ID ?? "8453"), calls },
    null,
    2
  )
);
