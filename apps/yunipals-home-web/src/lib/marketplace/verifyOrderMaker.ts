import { type Hex, type PublicClient } from "viem";
import { verifySeaportOrderMaker } from "@protopals/yunipals-market-core/verifyOrderMaker";

import { type PublicationIntent } from "@/lib/marketplace/orderPublication";

export { verifySeaportOrderMaker } from "@protopals/yunipals-market-core/verifyOrderMaker";

export async function verifyBnbOrderMaker(
  client: PublicClient,
  intent: PublicationIntent,
  signature: Hex,
  blockNumber: bigint
) {
  return verifySeaportOrderMaker(
    client,
    "bnb",
    intent.order,
    signature,
    blockNumber
  );
}
