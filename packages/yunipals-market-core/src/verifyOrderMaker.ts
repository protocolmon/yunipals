import {
  getAddress,
  hashTypedData,
  parseAbi,
  recoverAddress,
  type Address,
  type Hex
} from "viem";

import {
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "./registry";
import { seaportSigningData, type SeaportOrderComponents } from "./seaport";

const signatureAbi = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4 magicValue)"
]);

// Keep the shared boundary independent of a particular viem client/chain type
// instantiation in the consuming app. These are the only supported RPC actions.
export type SeaportSignatureClient = {
  getChainId(): Promise<number>;
  getCode(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
  readContract(input: {
    address: Address;
    account: Address;
    abi: typeof signatureAbi;
    functionName: "isValidSignature";
    args: readonly [Hex, Hex];
    blockNumber: bigint;
  }): Promise<unknown>;
};

export async function verifySeaportOrderMaker(
  client: SeaportSignatureClient,
  chain: MarketplaceChain,
  order: SeaportOrderComponents,
  signature: Hex,
  blockNumber: bigint
) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) || signature.length > 32_770)
    return false;
  if ((await client.getChainId()) !== marketplaceChains[chain].chainId)
    throw new Error(
      "Signature verification is connected to a different chain."
    );
  const maker = getAddress(order.offerer);
  const hash = hashTypedData(
    seaportSigningData(
      {
        name: seaportDeployment.name,
        version: seaportDeployment.version,
        verifyingContract: seaportDeployment.address,
        chainId: marketplaceChains[chain].chainId
      },
      order
    )
  );
  if (
    signature.length === 130 ||
    (signature.length === 132 &&
      ["1b", "1c"].includes(signature.slice(-2).toLowerCase()))
  ) {
    try {
      if (getAddress(await recoverAddress({ hash, signature })) === maker)
        return true;
    } catch {
      /* Deployed contract wallets can use other signature formats. */
    }
  }
  const code = await client.getCode({ address: maker, blockNumber });
  if (!code || code === "0x") return false;
  // No counterfactual deployment or universal signature validator is invoked:
  // it would not prove that the existing Seaport contract accepts the signature.
  return (
    (await client.readContract({
      address: maker,
      account: seaportDeployment.address,
      abi: signatureAbi,
      functionName: "isValidSignature",
      args: [hash, signature],
      blockNumber
    })) === "0x1626ba7e"
  );
}
