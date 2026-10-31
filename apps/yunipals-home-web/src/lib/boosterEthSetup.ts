import {
  encodeFunctionData,
  keccak256,
  padHex,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import bundle from "./fixtures/eth-payment-package.json" with { type: "json" };
import { checkBoosterEthPayment } from "./boosterEth";

export const ethSetupBundle = bundle;
export const ethSetupSteps = [
  "implementation",
  "adapter",
  "upgrade",
  "grant"
] as const;
export type EthSetupStep = (typeof ethSetupSteps)[number];
export type EthSetupReceipts = Partial<Record<EthSetupStep, Hex>>;
export const ethSetupLabels: Record<EthSetupStep, string> = {
  implementation: "Deploy pack implementation",
  adapter: "Deploy ETH payment contract",
  upgrade: "Upgrade pack engine",
  grant: "Activate ETH payment contract"
};
const adminAbi = parseAbi([
  "function hasRole(bytes32 role,address account) view returns(bool)",
  "function upgradeToAndCall(address implementation,bytes data) payable",
  "function grantRole(bytes32 role,address account)",
  "function registry() view returns(address)",
  "function monsters() view returns(address)",
  "function wrapper() view returns(address)"
]);
const role = (name: string) => keccak256(new TextEncoder().encode(name));

export function matchesEthRuntime(
  code: Hex,
  template: string,
  references: Record<string, { start: number; length: number }[]>
) {
  if (code.length !== template.length) return false;
  let masked = code.slice(2);
  for (const { start, length } of Object.values(references).flat()) {
    masked =
      masked.slice(0, start * 2) +
      "0".repeat(length * 2) +
      masked.slice((start + length) * 2);
  }
  return `0x${masked}`.toLowerCase() === template.toLowerCase();
}

export async function ethSetupState(
  client: PublicClient,
  receipts: EthSetupReceipts
) {
  if ((await client.getChainId()) !== bundle.chainId)
    throw new Error("Select Base.");
  const [slot, ...deps] = await Promise.all([
    client.getStorageAt({
      address: bundle.engine as Address,
      slot: bundle.implementationSlot as Hex
    }),
    ...(["registry", "monsters", "wrapper"] as const).map((key) =>
      client.readContract({
        address: bundle.engine as Address,
        abi: adminAbi,
        functionName: key
      })
    )
  ]);
  if (
    !slot ||
    deps.some(
      (value, index) =>
        value.toLowerCase() !==
        Object.values(bundle.dependencies)[index].toLowerCase()
    )
  )
    throw new Error("The engine dependencies changed.");
  const addresses: { implementation?: Address; adapter?: Address } = {};
  for (const step of ["implementation", "adapter"] as const) {
    const hash = receipts[step];
    if (!hash) continue;
    const [receipt, tx] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getTransaction({ hash })
    ]);
    const data =
      step === "implementation"
        ? bundle.engineCreation
        : bundle.adapterCreation;
    if (
      receipt.status !== "success" ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      tx.hash.toLowerCase() !== hash.toLowerCase() ||
      tx.from.toLowerCase() !== bundle.owner ||
      tx.to !== null ||
      tx.value !== 0n ||
      tx.input !== data ||
      !receipt.contractAddress
    )
      throw new Error(
        `The ${step} deployment receipt does not match this package.`
      );
    const code = await client.getCode({ address: receipt.contractAddress });
    const template =
      step === "implementation" ? bundle.engineRuntime : bundle.adapterRuntime;
    const refs =
      step === "implementation"
        ? bundle.engineImmutables
        : bundle.adapterImmutables;
    if (!code || !matchesEthRuntime(code, template, refs))
      throw new Error(`The ${step} runtime does not match this package.`);
    if (step === "implementation") {
      // Both inherited UUPS immutable references must bind this deployment.
      const spans = Object.values(refs).flat();
      if (
        spans.some(
          ({ start, length }) =>
            length !== 32 ||
            `0x${code.slice(2 + start * 2, 2 + (start + length) * 2)}`.toLowerCase() !==
              padHex(receipt.contractAddress!).toLowerCase()
        )
      )
        throw new Error("Implementation immutable mismatch.");
    }
    addresses[step] = receipt.contractAddress;
  }
  const current = `0x${slot.slice(-40)}`.toLowerCase();
  const upgraded = current === addresses.implementation?.toLowerCase();
  if (!upgraded) {
    const code = await client.getCode({ address: current as Address });
    if (
      current !== bundle.previousImplementation ||
      !code ||
      keccak256(code) !== bundle.previousRuntimeHash
    )
      throw new Error(
        "The engine implementation changed; refresh the deployment package."
      );
  }
  if (
    !(await client.readContract({
      address: bundle.engine as Address,
      abi: adminAbi,
      functionName: "hasRole",
      args: [role("UPGRADER_ROLE"), bundle.owner as Address]
    })) ||
    !(await client.readContract({
      address: bundle.engine as Address,
      abi: adminAbi,
      functionName: "hasRole",
      args: [`0x${"00".repeat(32)}`, bundle.owner as Address]
    }))
  )
    throw new Error("The deployment owner no longer has the required roles.");
  let activated = false;
  if (upgraded && addresses.adapter) {
    const granted = await client.readContract({
      address: bundle.engine as Address,
      abi: adminAbi,
      functionName: "hasRole",
      args: [role("PAYMENT_ADAPTER_ROLE"), addresses.adapter]
    });
    if (granted) {
      await checkBoosterEthPayment(
        client,
        addresses.adapter,
        bundle.engine as Address,
        bundle.ypal as Address
      );
      activated = true;
    }
  }
  return { ...addresses, upgraded, activated };
}

export async function ethSetupAction(
  client: PublicClient,
  receipts: EthSetupReceipts,
  step: EthSetupStep
) {
  const state = await ethSetupState(client, receipts);
  if (step === "implementation" && !state.implementation)
    return { data: bundle.engineCreation as Hex };
  if (step === "adapter" && state.implementation && !state.adapter)
    return { data: bundle.adapterCreation as Hex };
  if (
    step === "upgrade" &&
    state.implementation &&
    state.adapter &&
    !state.upgraded
  )
    return {
      to: bundle.engine as Address,
      data: encodeFunctionData({
        abi: adminAbi,
        functionName: "upgradeToAndCall",
        args: [state.implementation, "0x"]
      })
    };
  if (step === "grant" && state.upgraded && state.adapter && !state.activated)
    return {
      to: bundle.engine as Address,
      data: encodeFunctionData({
        abi: adminAbi,
        functionName: "grantRole",
        args: [role("PAYMENT_ADAPTER_ROLE"), state.adapter]
      })
    };
  throw new Error("This step is complete or its earlier steps are missing.");
}
