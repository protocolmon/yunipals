import {
  encodeFunctionData,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type PublicClient
} from "viem";

export const boosterEthAbi = parseAbi([
  "function VERSION() view returns (uint256)",
  "function engine() view returns (address)",
  "function ypal() view returns (address)",
  "function pmon() view returns (address)",
  "function proto() view returns (address)",
  "function weth() view returns (address)",
  "function v2Router() view returns (address)",
  "function v3Router() view returns (address)",
  "function openPacks(uint256 packTypeId,uint32 count,uint8 route,uint256 maxSwapPrice,uint256 maxVrfPrice,uint256 deadline) payable returns (uint256[] requestIds,uint256[] originalIds)",
  "function refundCredits(address buyer) view returns (uint256)",
  "function withdrawRefund(address recipient)",
  "event EthPackPurchased(address indexed buyer,uint256 indexed packTypeId,uint8 route,uint32 count,uint256 ypalAmount,uint256 ethSpent)"
]);
const roleAbi = parseAbi([
  "function PAYMENT_ADAPTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)"
]);
const v2Abi = parseAbi([
  "function getAmountsIn(uint256 amountOut,address[] path) view returns (uint256[] amounts)"
]);
const quoterAbi = parseAbi([
  "function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
]);
export const baseEthRoutes = {
  pmon: "0x60edae6e86546428da423b5fbe0fba46ca552fc7",
  proto: "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3",
  weth: "0x4200000000000000000000000000000000000006",
  v2Router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
  v3Router: "0x2626664c2603336e57b271c5c0b26f421741e481",
  quoter: "0x3d4e44eb1374240ce5f1b871ab261cd16335b76a"
} as const;
export type EthPackRoute = 0 | 1;
export type EthPackQuote = {
  route: EthPackRoute;
  price: bigint;
  maximum: bigint;
};

export function boosterEthAddress(value: string): Address | null {
  return isAddress(value, { strict: false }) &&
    value.toLowerCase() !== zeroAddress
    ? (value.toLowerCase() as Address)
    : null;
}

// A configured address alone never activates checkout. All fixed dependencies
// and the engine grant must agree with the selected public pack deployment.
export async function checkBoosterEthPayment(
  client: Pick<PublicClient, "readContract">,
  adapter: Address,
  engine: Address,
  ypal: Address
) {
  const keys = [
    "engine",
    "ypal",
    "pmon",
    "proto",
    "weth",
    "v2Router",
    "v3Router"
  ] as const;
  const expected = { ...baseEthRoutes, engine, ypal };
  const [version, role, ...values] = await Promise.all([
    client.readContract({
      address: adapter,
      abi: boosterEthAbi,
      functionName: "VERSION"
    }),
    client.readContract({
      address: engine,
      abi: roleAbi,
      functionName: "PAYMENT_ADAPTER_ROLE"
    }),
    ...keys.map((key) =>
      client.readContract({
        address: adapter,
        abi: boosterEthAbi,
        functionName: key
      })
    )
  ]);
  if (
    version !== 1n ||
    keys.some(
      (key, i) => values[i].toLowerCase() !== expected[key].toLowerCase()
    ) ||
    !(await client.readContract({
      address: engine,
      abi: roleAbi,
      functionName: "hasRole",
      args: [role, adapter]
    }))
  )
    throw new Error("ETH pack payments are not activated for this collection.");
}

export function capEthPackQuote(
  route: EthPackRoute,
  price: bigint
): EthPackQuote {
  if (price <= 0n) throw new Error("This route has no available quote.");
  // 0.5% maximum price movement, rounded up to the next wei.
  return { route, price, maximum: (price * 10050n + 9999n) / 10000n };
}

export async function quoteEthPackRoutes(
  client: Pick<PublicClient, "readContract" | "simulateContract">,
  amount: bigint
) {
  const results = await Promise.allSettled([
    client
      .simulateContract({
        address: baseEthRoutes.quoter,
        abi: quoterAbi,
        functionName: "quoteExactOutputSingle",
        args: [
          {
            tokenIn: baseEthRoutes.weth,
            tokenOut: baseEthRoutes.pmon,
            amount,
            fee: 10_000,
            sqrtPriceLimitX96: 0n
          }
        ]
      })
      .then(({ result }) => capEthPackQuote(0, result[0])),
    client
      .readContract({
        address: baseEthRoutes.v2Router,
        abi: v2Abi,
        functionName: "getAmountsIn",
        args: [amount, [baseEthRoutes.weth, baseEthRoutes.proto]]
      })
      .then((result) => capEthPackQuote(1, result[0]))
  ]);
  const quotes = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  if (!quotes.length)
    throw new Error(
      "ETH purchase quotes are unavailable. Try again or pay with YPAL."
    );
  return quotes;
}

export function ethPackPurchaseData(
  packTypeId: bigint,
  quantity: number,
  quote: EthPackQuote,
  maxVrfPrice: bigint,
  deadline: bigint
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10)
    throw new Error("Choose between 1 and 10 packs.");
  return encodeFunctionData({
    abi: boosterEthAbi,
    functionName: "openPacks",
    args: [
      packTypeId,
      quantity,
      quote.route,
      quote.maximum,
      maxVrfPrice,
      deadline
    ]
  });
}
