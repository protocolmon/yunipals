/** Unsigned evolution-only upgrade. Production execution belongs in the private operator workflow. */
import { encodeFunctionData, isAddress, type Address } from "viem";
import { evolutionAbi } from "@protopals/yunipals-market-core/evolutionAbi";
const address = (name: string): Address => {
  const value = process.env[name];
  if (!value || !isAddress(value) || /^0x0{40}$/i.test(value))
    throw new Error(`Configure ${name}.`);
  return value;
};
console.log(
  JSON.stringify(
    {
      chainId: Number(process.env.PORTALS_CHAIN_ID ?? "8453"),
      calls: [
        {
          purpose:
            "Upgrade evolution after storage, pending-job, size and fork checks. No initializer or counter reset.",
          to: address("EVOLUTION_ADDRESS"),
          value: "0",
          data: encodeFunctionData({
            abi: evolutionAbi,
            functionName: "upgradeToAndCall",
            args: [address("EVOLUTION_IMPLEMENTATION"), "0x"]
          })
        }
      ]
    },
    null,
    2
  )
);
