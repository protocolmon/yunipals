import {
  createPublicClient,
  http,
  parseAbi,
  zeroHash,
  type Address
} from "viem";

type GasRules = {
  baseGas: number;
  perMintGas: number;
  maxBatch: number;
  confirmations: number;
};

type VrfLimits = {
  configured: boolean;
  disabled: boolean;
  wrapperGasOverhead: number;
  maxNumWords: number;
  keyHash: string;
  maxGasLimit: number;
  minimumConfirmations: number;
  maximumConfirmations: number;
};

export function assertBoosterVrfLimits(rules: GasRules, limits: VrfLimits) {
  if (!limits.configured || limits.disabled)
    throw new Error("Chainlink wrapper is not accepting requests.");
  if (limits.maxNumWords < 1 || limits.keyHash === zeroHash)
    throw new Error(
      "Chainlink wrapper has no usable randomness configuration."
    );
  if (
    rules.confirmations < limits.minimumConfirmations ||
    rules.confirmations > limits.maximumConfirmations
  )
    throw new Error("Pack confirmations exceed the live coordinator bounds.");
  const callbackGas = rules.baseGas + rules.perMintGas * rules.maxBatch;
  // VRFV2PlusWrapper adds both before calling the coordinator; a fee quote
  // alone does not validate its maximum callback gas limit.
  const eip150Overhead = Math.floor(callbackGas / 63) + 1;
  const coordinatorGas =
    callbackGas + eip150Overhead + limits.wrapperGasOverhead;
  if (coordinatorGas > limits.maxGasLimit)
    throw new Error(
      "Pack callback plus wrapper overhead exceeds the live coordinator gas limit."
    );
  return {
    callbackGas,
    eip150Overhead,
    coordinatorGas,
    remainingGas: limits.maxGasLimit - coordinatorGas
  };
}

const wrapperAbi = parseAbi([
  "function s_vrfCoordinator() view returns (address)",
  "function s_configured() view returns (bool)",
  "function s_disabled() view returns (bool)",
  "function getConfig() view returns (int256,uint32,uint32,uint32,uint32,uint32,uint32,uint16,uint8,uint8,bytes32,uint8)"
]);
const coordinatorAbi = parseAbi([
  "function s_config() view returns (uint16,uint32,bool,uint32,uint32,uint32,uint32,uint8,uint8)",
  "function MAX_REQUEST_CONFIRMATIONS() view returns (uint16)",
  "function BLOCKHASH_STORE() view returns (address)"
]);

/** Read-only, pinned to one block. Re-run immediately before activation. */
export async function checkBoosterVrfConfig(
  input: GasRules & {
    rpc: string;
    chainId: number;
    wrapper?: Address;
    engine?: Address;
  }
) {
  const client = createPublicClient({
    transport: http(input.rpc, { timeout: 15000, retryCount: 1 })
  });
  if ((await client.getChainId()) !== input.chainId)
    throw new Error("VRF preflight RPC chain mismatch.");
  const blockNumber = await client.getBlockNumber();
  const wrapper = input.engine
    ? await client.readContract({
        address: input.engine,
        abi: parseAbi(["function wrapper() view returns (address)"]),
        functionName: "wrapper",
        blockNumber
      })
    : input.wrapper;
  if (!wrapper) throw new Error("VRF preflight requires an engine or wrapper.");
  const [coordinator, configured, disabled, config] = await Promise.all([
    client.readContract({
      address: wrapper,
      abi: wrapperAbi,
      functionName: "s_vrfCoordinator",
      blockNumber
    }),
    client.readContract({
      address: wrapper,
      abi: wrapperAbi,
      functionName: "s_configured",
      blockNumber
    }),
    client.readContract({
      address: wrapper,
      abi: wrapperAbi,
      functionName: "s_disabled",
      blockNumber
    }),
    client.readContract({
      address: wrapper,
      abi: wrapperAbi,
      functionName: "getConfig",
      blockNumber
    })
  ]);
  const [coordinatorConfig, maximumConfirmations, blockhashStore] =
    await Promise.all([
      client.readContract({
        address: coordinator,
        abi: coordinatorAbi,
        functionName: "s_config",
        blockNumber
      }),
      client.readContract({
        address: coordinator,
        abi: coordinatorAbi,
        functionName: "MAX_REQUEST_CONFIRMATIONS",
        blockNumber
      }),
      client.readContract({
        address: coordinator,
        abi: coordinatorAbi,
        functionName: "BLOCKHASH_STORE",
        blockNumber
      })
    ]);
  const storeCode = await client.getCode({
    address: blockhashStore,
    blockNumber
  });
  if (!storeCode || storeCode === "0x")
    throw new Error(
      "Coordinator blockhash store is unavailable for original-proof recovery."
    );
  const limits = {
    configured,
    disabled,
    wrapperGasOverhead: config[4],
    maxNumWords: config[11],
    keyHash: config[10],
    minimumConfirmations: coordinatorConfig[0],
    maxGasLimit: coordinatorConfig[1],
    maximumConfirmations
  };
  return {
    blockNumber: blockNumber.toString(),
    chainId: input.chainId,
    wrapper,
    coordinator,
    blockhashStore,
    ...limits,
    ...assertBoosterVrfLimits(input, limits)
  };
}
