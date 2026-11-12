import {
  cre,
  Runner,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  logTriggerConfig,
  LAST_FINALIZED_BLOCK_NUMBER,
  protoBigIntToBigint,
  blockNumber,
  prepareReportRequest,
  TxStatus,
  type Runtime,
  type EVMLog
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  toEventSelector,
  zeroAddress,
  type Hex
} from "viem";
import { z } from "zod";
import { recoveryIndices, settlementReport } from "./planner.ts";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((value) => value !== zeroAddress)
  .transform((value) => value as `0x${string}`);
const configSchema = z.object({
  chainId: z.union([z.literal(8453), z.literal(84532)]),
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
  competition: address,
  receiver: address,
  rulesHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .transform((value) => value as Hex),
  schedule: z.string().default("0 * * * * *"),
  gasLimit: z.string().regex(/^\d+$/).default("1200000")
});
type Config = z.infer<typeof configSchema>;
const abi = parseAbi([
  "function RULES_HASH() view returns(bytes32)",
  "function pendingCount() view returns(uint256)",
  "function pendingAt(uint256) view returns(uint256)",
  "function ready(uint256) view returns(bool)",
  "function getBatch(uint256) view returns((bytes32 rubric,uint16 funded,uint16 completed,bool settled,uint256[3] leaders,bool[3] paid))"
]);

function evmFor(config: Config) {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: config.isTestnet
  });
  const expected =
    config.chainId === 8453
      ? "ethereum-mainnet-base-1"
      : "ethereum-testnet-sepolia-base-1";
  if (
    !network ||
    config.chainSelectorName !== expected ||
    config.isTestnet !== (config.chainId === 84532)
  )
    throw new Error("Base network configuration mismatch.");
  return new cre.capabilities.EVMClient(network.chainSelector.selector);
}

function reader(runtime: Runtime<Config>, evm: ReturnType<typeof evmFor>) {
  const header = evm
    .headerByNumber(runtime, { blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
    .result();
  if (!header.header?.blockNumber) throw new Error("Missing finalized block.");
  const at = blockNumber(protoBigIntToBigint(header.header.blockNumber));
  return (data: Hex) =>
    bytesToHex(
      evm
        .callContract(runtime, {
          call: encodeCallMsg({
            from: zeroAddress,
            to: runtime.config.competition,
            data
          }),
          blockNumber: at
        })
        .result().data
    );
}

function submit(
  runtime: Runtime<Config>,
  evm: ReturnType<typeof evmFor>,
  read: ReturnType<typeof reader>,
  batchId: bigint
) {
  const rules = decodeFunctionResult({
    abi,
    functionName: "RULES_HASH",
    data: read(encodeFunctionData({ abi, functionName: "RULES_HASH" }))
  });
  if (rules !== runtime.config.rulesHash)
    throw new Error("Competition rules mismatch.");
  const ready = decodeFunctionResult({
    abi,
    functionName: "ready",
    data: read(
      encodeFunctionData({ abi, functionName: "ready", args: [batchId] })
    )
  });
  if (!ready) return;
  const batch = decodeFunctionResult({
    abi,
    functionName: "getBatch",
    data: read(
      encodeFunctionData({ abi, functionName: "getBatch", args: [batchId] })
    )
  });
  if (batch.paid.every(Boolean)) return;
  if (batch.leaders.some((id) => id === 0n))
    throw new Error("Missing onchain winners.");
  runtime.log(`Competition ${batchId}: entries ${batch.leaders.join(", ")}`);
  const payload = settlementReport(
    runtime.config.chainId,
    runtime.config.competition,
    rules,
    batchId
  );
  const report = runtime.report(prepareReportRequest(payload)).result();
  const result = evm
    .writeReport(runtime, {
      receiver: runtime.config.receiver,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit }
    })
    .result();
  if (result.txStatus !== TxStatus.SUCCESS)
    throw new Error("Competition settlement transaction failed.");
}

const onReady = (runtime: Runtime<Config>, log: EVMLog) => {
  if (
    bytesToHex(log.address).toLowerCase() !==
      runtime.config.competition.toLowerCase() ||
    log.topics.length !== 2
  )
    throw new Error("Invalid competition log.");
  const evm = evmFor(runtime.config);
  submit(runtime, evm, reader(runtime, evm), BigInt(bytesToHex(log.topics[1])));
  return "competition-ready";
};

const onRecovery = (runtime: Runtime<Config>) => {
  const evm = evmFor(runtime.config);
  const read = reader(runtime, evm);
  const count = decodeFunctionResult({
    abi,
    functionName: "pendingCount",
    data: read(encodeFunctionData({ abi, functionName: "pendingCount" }))
  });
  const indices = recoveryIndices(
    count,
    BigInt(Math.floor(runtime.now().getTime() / 60_000))
  );
  const batches = indices.map((index) =>
    decodeFunctionResult({
      abi,
      functionName: "pendingAt",
      data: read(
        encodeFunctionData({ abi, functionName: "pendingAt", args: [index] })
      )
    })
  );
  for (const id of batches) {
    try {
      submit(runtime, evm, read, id);
    } catch {
      runtime.log(`Competition ${id}: retry on a later recovery run`);
    }
  }
  return "recovery-complete";
};

export async function main() {
  const runner = await Runner.newRunner<Config, z.input<typeof configSchema>>({
    configSchema
  });
  await runner.run((config) => {
    const evm = evmFor(config);
    return [
      cre.handler(
        evm.logTrigger(
          logTriggerConfig({
            addresses: [config.competition],
            topics: [[toEventSelector("CompetitionReady(uint256)")]],
            confidence: "FINALIZED"
          })
        ),
        onReady
      ),
      cre.handler(
        new cre.capabilities.CronCapability().trigger({
          schedule: config.schedule
        }),
        onRecovery
      )
    ];
  });
}
