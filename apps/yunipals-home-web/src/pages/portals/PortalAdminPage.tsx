import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import {
  encodeFunctionData,
  isAddress,
  keccak256,
  parseEventLogs,
  parseUnits,
  toHex,
  type Address,
  type ContractFunctionArgs
} from "viem";
import { z } from "zod";
import {
  portalCollectionAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";
import { fetchPortalStatus, portalPrice, portalRequest } from "@/lib/portals";
import { usePortals } from "@/hooks/usePortals";
import { boosterButtonClass } from "@/pages/boosters/BoosterActionButton";
import { cn } from "@/lib/utils";
import { preparePortalRandomness } from "@/lib/portalRandomness";
import { PortalAirdropLink } from "./PortalArtwork";

const inputClass =
  "mt-2 w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm focus-visible:outline-grape";
const bps = z.number().int().min(0).max(10000),
  weight = z.number().int().min(0).max(65535);
const oddsSchema = z
  .object({
    originalBps: bps,
    glitterBps: bps,
    diamondBps: bps,
    length1Bps: bps,
    length10Bps: bps,
    length100Bps: bps,
    colorWeights: z.tuple([weight, weight, weight, weight, weight, weight]),
    typeWeights: z.tuple([
      weight,
      weight,
      weight,
      weight,
      weight,
      weight,
      weight,
      weight,
      weight,
      weight,
      weight
    ])
  })
  .strict();
const defaultOdds = {
  originalBps: 1000,
  glitterBps: 1000,
  diamondBps: 1000,
  length1Bps: 500,
  length10Bps: 2000,
  length100Bps: 7500,
  colorWeights: [1, 1, 1, 1, 1, 1],
  typeWeights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
};

const mintProgressSchema = z.object({
  requestId: z.string(),
  kindId: z.string(),
  quantity: z.number().int(),
  delivered: z.number().int(),
  ready: z.boolean(),
  complete: z.boolean(),
  indexing: z.boolean()
});

export function PortalAdminPage() {
  const query = useQuery({
    queryKey: ["portals", "active"],
    queryFn: () => fetchPortalStatus(),
    refetchInterval: 5000
  });
  const status = query.data?.enabled ? query.data : null;
  const actions = usePortals(status);
  const { openConnectModal } = useConnectModal();
  const switcher = useSwitchChain();
  const [kind, setKind] = useState("0"),
    [name, setName] = useState("Rainbow Portal"),
    [image, setImage] = useState(""),
    [hash, setHash] = useState(""),
    [cap, setCap] = useState("1000"),
    [odds, setOdds] = useState(JSON.stringify(defaultOdds, null, 2));
  const [mintKind, setMintKind] = useState("1"),
    [recipients, setRecipients] = useState(""),
    [mintRequest, setMintRequest] = useState("");
  const [feeKind, setFeeKind] = useState("1"),
    [aiFee, setAiFee] = useState("0.245"),
    [portalFee, setPortalFee] = useState("0.245"),
    [aiWallet, setAiWallet] = useState("");
  const [localError, setLocalError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ["portals", "mint-requests", actions.address],
    enabled: !!actions.address,
    queryFn: async ({ signal }) =>
      z.object({ requests: z.array(mintProgressSchema) }).parse(
        await portalRequest(`/mint-requests?owner=${actions.address}`, {
          signal
        })
      ),
    refetchInterval: 5000
  });
  const mintProgress = useQuery({
    queryKey: ["portals", "mint-request", mintRequest],
    enabled: /^[1-9][0-9]*$/.test(mintRequest),
    queryFn: async ({ signal }) =>
      mintProgressSchema.parse(
        await portalRequest(`/mint-requests/${mintRequest}`, { signal })
      ),
    refetchInterval: 5000
  });
  const roles = useQuery({
    queryKey: ["portals", "roles", actions.address, status?.deployment.grading],
    enabled: Boolean(actions.address && actions.client && status),
    queryFn: async () => {
      if (!actions.address || !actions.client || !status)
        return { mint: false, fees: false };
      const role = keccak256(toHex("CONFIG_ROLE"));
      const [mint, fees] = await Promise.all([
        actions.client.readContract({
          address: status.deployment.collection as Address,
          abi: portalCollectionAbi,
          functionName: "hasRole",
          args: [role, actions.address]
        }),
        actions.client.readContract({
          address: status.deployment.grading as Address,
          abi: portalGradingAbi,
          functionName: "hasRole",
          args: [role, actions.address]
        })
      ]);
      return { mint, fees };
    }
  });
  async function form(event: FormEvent, task: () => Promise<void>) {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Check the portal settings."
      );
    }
  }
  async function createKind() {
    if (!status) return;
    if (
      !/^\d+$/.test(kind) ||
      !/^\d+$/.test(cap) ||
      !/^0x[0-9a-fA-F]{64}$/.test(hash)
    )
      throw new Error(
        "Enter a kind number, a cap and the artwork's 32-byte hash."
      );
    const parsed = oddsSchema.parse(JSON.parse(odds));
    if (parsed.length1Bps + parsed.length10Bps + parsed.length100Bps !== 10000)
      throw new Error(
        "Sequence probabilities must add up to 10,000 basis points."
      );
    const definition: ContractFunctionArgs<
      typeof portalCollectionAbi,
      "nonpayable",
      "configureKind"
    >[1] = {
      name,
      imageURI: image,
      artworkHash: hash as `0x${string}`,
      cap: Number(cap),
      odds: parsed
    };
    const receipt = await actions.send(
      status.deployment.collection as Address,
      encodeFunctionData({
        abi: portalCollectionAbi,
        functionName: "configureKind",
        args: [BigInt(kind), definition]
      })
    );
    if (receipt) {
      const event = parseEventLogs({
        abi: portalCollectionAbi,
        logs: receipt.logs,
        eventName: "KindConfigured"
      })[0];
      setNotice(`Portal kind ${event?.args.kindId?.toString() ?? ""} saved.`);
    }
  }
  async function mint() {
    if (!status || !actions.client) return;
    const list = recipients.split(/[\s,]+/).filter(Boolean);
    if (!list.length || list.length > 100 || !list.every((a) => isAddress(a)))
      throw new Error("Enter 1–100 recipient wallet addresses.");
    const { maximum, fees } = await preparePortalRandomness(
      actions.client,
      status.deployment.collection as Address
    );
    const receipt = await actions.send(
      status.deployment.collection as Address,
      encodeFunctionData({
        abi: portalCollectionAbi,
        functionName: "mintBatch",
        args: [BigInt(mintKind), list as Address[], maximum]
      }),
      maximum,
      undefined,
      fees
    );
    if (receipt) {
      const event = parseEventLogs({
        abi: portalCollectionAbi,
        logs: receipt.logs,
        eventName: "MintCommitted"
      })[0];
      if (event?.args.requestId !== undefined)
        setMintRequest(event.args.requestId.toString());
      setNotice(
        "Airdrop committed. Finish revealing after randomness arrives."
      );
    }
  }
  async function reveal() {
    if (!status) return;
    if (!mintProgress.data?.ready || mintProgress.data.complete)
      throw new Error(
        "Wait for indexed randomness and delivery status before continuing."
      );
    const receipt = await actions.send(
      status.deployment.collection as Address,
      encodeFunctionData({
        abi: portalCollectionAbi,
        functionName: "finishMint",
        args: [BigInt(mintRequest), 32]
      })
    );
    if (receipt)
      setNotice(
        "Up to 32 portals revealed. Repeat if this batch has more recipients."
      );
  }
  async function updateFees() {
    if (!status) return;
    if (
      !isAddress(aiWallet) ||
      !/^\d+(?:\.\d{1,6})?$/.test(aiFee) ||
      !/^\d+(?:\.\d{1,6})?$/.test(portalFee)
    )
      throw new Error(
        "Enter valid recipient wallets and USDC amounts with at most six decimals."
      );
    const receipt = await actions.send(
      status.deployment.grading as Address,
      encodeFunctionData({
        abi: portalGradingAbi,
        functionName: "setPaymentPolicy",
        args: [
          BigInt(feeKind),
          parseUnits(aiFee, 6),
          parseUnits(portalFee, 6),
          aiWallet
        ]
      })
    );
    if (receipt) setNotice("Pricing updated for future submissions.");
  }
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl">Portal administration</h1>
      <p className="mt-3 text-muted">
        Create portal kinds, airdrop NFTs and set the fee split.
      </p>
      <div className="mt-5">
        <PortalAirdropLink />
      </div>
      {status && (
        <div className="mt-5 rounded-card border border-line p-5 text-sm">
          <p>
            {status.supply.live} live · {status.supply.minted} minted ·{" "}
            {status.supply.burned} burned
          </p>
          <p className="mt-2">
            Escrow: {portalPrice(status.escrow.reserves)} USDC · Portal
            balances: {portalPrice(status.escrow.liability)} USDC
          </p>
          <p className="mt-2 font-semibold">
            Portal destination: accumulates on each portal NFT
          </p>
        </div>
      )}
      {!actions.address ? (
        <button
          className={cn(boosterButtonClass, "mt-6")}
          onClick={() => openConnectModal?.()}
        >
          Connect admin wallet
        </button>
      ) : status && actions.chainId !== status.deployment.chainId ? (
        <button
          className={cn(boosterButtonClass, "mt-6")}
          onClick={() =>
            switcher.switchChain({ chainId: status.deployment.chainId })
          }
        >
          Switch network
        </button>
      ) : null}
      {!status ? (
        <p className="mt-6 text-muted">
          The portal deployment is being prepared.
        </p>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <form
            onSubmit={(event) => void form(event, createKind)}
            className="rounded-card border border-line p-6"
          >
            <h2 className="font-display text-xl">Portal kind</h2>
            <p className="mt-2 text-sm text-muted">
              Use a finished Yunipals TCG card with the branded frame and the
              portal nameplate. Every NFT of this kind shares that card image.
              Artwork and chances freeze with the first mint request.
            </p>
            {[
              ["Kind number (0 creates a new kind)", kind, setKind],
              ["Name", name, setName],
              ["TCG card image URL", image, setImage],
              ["Card image SHA-256 hash", hash, setHash],
              ["Lifetime cap (up to 1,000)", cap, setCap]
            ].map(([label, value, setter]) => (
              <label
                key={String(label)}
                className="mt-4 block text-sm font-bold"
              >
                {String(label)}
                <input
                  className={inputClass}
                  value={String(value)}
                  onChange={(event) =>
                    (setter as (v: string) => void)(event.target.value)
                  }
                  required
                />
              </label>
            ))}
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-bold">
                Chance settings
              </summary>
              <p className="mt-2 text-xs text-muted">
                1,000 basis points = 10%. Type and color entries are relative
                weights.
              </p>
              <textarea
                className={cn(inputClass, "font-mono")}
                rows={12}
                value={odds}
                onChange={(event) => setOdds(event.target.value)}
              />
            </details>
            <button
              className={cn(boosterButtonClass, "mt-5")}
              disabled={actions.busy || !roles.data?.mint}
            >
              Save portal kind
            </button>
          </form>
          <div className="space-y-6">
            <form
              onSubmit={(event) => void form(event, mint)}
              className="rounded-card border border-line p-6"
            >
              <h2 className="font-display text-xl">Airdrop portals</h2>
              <label className="mt-4 block text-sm font-bold">
                Portal kind number
                <input
                  className={inputClass}
                  value={mintKind}
                  onChange={(event) => setMintKind(event.target.value)}
                  required
                  inputMode="numeric"
                />
              </label>
              <label className="mt-4 block text-sm font-bold">
                Recipient wallets
                <textarea
                  className={inputClass}
                  rows={5}
                  value={recipients}
                  onChange={(event) => setRecipients(event.target.value)}
                  placeholder="One wallet per line, up to 100 per batch"
                  required
                />
              </label>
              <p className="mt-2 text-sm text-muted">
                Randomness is paid in ETH. Wallets and token allocations are
                committed before the draw.
              </p>
              <button
                className={cn(boosterButtonClass, "mt-5")}
                disabled={actions.busy || !roles.data?.mint}
              >
                Request airdrop
              </button>
            </form>
            <form
              onSubmit={(event) => void form(event, reveal)}
              className="rounded-card border border-line p-6"
            >
              <h2 className="font-display text-xl">Finish an airdrop</h2>
              <label className="mt-4 block text-sm font-bold">
                Mint request number
                <input
                  className={inputClass}
                  value={mintRequest}
                  onChange={(event) => setMintRequest(event.target.value)}
                  required
                  inputMode="numeric"
                />
              </label>
              {mintProgress.data && (
                <p role="status" className="mt-3 text-sm">
                  {mintProgress.data.delivered} / {mintProgress.data.quantity}{" "}
                  portals delivered.{" "}
                  {mintProgress.data.complete
                    ? "Airdrop complete."
                    : mintProgress.data.indexing
                      ? "Updating indexed delivery data…"
                      : mintProgress.data.ready
                        ? "Ready for the next delivery."
                        : "Waiting for Chainlink randomness…"}
                </p>
              )}
              {mintProgress.error && (
                <p role="status" className="mt-3 text-sm">
                  {mintProgress.error.message}
                </p>
              )}
              {!!deliveries.data?.requests.length && (
                <div className="mt-4">
                  <p className="text-sm font-semibold">
                    Your recent mint requests
                  </p>
                  <ul className="mt-2 space-y-2">
                    {deliveries.data.requests.map((request) => (
                      <li key={request.requestId}>
                        <button
                          type="button"
                          className="text-sm underline"
                          onClick={() => setMintRequest(request.requestId)}
                        >
                          Request #{request.requestId}: {request.delivered} /{" "}
                          {request.quantity} delivered
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                className={cn(boosterButtonClass, "mt-5")}
                disabled={
                  actions.busy ||
                  !mintProgress.data?.ready ||
                  mintProgress.data.complete
                }
              >
                Reveal next 32 portals
              </button>
            </form>
          </div>
          <form
            onSubmit={(event) => void form(event, updateFees)}
            className="rounded-card border border-line p-6 md:col-span-2"
          >
            <h2 className="font-display text-xl">Fees and AI recipient</h2>
            <p className="mt-2 text-sm text-muted">
              Updates apply to new requests. Accepted jobs keep their original
              payment terms. Portal fees accumulate on each portal NFT and are
              paid only when its current owner burns it.
            </p>
            {status?.competition && (
              <p className="mt-2 text-sm text-muted">
                Each new request also contributes 0.50 USDC to the competition
                pool. The fee settings below control the AI and portal
                components; competition reserves are paid only to winners.
              </p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                ["Portal kind number", feeKind, setFeeKind],
                ["AI fee in USDC", aiFee, setAiFee],
                ["Portal fee in USDC", portalFee, setPortalFee],
                ["AI recipient wallet", aiWallet, setAiWallet]
              ].map(([label, value, setter]) => (
                <label key={String(label)} className="block text-sm font-bold">
                  {String(label)}
                  <input
                    className={inputClass}
                    value={String(value)}
                    onChange={(event) =>
                      (setter as (v: string) => void)(event.target.value)
                    }
                    required
                  />
                </label>
              ))}
            </div>
            <button
              className={cn(boosterButtonClass, "mt-5")}
              disabled={actions.busy || !roles.data?.fees}
            >
              Update pricing
            </button>
          </form>
        </div>
      )}
      {actions.busy && (
        <p className="mt-6" role="status">
          {actions.phase}
        </p>
      )}
      {(actions.error || localError) && (
        <p role="alert" className="mt-5 break-words text-grape">
          {localError ?? actions.error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-5 font-semibold">
          {notice}
        </p>
      )}
    </main>
  );
}
