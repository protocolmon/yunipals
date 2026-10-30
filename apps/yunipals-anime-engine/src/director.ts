import { animeFighterName } from "./fighterNames.js";
import { resolveAnimeKit, type AnimeKitChoice } from "./kitPolicy.js";
export { resolveAnimeKit, compatibleAnimeKit } from "./kitPolicy.js";

export type AnimeEvent = {
  id: string;
  actorId: string;
  targetId: string;
  start: number;
  release: number;
  contact: number;
  outcome: string;
  attackName: string;
  [key: string]: unknown;
};
export type AnimeMatch = {
  id: string;
  fighterIds: string[];
  winnerId: string;
  loserId: string;
  verdict: string;
  verdictSeconds: number;
  settledSeconds: number;
  whyWinner: string;
  events: AnimeEvent[];
};
export type AnimeTournament = {
  source: { tournamentId: string; inputSha256: string; outcomeSha256: string };
  islandName: string;
  initialHealth: number;
  damage: { heavy: number; light: number };
  fighters: Record<
    string,
    { name: string; species: string; locomotion: string }
  >;
  semifinals: string[][];
  matches: AnimeMatch[];
  championId: string;
};
export type AnimeAttackKind = "vine" | "star" | "jet" | "orb" | "dash";
export type AnimePosition = {
  x: number[][];
  y?: number[][];
  depth?: number[][];
  face?: number[][];
  rot?: number[][];
};
export type AnimeMatchChoreography = {
  label: string;
  pos: Record<string, AnimePosition>;
  names: Record<string, string>;
  kinds: Record<string, AnimeAttackKind>;
  kits?: Record<string, string | null>;
  cutins: Array<{
    at: number;
    type: string;
    title: string;
    who?: string;
    quote?: string;
    quotes?: Record<string, string>;
  }>;
  result: string;
};
export const ATTACK_NAMES: Record<string, string> = {
  vine: "VINE LASH",
  star: "STAR BURST",
  jet: "WATER HAMMER",
  orb: "ARC ORB",
  dash: "BODY STRIKE"
};
/** A quote is always an exact substring of a locked strategy, including punctuation. */
export function strategyQuote(text: string) {
  const line = text.trim().split(/[\r\n]/)[0] ?? "";
  const sentence = line.match(/^[^.!?]*[.!?]/)?.[0];
  if (sentence && sentence.length <= 64) return sentence;
  let end = Math.min(64, line.length);
  if (
    end < line.length &&
    /[\p{L}\p{N}_]/u.test(line[end - 1]!) &&
    /[\p{L}\p{N}_]/u.test(line[end]!)
  ) {
    while (end > 0 && !/\s/.test(line[end - 1]!)) end--;
  }
  return line.slice(0, end).trim();
}
/** Pure staging. The original tournament and every combat event remain untouched. */
export function directTournament(
  t: AnimeTournament,
  looks: Record<string, { attackKind: string }>,
  strategies: Record<string, string>,
  loadouts: Record<string, AnimeKitChoice[]> = {}
): Record<string, AnimeMatchChoreography> {
  return Object.fromEntries(
    t.matches.map((m, index) => {
      const pos = Object.fromEntries(
        m.fighterIds.map((id, side) => {
          const home = side === 0 ? 380 : 900;
          const events = m.events.filter((e) => e.actorId === id);
          const x: number[][] = [[0, home]];
          for (const e of events) {
            if (e.start > 0) x.push([e.start, home]);
            x.push([e.release, side === 0 ? 500 : 780]);
          }
          x.sort((a, b) => a[0]! - b[0]!);
          return [id, { x }];
        })
      );
      const events = [...m.events].sort(
        (a, b) => a.start - b.start || a.id.localeCompare(b.id)
      );
      const crossfire = events.find((e) =>
        events.some(
          (other) =>
            other.actorId !== e.actorId &&
            other.start <= e.release &&
            other.release >= e.start
        )
      );
      const finishing = [...events]
        .reverse()
        .find(
          (e) =>
            e.actorId === m.winnerId && ["hit", "guarded"].includes(e.outcome)
        );
      const quoteFor = (id: string, event?: AnimeEvent) => {
        const strategy = strategies[id] ?? "";
        const fragment =
          typeof event?.strategyQuote === "string" &&
          strategy.includes(event.strategyQuote)
            ? event.strategyQuote
            : strategy;
        return strategyQuote(fragment);
      };
      const cutins: Array<{
        at: number;
        type: string;
        title: string;
        who?: string;
        quote?: string;
        quotes?: Record<string, string>;
      }> = [];
      if (crossfire)
        cutins.push({
          at: crossfire.start,
          type: "both",
          title: "CROSSFIRE!",
          quotes: Object.fromEntries(
            m.fighterIds.map((id) => [
              id,
              quoteFor(
                id,
                events.find(
                  (e) =>
                    e.actorId === id &&
                    e.start <= crossfire.release &&
                    e.release >= crossfire.start
                )
              )
            ])
          )
        });
      if (finishing)
        cutins.push({
          at: finishing.release,
          type: "one",
          who: m.winnerId,
          title: ATTACK_NAMES[looks[m.winnerId]!.attackKind]!,
          quote: quoteFor(m.winnerId, finishing)
        });
      return [
        m.id,
        {
          label: index === 2 ? "FINAL" : `SEMIFINAL ${index + 1}`,
          pos,
          names: Object.fromEntries(
            events.map((e) => [
              e.id,
              resolveAnimeKit(
                e.attackName,
                eventKind(e, looks[e.actorId]!.attackKind, loadouts[e.actorId]),
                loadouts[e.actorId]
              )?.name.toUpperCase() ??
                ATTACK_NAMES[looks[e.actorId]!.attackKind] ??
                "BODY STRIKE"
            ])
          ),
          kinds: Object.fromEntries(
            events.map((e) => [
              e.id,
              eventKind(e, looks[e.actorId]!.attackKind, loadouts[e.actorId])
            ])
          ),
          cutins,
          ...(Object.keys(loadouts).length
            ? {
                kits: Object.fromEntries(
                  events.map((e) => [
                    e.id,
                    resolveAnimeKit(
                      e.attackName,
                      eventKind(
                        e,
                        looks[e.actorId]!.attackKind,
                        loadouts[e.actorId]
                      ),
                      loadouts[e.actorId]
                    )?.id ?? null
                  ])
                )
              }
            : {}),
          result: `${animeFighterName(t.fighters[m.winnerId]!.name)} wins.`
        }
      ];
    })
  );
}

function eventKind(
  e: AnimeEvent,
  fallback: string,
  loadout: readonly AnimeKitChoice[] = []
): AnimeAttackKind {
  const kit = loadout.find(
    (k) => k.name.toUpperCase() === e.attackName.trim().toUpperCase()
  );
  if (kit?.kind === "strike") return "vine";
  if (kit?.kind === "dash") return "dash";
  if (kit?.kind === "projectile")
    return ["star", "jet", "orb"].includes(fallback)
      ? (fallback as AnimeAttackKind)
      : "orb";
  return (
    Object.hasOwn(ATTACK_NAMES, fallback) ? fallback : "dash"
  ) as AnimeAttackKind;
}
