import type { ArenaTournamentSummary } from "@protopals/yunipals-market-core/arenaViews";

export type ArenaBattleView =
  | "queues"
  | "ongoing"
  | "completed"
  | "refunded"
  | "all";

export function matchesArenaBattleView(
  t: ArenaTournamentSummary,
  view: ArenaBattleView,
  now = Date.now()
) {
  if (view === "queues")
    return (
      t.phase === "open" &&
      t.fighters.length < 4 &&
      (!t.deadline || t.deadline * 1000 > now)
    );
  if (view === "ongoing")
    return (
      ["open", "strategies", "resolving"].includes(t.phase) ||
      (t.phase === "settled" && !t.videoReady)
    );
  if (view === "completed") return t.phase === "settled" && t.videoReady;
  if (view === "refunded") return t.phase === "expired";
  return true;
}
