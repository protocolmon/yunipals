/** Deployment-neutral, unsigned administrator calls. Never loads a signing or AI key. */
import {
  isAddress,
  encodeFunctionData,
  keccak256,
  toHex,
  parseAbi,
  type Address
} from "viem";
import {
  evolutionAbi,
  evolutionCardsAbi
} from "@protopals/yunipals-market-core/evolutionAbi";
const address = (name: string): Address => {
  const value = process.env[name];
  if (!value || !isAddress(value) || /^0x0{40}$/i.test(value))
    throw new Error(`Configure ${name}.`);
  return value;
};
const upgradeAbi = parseAbi(["function upgradeToAndCall(address,bytes)"]);
const calls = [
  ["PORTALS_ENGINE_ADDRESS", "EVOLUTION_ENGINE_IMPLEMENTATION"],
  ["PORTALS_CARDS_ADDRESS", "EVOLUTION_CARDS_IMPLEMENTATION"],
  ["PORTALS_GRADING_ADDRESS", "EVOLUTION_GRADING_IMPLEMENTATION"]
].map(([proxy, implementation]) => ({
  purpose: `Upgrade ${proxy} after storage, size and fork checks`,
  to: address(proxy),
  value: "0",
  data: encodeFunctionData({
    abi: upgradeAbi,
    functionName: "upgradeToAndCall",
    args: [address(implementation), "0x"]
  })
}));
calls.push({
  purpose: "Authorize the existing portal worker signer",
  to: address("EVOLUTION_ADDRESS"),
  value: "0",
  data: encodeFunctionData({
    abi: evolutionAbi,
    functionName: "grantRole",
    args: [
      keccak256(toHex("GENERATOR_ROLE")),
      address("PORTALS_GRADER_ADDRESS")
    ]
  })
});
calls.push({
  purpose:
    "Bind evolution and adventures last; verify the shared indexer and worker before enabling frontend actions",
  to: address("PORTALS_CARDS_ADDRESS"),
  value: "0",
  data: encodeFunctionData({
    abi: evolutionCardsAbi,
    functionName: "configureEvolution",
    args: [address("EVOLUTION_ADDRESS"), address("ADVENTURES_ADDRESS")]
  })
});
console.log(
  JSON.stringify(
    { chainId: Number(process.env.PORTALS_CHAIN_ID ?? "8453"), calls },
    null,
    2
  )
);
