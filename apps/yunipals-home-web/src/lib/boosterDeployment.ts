import {
  createPublicClient,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import { base } from "viem/chains";

export const BOOSTER_DEPLOYER = "0xB3883Cd96d72B08b8226452305A28D65974a3727";
export type BoosterDeployment = {
  schemaVersion: number;
  chainId: number;
  admin: Address;
  deployer: Address;
  expectedStartingNonce: number;
  preparedAt: string;
  wrapper: Address;
  contracts: { registry: Address; monsters: Address; engine: Address };
  transactions: {
    label: string;
    predictedAddress: Address;
    bytecodeKeccak256: Hex;
    runtimeCodeKeccak256: Hex;
    unsigned: {
      from: Address;
      chainId: Hex;
      nonce: Hex;
      value: Hex;
      data: Hex;
    };
  }[];
};
export const deploymentClient = () =>
  createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org", {
      timeout: 20000,
      retryCount: 1
    })
  });
export function validateBoosterDeployment(plan: BoosterDeployment) {
  if (
    plan.schemaVersion !== 1 ||
    plan.chainId !== 8453 ||
    plan.admin.toLowerCase() !== BOOSTER_DEPLOYER.toLowerCase() ||
    plan.deployer.toLowerCase() !== BOOSTER_DEPLOYER.toLowerCase() ||
    plan.transactions.length !== 6 ||
    !Number.isSafeInteger(plan.expectedStartingNonce) ||
    plan.expectedStartingNonce < 0
  )
    throw new Error(
      "This deployment package does not match the approved wallet and Base network."
    );
  plan.transactions.forEach((tx, i) => {
    const nonce = plan.expectedStartingNonce + i;
    if (
      tx.unsigned.from.toLowerCase() !== BOOSTER_DEPLOYER.toLowerCase() ||
      tx.unsigned.chainId !== "0x2105" ||
      tx.unsigned.value !== "0x0" ||
      "to" in tx.unsigned ||
      BigInt(tx.unsigned.nonce) !== BigInt(nonce) ||
      keccak256(tx.unsigned.data) !== tx.bytecodeKeccak256 ||
      !/^0x[0-9a-f]{64}$/i.test(tx.runtimeCodeKeccak256) ||
      getContractAddress({
        from: BOOSTER_DEPLOYER,
        nonce: BigInt(nonce)
      }).toLowerCase() !== tx.predictedAddress.toLowerCase()
    )
      throw new Error(
        `Deployment ${i + 1} failed its address or bytecode check.`
      );
  });
  for (const [key, index] of [
    ["registry", 1],
    ["monsters", 3],
    ["engine", 5]
  ] as const)
    if (
      plan.contracts[key].toLowerCase() !==
      plan.transactions[index].predictedAddress.toLowerCase()
    )
      throw new Error("Proxy addresses do not match the deployment sequence.");
}
export async function readBoosterDeployment(
  plan: BoosterDeployment,
  client = deploymentClient()
) {
  validateBoosterDeployment(plan);
  if ((await client.getChainId()) !== 8453)
    throw new Error("Read connection is not Base mainnet.");
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [nonce, pendingNonce, balance, ...codes] = await Promise.all([
    client.getTransactionCount({ address: plan.deployer, blockNumber }),
    client.getTransactionCount({ address: plan.deployer, blockTag: "pending" }),
    client.getBalance({ address: plan.deployer, blockNumber }),
    ...plan.transactions.map((tx) =>
      client.getCode({ address: tx.predictedAddress, blockNumber })
    )
  ]);
  let completed = 0;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code && code !== "0x") {
      if (
        completed !== i ||
        keccak256(code) !== plan.transactions[i].runtimeCodeKeccak256
      )
        throw new Error(
          "Unexpected deployed code. Stop and refresh the package with Codex."
        );
      completed++;
    }
  }
  if (completed < 6 && nonce !== plan.expectedStartingNonce + completed)
    throw new Error(
      "The wallet nonce changed outside this deployment. Ask Codex to refresh the remaining transactions."
    );
  return {
    completed,
    nonce,
    pendingNonce,
    balance,
    blockNumber,
    pending: pendingNonce > nonce
  };
}
export async function verifyBoosterDeployment(
  plan: BoosterDeployment,
  client = deploymentClient()
) {
  const state = await readBoosterDeployment(plan, client);
  if (state.completed !== 6)
    throw new Error("All six deployments must confirm first.");
  const adminAbi = parseAbi([
    "function hasRole(bytes32,address) view returns (bool)"
  ]);
  const roles = [
    `0x${"00".repeat(32)}`,
    keccak256(new TextEncoder().encode("CONFIG_ROLE")),
    keccak256(new TextEncoder().encode("PAUSER_ROLE")),
    keccak256(new TextEncoder().encode("UPGRADER_ROLE"))
  ] as Hex[];
  const addressAbi = parseAbi([
    "function registry() view returns (address)",
    "function monsters() view returns (address)",
    "function wrapper() view returns (address)"
  ]);
  const results = await Promise.all([
    ...Object.values(plan.contracts).flatMap((address) =>
      roles.map((role) =>
        client.readContract({
          address,
          abi: adminAbi,
          functionName: "hasRole",
          args: [role, plan.admin]
        })
      )
    ),
    client.readContract({
      address: plan.contracts.monsters,
      abi: addressAbi,
      functionName: "registry"
    }),
    client.readContract({
      address: plan.contracts.engine,
      abi: addressAbi,
      functionName: "registry"
    }),
    client.readContract({
      address: plan.contracts.engine,
      abi: addressAbi,
      functionName: "monsters"
    }),
    client.readContract({
      address: plan.contracts.engine,
      abi: addressAbi,
      functionName: "wrapper"
    }),
    client.readContract({
      address: plan.contracts.registry,
      abi: parseAbi(["function typeCount() view returns (uint256)"]),
      functionName: "typeCount"
    })
  ]);
  if (results.slice(0, 12).some((value) => value !== true))
    throw new Error(
      "Deployed admin permissions do not match the approved wallet."
    );
  const expected = [
    plan.contracts.registry,
    plan.contracts.registry,
    plan.contracts.monsters,
    plan.wrapper
  ];
  if (
    expected.some(
      (address, i) =>
        String(results[12 + i]).toLowerCase() !== address.toLowerCase()
    )
  )
    throw new Error("A deployed dependency does not match the package.");
  return { ...state, typeCount: String(results[16]), verified: true };
}
