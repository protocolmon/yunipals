import { ArrowUpRight, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";

import { ChainLogo } from "@/components/ui/ChainLogo";
import { chainDetails, type ChainId } from "@/data/chains";
import { environment } from "@/environment";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { boosterAddresses } from "@/lib/boosters";
import {
  baseIslandsContractAddress,
  islandsContractAddress
} from "@/lib/islandsIndexer";
import { cn } from "@/lib/utils";

type CollectionContract = {
  name: string;
  chain: ChainId;
  address: Address;
};

type ContractGroup = {
  title: string;
  description: string;
  contracts: CollectionContract[];
};

const yunipalsContracts: CollectionContract[] = (
  ["ethereum", "base", "polygon", "bnb"] as const
).map((chain) => ({
  name: "Yunipals",
  chain,
  address: chainDetails[chain].contractAddress
}));

export function ContractsPage() {
  usePageMetadata(
    "Contracts | Yunipals",
    "Find Yunipals collection contract addresses and open them on Ethereum, Base, Polygon, and BNB Chain explorers."
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const boosters = boosterAddresses();
  const groups: ContractGroup[] = [
    {
      title: "Yunipals",
      description: "The Yunipals collections across four networks.",
      contracts: yunipalsContracts
    },
    {
      title: "Islands",
      description: "Grassland Archipelago, including the Base airdrop.",
      contracts: [
        {
          name: "Original Islands",
          chain: "ethereum",
          address: islandsContractAddress
        },
        {
          name: "Airdropped Islands",
          chain: "base",
          address: baseIslandsContractAddress
        }
      ]
    },
    ...(boosters
      ? [
          {
            title: "Yunipals TCG",
            description: "Yunipals minted from packs and daily claims.",
            contracts: [
              {
                name: "Yunipals TCG",
                chain: "base" as const,
                address: boosters.monsters
              }
            ]
          }
        ]
      : [])
  ];

  async function copyAddress(contract: CollectionContract) {
    const label = `${contract.name} on ${chainDetails[contract.chain].label}`;
    try {
      await navigator.clipboard.writeText(contract.address);
      setCopiedKey(`${contract.chain}:${contract.address}`);
      setCopyMessage(`${label} contract address copied.`);
    } catch {
      setCopiedKey(null);
      setCopyMessage(
        `Could not copy the ${label} address. Select and copy it manually.`
      );
    }
  }

  return (
    <main className="mx-auto min-h-[65vh] max-w-4xl px-4 py-12 sm:px-8 sm:py-16">
      <Link
        to="/"
        className="rounded-lg text-sm font-bold text-ethereum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
      >
        Back to collection
      </Link>
      <h1 className="display mt-8 text-4xl text-ink sm:text-5xl">Contracts</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
        Find each collection’s contract address below. Open an address to view
        it on its network’s blockchain explorer, or copy it for reference.
      </p>
      <p role="status" className="mt-4 min-h-5 text-sm text-muted">
        {copyMessage}
      </p>

      <div className="mt-6 space-y-10">
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="display text-2xl text-ink">{group.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {group.description}
            </p>
            <ul className="mt-4 divide-y divide-line rounded-card border border-line">
              {group.contracts.map((contract) => {
                const chain = chainDetails[contract.chain];
                const key = `${contract.chain}:${contract.address}`;
                const copied = copiedKey === key;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 p-4 sm:gap-5 sm:p-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <h3 className="text-sm font-bold text-ink">
                          {contract.name}
                        </h3>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset",
                            chain.badgeClassName
                          )}
                        >
                          <ChainLogo
                            chainId={contract.chain}
                            className="h-3 w-3"
                          />
                          {chain.label}
                        </span>
                      </div>
                      <a
                        href={`${chain.explorerUrl}/address/${contract.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-block rounded-lg font-mono text-xs leading-relaxed text-ethereum underline decoration-line underline-offset-4 hover:decoration-ethereum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4 sm:text-sm"
                        aria-label={`View ${contract.name} contract on ${chain.label}: ${contract.address} (opens in a new tab)`}
                      >
                        <span className="break-all">{contract.address}</span>{" "}
                        <ArrowUpRight
                          className="inline-block h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyAddress(contract)}
                      aria-label={`Copy ${contract.name} contract address on ${chain.label}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:bg-line/50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
                    >
                      {copied ? (
                        <Check aria-hidden="true" size={16} />
                      ) : (
                        <Copy aria-hidden="true" size={16} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {environment.exomonEnabled && (
          <section aria-label="Exomon">
            <h2 className="display text-2xl text-ink">Exomon on Solana</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Each Exomon has its own mint address. Open an Exomon’s detail page
              to view its mint on Solscan.
            </p>
            <Link
              to="/?chain=solana"
              className="mt-4 inline-block rounded-lg text-sm font-bold text-ethereum underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
            >
              Browse Exomon
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
