import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { formatEther, type Address } from "viem";
import { z } from "zod";
import { adventureAbi } from "@protopals/yunipals-market-core/evolutionAbi";
import {
  crewEligibility,
  crewSlotMatches,
  isCrewNewborn,
  type CrewSelection
} from "@protopals/yunipals-market-core/serums";

import { environment } from "@/environment";
import { evolutionRequest, type AdventureCard } from "@/lib/evolution";
import { tcgColors, tcgSpecies } from "@/lib/boosterCollectionGrid";
import { cn } from "@/lib/utils";
import {
  AdventureCardTile,
  AdventureWallet,
  adventureButton
} from "./AdventureCards";

const dailySchema = z.object({
  enabled: z.boolean(),
  day: z.number().int().positive(),
  timestamp: z.number().int(),
  requestId: z.string().regex(/^\d+$/),
  ready: z.boolean(),
  color: z.number().int().min(0).max(6),
  monsterType: z.number().int().min(0).max(11)
});
export function DailyCrewBuilder({
  onReview,
  busy
}: {
  onReview: (survivor: string, crew: CrewSelection) => void;
  busy: boolean;
}) {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: environment.portalChainId });
  const wallet = useWalletClient();
  const latestWallet = useRef({ address, chainId, wallet: wallet.data });
  latestWallet.current = { address, chainId, wallet: wallet.data };
  const [slot, setSlot] = useState(0);
  const [selected, setSelected] = useState<(AdventureCard | null)[]>([
    null,
    null,
    null
  ]);
  const [selectionDay, setSelectionDay] = useState<number | null>(null);
  const [selectionOwner, setSelectionOwner] = useState<string | undefined>();
  const [survivor, setSurvivor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const daily = useQuery({
    queryKey: ["evolution", "daily-crew"],
    queryFn: async ({ signal }) =>
      dailySchema.parse(await evolutionRequest("/crew", signal)),
    refetchInterval: 15000
  });
  const rules = daily.data;
  const crew =
    rules?.day === selectionDay && selectionOwner === address
      ? selected
      : [null, null, null];
  const connected = Boolean(address && chainId === environment.portalChainId);
  const price = useQuery({
    queryKey: ["evolution", "daily-crew-price", rules?.day],
    enabled: Boolean(client && rules?.enabled && rules.requestId === "0"),
    queryFn: async () => {
      const fees = await client!.estimateFeesPerGas();
      const quote = await client!.readContract({
        address: environment.adventuresAddress as Address,
        abi: adventureAbi,
        functionName: "quoteRandomness",
        args: [fees.maxFeePerGas ?? fees.gasPrice!]
      });
      return (quote * 125n + 99n) / 100n;
    },
    refetchInterval: 15000
  });
  const labels = rules
    ? [
        `${tcgColors[rules.color - 1] ?? "Today's color"} monster`,
        "Diamond-horn monster",
        tcgSpecies[rules.monsterType - 1] ?? "Today's species"
      ]
    : ["Today's color", "Diamond horn", "Today's species"];
  const cards = crew.filter((card): card is AdventureCard => card !== null);
  const eligibility = rules
    ? crewEligibility(cards, rules)
    : "Loading today's requirements…";
  async function prepareDay() {
    if (
      !client ||
      !wallet.data ||
      !address ||
      !connected ||
      !rules ||
      price.data === undefined ||
      preparing
    )
      return;
    setPreparing(true);
    setError(null);
    try {
      const transaction = {
        address: environment.adventuresAddress as Address,
        abi: adventureAbi,
        functionName: "prepareDailyCrew" as const,
        args: [BigInt(rules.day), price.data] as const,
        account: address,
        value: price.data
      };
      await client.simulateContract(transaction);
      const [activeChain, accounts] = await Promise.all([
        wallet.data.getChainId(),
        wallet.data.getAddresses()
      ]);
      if (
        latestWallet.current.address !== address ||
        latestWallet.current.wallet !== wallet.data ||
        latestWallet.current.chainId !== environment.portalChainId ||
        activeChain !== environment.portalChainId ||
        accounts[0]?.toLowerCase() !== address.toLowerCase()
      )
        throw new Error("Your wallet changed. Review the daily draw again.");
      const hash = await wallet.data.writeContract({
        ...transaction,
        chain: client.chain
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error(
          "The daily draw was not accepted. Refresh and try again."
        );
      await daily.refetch();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.slice(0, 240)
          : "Could not prepare today's requirements."
      );
    } finally {
      setPreparing(false);
    }
  }
  function choose(card: AdventureCard) {
    if (!rules) return;
    setError(null);
    if (
      card.graded ||
      card.reservedBy ||
      card.pendingGrade ||
      card.nextAdventureAt > rules.timestamp
    ) {
      setError(
        "Choose an ungraded monster without a pending action or cooldown."
      );
      return;
    }
    if (!crewSlotMatches(card, slot, rules)) {
      setError(`This slot needs ${labels[slot]}.`);
      return;
    }
    if (
      crew.some((other, i) => i !== slot && other?.tokenId === card.tokenId)
    ) {
      setError("Each slot needs a different monster.");
      return;
    }
    const next = [...crew];
    next[slot] = card;
    setSelected(next);
    setSelectionDay(rules.day);
    setSelectionOwner(address);
    if (!next.some((member) => member?.tokenId === survivor))
      setSurvivor(card.tokenId);
  }
  return (
    <section
      id="daily-crew"
      className="mt-10 scroll-mt-8 rounded-3xl border border-line bg-lavender/10 p-5 sm:p-8"
    >
      <p className="text-sm font-bold uppercase tracking-widest text-grape">
        Today's expedition
      </p>
      <h2 className="mt-2 font-display text-3xl">
        Three depart. Your chosen companion returns.
      </h2>
      <p className="mt-3 max-w-2xl">
        Match one monster to each slot. At least one must have been born today
        (UTC). Choose who returns with a guaranteed serum; the other two are
        permanently sacrificed.
      </p>
      {daily.isPending && (
        <p role="status" className="mt-4 animate-pulse">
          Discovering today's expedition…
        </p>
      )}
      {daily.error && (
        <p role="alert" className="mt-4">
          {daily.error.message}{" "}
          <button className="underline" onClick={() => void daily.refetch()}>
            Retry
          </button>
        </p>
      )}
      {rules && !rules.enabled && (
        <p className="mt-4">Crew adventures are being prepared.</p>
      )}
      {rules?.enabled && !rules.ready && (
        <div className="mt-5">
          <p>
            {rules.requestId === "0"
              ? "Today's shared requirements have not been drawn yet. One draw prepares them for everyone."
              : "Today's requirements are awaiting randomness."}
          </p>
          {rules.requestId === "0" && (
            <button
              className={cn(adventureButton, "mt-3")}
              disabled={!connected || price.data === undefined || preparing}
              onClick={() => void prepareDay()}
            >
              {preparing
                ? "Preparing…"
                : `Reveal today's requirements${price.data === undefined ? "" : ` · up to ${formatEther(price.data)} ETH + gas`}`}
            </button>
          )}
          {price.error && (
            <p role="alert">
              Could not estimate the draw fee.{" "}
              <button
                className="underline"
                onClick={() => void price.refetch()}
              >
                Retry
              </button>
            </p>
          )}
        </div>
      )}
      {rules?.enabled && rules.ready && (
        <>
          <p className="mt-3 text-sm text-muted">
            Requirements change at 00:00 UTC. Each participating monster has a
            24-hour cooldown.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {crew.map((card, index) => (
              <div
                key={index}
                className="rounded-2xl border border-line bg-white p-3"
              >
                <button
                  className={cn(
                    "mb-3 w-full rounded-full border px-3 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-grape",
                    slot === index && "border-grape bg-lavender/40"
                  )}
                  aria-pressed={slot === index}
                  onClick={() => setSlot(index)}
                >
                  {labels[index]}
                </button>
                {card ? (
                  <>
                    <AdventureCardTile card={card} />
                    {isCrewNewborn(card, rules.day) && (
                      <p className="mt-2 text-sm font-bold text-grape">
                        Born today · crew requirement met
                      </p>
                    )}
                    <label className="mt-3 flex items-center gap-2 text-sm font-bold">
                      <input
                        type="radio"
                        name="crew-survivor"
                        checked={survivor === card.tokenId}
                        onChange={() => setSurvivor(card.tokenId)}
                      />
                      Returns with the serum
                    </label>
                  </>
                ) : (
                  <div className="flex min-h-40 items-center justify-center rounded-2xl bg-lavender/20 p-5 text-center text-sm">
                    Select this slot, then choose a companion below.
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm" aria-live="polite">
            {eligibility ?? "Your crew meets today's requirements."}
          </p>
          <button
            className={cn(adventureButton, "mt-3")}
            disabled={
              !connected ||
              busy ||
              eligibility !== null ||
              !cards.some((card) => card.tokenId === survivor)
            }
            onClick={() =>
              onReview(survivor, {
                tokenIds: cards.map((card) => card.tokenId) as [
                  string,
                  string,
                  string
                ],
                day: rules.day
              })
            }
          >
            Review crew and sacrifices
          </button>
          {address && (
            <div className="mt-7">
              <h3 className="mb-3 font-display text-xl">
                Choose your {labels[slot]}
              </h3>
              <AdventureWallet owner={address} onSelect={choose} />
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
