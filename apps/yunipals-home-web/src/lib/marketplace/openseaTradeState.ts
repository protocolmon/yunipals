import {
  erc20Abi,
  erc721Abi,
  formatUnits,
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type PublicClient
} from "viem";

import {
  buildOpenSeaApproval,
  buildOpenSeaWrap
} from "@/lib/marketplace/openseaActions";
import type { OpenSeaTrade } from "@/lib/marketplace/openseaFulfillment";
import {
  isOpenSeaChain,
  openSeaCurrency,
  openseaConduit
} from "@/lib/marketplace/openseaRegistry";
import { seaportDeployment } from "@/lib/marketplace/registry";
import {
  seaportReadAbi,
  seaportWriteAbi,
  seaportFulfillmentOrder
} from "@/lib/marketplace/seaport";
import type { MarketTransactionIntent } from "@/lib/marketplace/transactionIntent";
import { verifySeaportOrderMaker } from "@/lib/marketplace/verifyOrderMaker";

export const conduitControllerAbi = parseAbi([
  "function getConduit(bytes32 conduitKey) view returns (address conduit, bool exists)",
  "function getChannelStatus(address conduit, address channel) view returns (bool isOpen)"
]);
export type OpenSeaPrerequisite = {
  intent: MarketTransactionIntent;
  label: string;
  message: string;
};

/** Fresh state at one block; quotes and UI observations never establish ownership. */
export async function inspectOpenSeaTrade(
  client: PublicClient,
  trade: OpenSeaTrade
): Promise<{ blockNumber: bigint; next?: OpenSeaPrerequisite }> {
  const { intent, approvals } = trade;
  const chain = intent.asset.chain;
  if (!isOpenSeaChain(chain) || (await client.getChainId()) !== intent.chainId)
    throw new Error("The marketplace connection is on a different chain.");
  const block = await client.getBlock();
  if (
    block.timestamp >= intent.quoteExpiresAt ||
    block.timestamp >= intent.order.endTime ||
    block.timestamp < intent.order.startTime
  )
    throw new Error("The quote or order expired. Review it again.");
  const blockNumber = block.number;
  const [owner, counter, status] = await Promise.all([
    client.readContract({
      address: intent.asset.contractAddress,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [BigInt(intent.asset.tokenId)],
      blockNumber
    }),
    client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getCounter",
      args: [intent.order.offerer],
      blockNumber
    }),
    client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getOrderStatus",
      args: [intent.orderHash],
      blockNumber
    })
  ]);
  const listing = intent.kind === "buy";
  if (
    getAddress(owner) !==
    getAddress(listing ? intent.order.offerer : intent.account)
  )
    throw new Error("The NFT owner changed. Refresh the order.");
  if (counter !== intent.order.counter || status[1] || status[2] !== 0n)
    throw new Error(
      "The order was filled, cancelled or invalidated by its maker."
    );
  if (
    !status[0] &&
    !(await verifySeaportOrderMaker(
      client,
      chain,
      intent.order,
      trade.signature,
      blockNumber
    ))
  ) {
    try {
      const validated = await client.simulateContract({
        address: seaportDeployment.address,
        abi: seaportWriteAbi,
        functionName: "validate",
        args: [[seaportFulfillmentOrder(intent.order, trade.signature)]],
        account: intent.account,
        blockNumber
      });
      if (validated.result !== true) throw new Error();
    } catch {
      throw new Error("The maker's signature is no longer valid.");
    }
  }
  await assertOpenSeaDeployment(client, blockNumber, intent.order.zone, [
    trade.makerSpender,
    ...approvals.map((approval) => approval.spender)
  ]);
  async function nftApproved(account: Address, spender: Address) {
    const [operator, approved] = await Promise.all([
      client.readContract({
        address: intent.asset.contractAddress,
        abi: erc721Abi,
        functionName: "isApprovedForAll",
        args: [account, spender],
        blockNumber
      }),
      client.readContract({
        address: intent.asset.contractAddress,
        abi: erc721Abi,
        functionName: "getApproved",
        args: [BigInt(intent.asset.tokenId)],
        blockNumber
      })
    ]);
    return operator || getAddress(approved) === getAddress(spender);
  }
  if (listing) {
    if (!(await nftApproved(intent.order.offerer, trade.makerSpender)))
      throw new Error("The seller has not approved the NFT transfer.");
    if (
      intent.value > 0n &&
      (await client.getBalance({ address: intent.account, blockNumber })) <
        intent.value
    )
      throw new Error(
        "Your native-token balance does not cover this purchase."
      );
  } else {
    const offered = intent.order.offer[0];
    const [balance, allowance] = await Promise.all([
      client.readContract({
        address: offered.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [intent.order.offerer],
        blockNumber
      }),
      client.readContract({
        address: offered.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [intent.order.offerer, trade.makerSpender],
        blockNumber
      })
    ]);
    if (balance < offered.startAmount || allowance < offered.startAmount)
      throw new Error(
        "The offer maker no longer has the required balance or approval."
      );
  }
  for (const approval of approvals) {
    if (approval.kind === "nft") {
      if (!(await nftApproved(intent.account, approval.spender)))
        return {
          blockNumber,
          next: {
            intent: buildOpenSeaApproval(
              intent.asset,
              intent.account,
              approval
            ),
            label: "Approve this NFT",
            message: `Approve ${getAddress(approval.spender)} to transfer token #${intent.asset.tokenId}, then review the offer again.`
          }
        };
      continue;
    }
    const currency = openSeaCurrency(chain, approval.token);
    const [balance, allowance] = await Promise.all([
      client.readContract({
        address: currency.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [intent.account],
        blockNumber
      }),
      client.readContract({
        address: currency.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [intent.account, approval.spender],
        blockNumber
      })
    ]);
    // General Seaport offer fulfillment transfers the buyer's WETH first, then
    // pulls consideration fees from the seller. Existing WETH is not required.
    if (!approval.fundedByOffer && balance < approval.amount) {
      const deficit = approval.amount - balance;
      if (!currency.canWrapNative)
        throw new Error(
          "You need more WETH on Polygon for this purchase. Native POL cannot be wrapped into WETH."
        );
      if (
        (await client.getBalance({ address: intent.account, blockNumber })) <
        deficit
      )
        throw new Error("Your ETH balance does not cover the missing WETH.");
      const amount = formatUnits(deficit, currency.decimals);
      return {
        blockNumber,
        next: {
          intent: buildOpenSeaWrap(
            chain,
            intent.account,
            currency.address,
            deficit
          ),
          label: `Wrap ${amount} ETH`,
          message: `Convert ${amount} ETH to WETH to cover the missing payment amount. You will review the trade again after wrapping.`
        }
      };
    }
    if (allowance < approval.amount) {
      const amount = formatUnits(approval.amount, currency.decimals);
      return {
        blockNumber,
        next: {
          intent: buildOpenSeaApproval(intent.asset, intent.account, approval),
          label: `Approve ${amount} WETH`,
          message: `Set the allowance for ${getAddress(approval.spender)} to ${amount} WETH.${approval.fundedByOffer ? " These fees come from the WETH received in this trade." : " This covers the reviewed purchase total."} You will review the trade again after approval.`
        }
      };
    }
  }
  return { blockNumber };
}

