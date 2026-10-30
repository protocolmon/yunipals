import { useArenaDeployment } from "@/lib/arenaDeployment";
import { Link } from "react-router-dom";
import { formatUnits } from "viem";
import type {
  ArenaTournamentSummary,
  ArenaRewardRecord
} from "@protopals/yunipals-market-core/arenaViews";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

export function arenaIslandHref(id: string) {
  return `/collection/base-islands-v2/${id}`;
}
export function arenaStatusLabel(t: ArenaTournamentSummary) {
  if (t.phase === "expired") return "Refunds credited";
  if (t.phase === "settled")
    return t.payoutsReleased
      ? "Video ready · payouts unlocked"
      : t.videoReady
        ? "Video ready · payouts unlocking"
        : "Video in production";
  if (t.phase === "resolving") return "Referee deciding";
  if (t.phase === "strategies") return "Strategies open";
  return `Gathering fighters · ${t.fighters.length}/4`;
}

export function ArenaTournamentCard({
  tournament: t,
  wallet,
  intent = "track"
}: {
  tournament: ArenaTournamentSummary;
  wallet?: string;
  intent?: "join" | "track" | "watch";
}) {
  const deployment = useArenaDeployment();
  const battleHref = `${deployment.basePath}/${t.id}${intent === "join" ? "#join" : ""}`;
  const own = t.fighters.filter(
    (f) => f.player.toLowerCase() === wallet?.toLowerCase()
  );
  const action =
    intent === "join" && t.phase === "open"
      ? `Choose a fighter · ${deployment.entry} USDC`
      : t.phase === "strategies" &&
          Date.now() / 1000 < t.deadline &&
          own.some((f) => !t.submittedSeats.includes(f.seat))
        ? "Write your strategy"
        : t.videoReady
          ? "Watch battles"
          : t.phase === "expired"
            ? "View refund"
            : "View battle";
  return (
    <article className="flex flex-col rounded-card border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold">
          <Link
            to={battleHref}
            className="rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
          >
            Battle #{t.id}
          </Link>
        </h3>
        {own.length ? (
          <span className="rounded-full bg-mint/30 px-3 py-1 text-xs font-semibold">
            {action === "Write your strategy"
              ? "Your move"
              : own.length === 1
                ? "Your fighter"
                : `${own.length} of your fighters`}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-semibold text-grape">
        {arenaStatusLabel(t)}
      </p>
      <div
        className="my-4 grid grid-cols-4 gap-2"
        aria-label="Tournament fighters"
      >
        {[0, 1, 2, 3].map((seat) => {
          const f = t.fighters.find((f) => f.seat === seat);
          return (
            <div key={seat} className="min-w-0">
              {f?.image ? (
                <img
                  src={f.image}
                  alt={f.name}
                  loading="lazy"
                  className="aspect-square w-full rounded-2xl object-cover"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-2xl bg-line/40 text-xs text-muted">
                  {f ? `#${f.tokenId}` : "Open"}
                </div>
              )}
              {f ? (
                <p className="mt-1 truncate text-xs text-muted" title={f.name}>
                  {f.name}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {t.islandId ? (
        <Link
          to={arenaIslandHref(t.islandId)}
          className="text-sm font-semibold underline"
        >
          Base island #{t.islandId}
        </Link>
      ) : (
        <p className="text-sm text-muted">
          {t.fighters.length
            ? "Island draw pending"
            : "The first entry draws the island"}
        </p>
      )}
      {t.islandBeneficiary ? (
        <p className="mt-2 text-xs text-muted">
          Hosting beneficiary: {shortAddress(t.islandBeneficiary)}
        </p>
      ) : null}
      {t.deadline > 0 &&
      ["open", "strategies", "resolving"].includes(t.phase) ? (
        <p className="mt-2 text-xs text-muted">
          Deadline: {new Date(t.deadline * 1000).toLocaleString()}
        </p>
      ) : null}
      <Link
        to={
          intent === "join"
            ? battleHref
            : t.phase === "expired"
              ? `${deployment.basePath}/rewards`
              : `${deployment.basePath}/${t.id}`
        }
        className="mt-5 self-start rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
      >
        {action}
      </Link>
    </article>
  );
}

const rewardLabels = {
  winner: "Battle winnings",
  host: "Hosting reward",
  operations: "Operations allocation",
  refund: "Entry refund",
  withdrawal: "Wallet withdrawal"
};
export function ArenaRewardList({ items }: { items: ArenaRewardRecord[] }) {
  const deployment = useArenaDeployment();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-4 p-5"
        >
          <div>
            <p className="font-semibold">{rewardLabels[item.kind]}</p>
            <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted">
              {item.tournamentId ? (
                <Link
                  to={`${deployment.basePath}/${item.tournamentId}`}
                  className="underline"
                >
                  Battle #{item.tournamentId}
                </Link>
              ) : (
                <span>Combined wallet balance</span>
              )}
              <a
                href={`https://basescan.org/tx/${item.transactionHash}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                View transaction
              </a>
            </div>
          </div>
          <span
            className={cn(
              "font-bold tabular-nums",
              item.kind === "withdrawal" ? "text-muted" : "text-ink"
            )}
          >
            {item.kind === "withdrawal" ? "−" : "+"}
            {formatUnits(BigInt(item.amount), 6)} USDC
          </span>
        </li>
      ))}
    </ul>
  );
}
