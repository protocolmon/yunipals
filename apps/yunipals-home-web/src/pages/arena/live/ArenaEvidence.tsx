import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ArenaTimelineEvent } from "@protopals/yunipals-market-core/arenaViews";
import type { ArenaPublicTournament } from "@protopals/yunipals-market-core/arena";
import { arenaRequest } from "@/lib/arenaLive";
import { ArenaLoading } from "./ArenaFeedback";
import { useArenaClock } from "./useArenaClock";

const labels: Record<string, string> = {
  TournamentOpened: "Lobby opened",
  Entered: "Fighter entry confirmed",
  IslandRequested: "Island randomness requested",
  IslandSelected: "Island and hosting beneficiary fixed",
  StrategiesOpened: "Strategy window opened",
  InputFrozen: "Complete battle input locked",
  AutomaticStrategiesAssigned: "Missing strategies assigned automatic attacks",
  ResultSettled: "Tournament result fixed",
  PayoutsReleased: "Film committed and payouts credited",
  TournamentExpired: "Tournament expired; entry refunds credited"
};

export function ArenaDeadline({
  tournament: t
}: {
  tournament: ArenaPublicTournament;
}) {
  const now = useArenaClock(t.serverTime);
  if (!t.deadline)
    return (
      <p className="text-sm text-muted">
        7-day joining window starts with the first entry
      </p>
    );
  if (!["open", "strategies", "resolving"].includes(t.phase)) return null;
  const seconds = Math.max(0, t.deadline - now),
    minutes = Math.ceil(seconds / 60),
    days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60);
  const remaining = days
    ? `${days}d ${hours}h remaining`
    : hours
      ? `${hours}h ${minutes % 60}m remaining`
      : `${minutes}m remaining`;
  return (
    <div className="text-sm text-muted">
      <p>
        {seconds
          ? remaining
          : t.phase === "strategies"
            ? "Strategy window closed · preparing automatic attacks"
            : "Deadline passed · awaiting confirmed update"}
      </p>
      <p className="mt-1">
        Deadline:{" "}
        <time dateTime={new Date(t.deadline * 1000).toISOString()}>
          {new Date(t.deadline * 1000).toLocaleString()}
        </time>
      </p>
    </div>
  );
}

export function ArenaEvidence({
  tournament: t
}: {
  tournament: ArenaPublicTournament;
}) {
  const [open, setOpen] = useState(false);
  const timeline = useQuery({
    queryKey: ["arena-live", "timeline", t.id, t.resultHash, t.videoHash],
    queryFn: ({ signal }) =>
      arenaRequest<{ items: ArenaTimelineEvent[] }>(
        `/tournaments/${t.id}/timeline`,
        undefined,
        signal
      ),
    enabled: open,
    refetchInterval:
      open && !["expired", "settled"].includes(t.phase) ? 15000 : false
  });
  return (
    <details
      className="my-6 rounded-card border border-line p-6"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-bold">
        Timeline & verification
      </summary>
      <p className="my-4 text-sm text-muted">
        Confirmed events from the indexer. VRF verifies the island draw; the
        central referee interprets player strategies.
      </p>
      {timeline.isPending ? (
        <ArenaLoading label="Loading confirmed timeline…" />
      ) : null}
      {timeline.error ? (
        <div role="alert">
          <p>{timeline.error.message}</p>
          <button
            className="mt-2 font-semibold underline"
            onClick={() => void timeline.refetch()}
          >
            Retry timeline
          </button>
        </div>
      ) : null}
      {timeline.data?.items.length === 0 ? (
        <p className="text-muted">No confirmed tournament events yet.</p>
      ) : null}
      <ol className="space-y-3">
        {timeline.data?.items.map((e) => (
          <li
            key={`${e.transactionHash}/${e.logIndex}`}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3"
          >
            <span>{labels[e.event] ?? e.event}</span>
            <a
              className="text-sm font-semibold underline"
              href={`https://basescan.org/tx/${e.transactionHash}#eventlog`}
              target="_blank"
              rel="noreferrer"
            >
              Block {e.blockNumber} · log {e.logIndex}
            </a>
          </li>
        ))}
      </ol>
      <dl className="mt-5 space-y-3 break-all text-xs">
        {[
          ["Rules hash", t.rulesHash],
          ["Island pool hash", t.poolHash],
          ["VRF request", t.requestId],
          ["VRF word", t.randomWord],
          ["Frozen input hash", t.inputHash],
          ["Result hash", t.resultHash]
        ]
          .filter(([, value]) => value != null)
          .map(([label, value]) => (
            <div key={label}>
              <dt className="font-bold">{label}</dt>
              <dd className="mt-1 font-mono text-muted">{value}</dd>
            </div>
          ))}
      </dl>
    </details>
  );
}