/** Validate the configured zone and transfer path before asking for approvals. */
export async function assertOpenSeaDeployment(
  client: PublicClient,
  blockNumber: bigint,
  zone: Address,
  spenders: Address[]
) {
  const information = await client.readContract({
    address: seaportDeployment.address,
    abi: seaportReadAbi,
    functionName: "information",
    blockNumber
  });
  if (
    information[0] !== seaportDeployment.version ||
    getAddress(information[2]) !== getAddress(openseaConduit.controller)
  )
    throw new Error(
      "The settlement deployment does not match this marketplace."
    );
  if (getAddress(zone) !== zeroAddress) {
    const code = await client.getCode({
      address: zone,
      blockNumber
    });
    if (!code || code === "0x")
      throw new Error(
        "The order's validation zone is unavailable on this chain."
      );
  }
  if (
    spenders.some(
      (spender) => getAddress(spender) === getAddress(openseaConduit.address)
    )
  ) {
    const [conduit, open] = await Promise.all([
      client.readContract({
        address: openseaConduit.controller,
        abi: conduitControllerAbi,
        functionName: "getConduit",
        args: [openseaConduit.key],
        blockNumber
      }),
      client.readContract({
        address: openseaConduit.controller,
        abi: conduitControllerAbi,
        functionName: "getChannelStatus",
        args: [openseaConduit.address, seaportDeployment.address],
        blockNumber
      })
    ]);
    if (
      !conduit[1] ||
      getAddress(conduit[0]) !== getAddress(openseaConduit.address) ||
      !open
    )
      throw new Error("The OpenSea transfer conduit is unavailable.");
  }
}
