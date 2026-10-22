import {
  createWalletClient,
  custom,
  formatEther,
  type EIP1193Provider,
  type Hex
} from "viem";
import { base } from "viem/chains";
import {
  BOOSTER_DEPLOYER,
  deploymentClient,
  readBoosterDeployment,
  validateBoosterDeployment,
  verifyBoosterDeployment,
  type BoosterDeployment
} from "../../src/lib/boosterDeployment";

declare const PLAN_SHA256: string;
const get = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing ${id}`);
  return element as T;
};
const status = get("status"),
  error = get("error"),
  summary = get("summary");
const connect = get<HTMLButtonElement>("connect"),
  deploy = get<HTMLButtonElement>("deploy"),
  refresh = get<HTMLButtonElement>("refresh");
const client = deploymentClient();
const providers = new Map<EIP1193Provider, string>();
const select = get<HTMLSelectElement>("wallets");
let provider: EIP1193Provider | undefined;
let plan: BoosterDeployment;
let busy = false;
let connected = false;
let state: Awaited<ReturnType<typeof readBoosterDeployment>> | undefined;
let verified = false;
const storageKey = `yunipals:deployment:8453:${BOOSTER_DEPLOYER.toLowerCase()}:${PLAN_SHA256}`;
const hashes: Record<string, Hex> = (() => {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    return {};
  }
})();
function message(value: string) {
  status.textContent = value;
}
function fail(value: unknown) {
  error.hidden = false;
  const short =
    typeof value === "object" &&
    value !== null &&
    "shortMessage" in value &&
    typeof value.shortMessage === "string"
      ? value.shortMessage
      : value instanceof Error
        ? value.message
        : "The wallet request failed. Try refreshing the status.";
  error.textContent = short.split("\n")[0].slice(0, 500);
}
function clearError() {
  error.hidden = true;
  error.textContent = "";
}
function render() {
  connect.disabled = busy || !plan;
  refresh.disabled = busy || !plan;
  select.disabled = busy;
  deploy.hidden = Boolean(state?.completed === 6);
  deploy.disabled =
    busy || !connected || !state || state.pending || state.balance === 0n;
  if (state) {
    get("balance").textContent =
      `${Number(formatEther(state.balance)).toFixed(6)} ETH`;
    get("progress").textContent = `${state.completed} of 6 confirmed`;
    deploy.textContent = busy
      ? "Waiting for confirmation…"
      : `Deploy ${state.completed + 1} of 6`;
  }
  const list = get("transactions");
  list.replaceChildren();
  for (const [i, tx] of (plan?.transactions ?? []).entries()) {
    const item = document.createElement("li");
    item.className =
      i < (state?.completed ?? 0)
        ? "confirmed"
        : i === state?.completed
          ? "next"
          : "";
    const title = document.createElement("strong");
    title.textContent = tx.label;
    const address = document.createElement("a");
    address.href = `https://basescan.org/address/${tx.predictedAddress}`;
    address.target = "_blank";
    address.rel = "noopener noreferrer";
    address.textContent = tx.predictedAddress;
    const label = document.createElement("span");
    label.className = "step-status";
    label.textContent =
      i < (state?.completed ?? 0)
        ? "Confirmed · code verified"
        : i === state?.completed
          ? "Next transaction"
          : "Waiting";
    item.append(title, address, label);
    list.append(item);
  }
  get("complete").hidden = !verified;
}
function remember(index: number, hash: Hex) {
  hashes[String(index)] = hash;
  try {
    localStorage.setItem(storageKey, JSON.stringify(hashes));
  } catch {
    /* Chain state also supports reload recovery. */
  }
}
async function loadState() {
  state = await readBoosterDeployment(plan, client);
  if (state.completed === 6) {
    const result = await verifyBoosterDeployment(plan, client);
    verified = result.verified;
    message(
      "All contracts are deployed. Admin permissions and dependencies are verified."
    );
  } else
    message(
      state.pending
        ? "A wallet transaction is pending. Refresh after it confirms."
        : connected
          ? `Ready for ${plan.transactions[state.completed].label}. Your wallet will show the network fee.`
          : "Connect the funded wallet to deploy. Each transaction needs a separate confirmation."
    );
  render();
}
async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  clearError();
  render();
  try {
    await action();
  } catch (value) {
    fail(value);
  } finally {
    busy = false;
    render();
  }
}
function register(candidate: EIP1193Provider, name: string) {
  if (providers.has(candidate)) return;
  providers.set(candidate, name);
  const option = document.createElement("option");
  option.value = String(providers.size - 1);
  option.textContent = name;
  select.append(option);
}
window.addEventListener("eip6963:announceProvider", ((
  event: CustomEvent<{ provider: EIP1193Provider; info: { name: string } }>
) => {
  if (typeof event.detail?.provider?.request === "function")
    register(event.detail.provider, event.detail.info.name);
}) as EventListener);
window.dispatchEvent(new Event("eip6963:requestProvider"));
const injected = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
if (injected) register(injected, "Browser wallet");
select.addEventListener("change", () => {
  connected = false;
  provider = undefined;
  connect.textContent = "Connect wallet";
  render();
});
connect.addEventListener(
  "click",
  () =>
    void run(async () => {
      connected = false;
      provider = [...providers.keys()][Number(select.value)];
      if (!provider)
        throw new Error(
          "Open this page in Chrome, Firefox or your wallet browser with MetaMask or Rabby installed. The Codex browser may not have a wallet extension."
        );
      const accounts = await provider.request({
        method: "eth_requestAccounts"
      });
      if (accounts[0]?.toLowerCase() !== BOOSTER_DEPLOYER.toLowerCase())
        throw new Error(
          `Select ${BOOSTER_DEPLOYER} in your wallet, then connect again.`
        );
      if ((await provider.request({ method: "eth_chainId" })) !== "0x2105")
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x2105" }]
        });
      if ((await provider.request({ method: "eth_chainId" })) !== "0x2105")
        throw new Error("Select Base mainnet in your wallet.");
      connected = true;
      connect.textContent = "Wallet connected";
      await loadState();
    })
);
deploy.addEventListener(
  "click",
  () =>
    void run(async () => {
      if (!provider || !connected)
        throw new Error("Connect the funded wallet first.");
      const accounts = await provider.request({ method: "eth_accounts" });
      if (
        accounts[0]?.toLowerCase() !== BOOSTER_DEPLOYER.toLowerCase() ||
        (await provider.request({ method: "eth_chainId" })) !== "0x2105"
      ) {
        connected = false;
        throw new Error(
          "Wallet account or network changed. Reconnect the funded wallet on Base."
        );
      }
      await loadState();
      if (!state || state.completed === 6) return;
      if (state.pending)
        throw new Error(
          "A transaction is already pending. Wait and refresh before deploying again."
        );
      if (state.balance === 0n)
        throw new Error("The wallet needs Base ETH for transaction fees.");
      const index = state.completed,
        tx = plan.transactions[index];
      message(
        `Confirm ${tx.label} in your wallet. This transaction transfers 0 ETH; only network gas is spent.`
      );
      const wallet = createWalletClient({
        account: BOOSTER_DEPLOYER,
        chain: base,
        transport: custom(provider)
      });
      const hash = await wallet.sendTransaction({
        data: tx.unsigned.data,
        value: 0n,
        nonce: Number(BigInt(tx.unsigned.nonce))
      });
      remember(index, hash);
      message(`Waiting for ${tx.label} to confirm…`);
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 120000,
        onReplaced: (replacement) => {
          if (replacement.reason === "cancelled")
            throw new Error(
              "Deployment was cancelled. Refresh to inspect the wallet nonce."
            );
          remember(index, replacement.transaction.hash);
        }
      });
      if (
        receipt.status !== "success" ||
        receipt.contractAddress?.toLowerCase() !==
          tx.predictedAddress.toLowerCase()
      )
        throw new Error(
          "Transaction did not create the expected contract. Ask Codex to inspect it before continuing."
        );
      await loadState();
    })
);
refresh.addEventListener("click", () => void run(loadState));
get("download").addEventListener("click", () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          chainId: 8453,
          admin: BOOSTER_DEPLOYER,
          deploymentPackageSha256: PLAN_SHA256,
          auditPackageSha256:
            "32fae8ad6b15d52c92cdeb7fa18e4452e762ca367a6dd29c427bb65ac3f06756",
          contracts: plan.contracts,
          verified,
          confirmed: state?.completed,
          observedBlock: state?.blockNumber.toString(),
          liveVrfTestCompleted: false,
          transactionHashes: hashes
        },
        null,
        2
      )
    ],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = "yunipals-mainnet-deployment.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
(async () => {
  try {
    const response = await fetch("./deployment.json", { cache: "no-store" });
    if (!response.ok)
      throw new Error("Deployment package could not be loaded.");
    const bytes = await response.arrayBuffer();
    const sha = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    if (sha !== PLAN_SHA256)
      throw new Error(
        "The deployment package changed. Reload this page before connecting."
      );
    plan = JSON.parse(new TextDecoder().decode(bytes)) as BoosterDeployment;
    validateBoosterDeployment(plan);
    summary.textContent =
      "Six contract deployments on Base. You keep upgrade, configuration and pause permissions. No pack sales are activated here.";
    await loadState();
  } catch (value) {
    fail(value);
    render();
  }
})();
