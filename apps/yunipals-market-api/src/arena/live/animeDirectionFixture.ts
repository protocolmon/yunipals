/** The historical manual battle, for tests and offline comparison only. Never a
 * fallback for a failed provider result or a source of new combat events. */
import { readFileSync } from "node:fs";
import {
  ANIME_DIRECTION_VERSION,
  ANIME_PROVIDER_DIRECTION_VERSION,
  type AnimeDirection,
  type AnimeDirectionInput,
  type AnimeProviderDirection
} from "./animeDirection";
import {
  strategyQuote,
  type AnimeMatchChoreography
} from "../../../../yunipals-anime-engine/src/director";

const manual = JSON.parse(
  readFileSync(
    new URL(
      "../../../../yunipals-anime-engine/fixtures/choreography.json",
      import.meta.url
    ),
    "utf8"
  )
) as Record<string, AnimeMatchChoreography>;
const tournament = JSON.parse(
  readFileSync(
    new URL(
      "../../../../yunipals-anime-engine/fixtures/tournament.json",
      import.meta.url
    ),
    "utf8"
  )
) as { matches: Array<{ id: string; fighterIds: string[] }> };

/** Test fixture encoder only; never repairs a production provider response. */
export function fixtureProviderDirection(
  input: AnimeDirectionInput,
  direction = manualAnimeDirection(input)
): AnimeProviderDirection {
  return {
    version: ANIME_PROVIDER_DIRECTION_VERSION,
    matches: Object.fromEntries(
      input.tournament.matches.map((m) => [
        m.id,
        {
          attacks: JSON.stringify(
            direction.attacks
              .filter((e) => e.matchId === m.id)
              .map(({ matchId, ...item }) => ({
                ...item,
                kit: item.kit ?? null
              }))
          ),
          motion: JSON.stringify(
            direction.motion
              .filter((e) => e.matchId === m.id)
              .map(({ matchId, ...item }) => item)
          ),
          cutins: JSON.stringify(
            direction.cutins
              .filter((e) => e.matchId === m.id)
              .map(({ matchId, ...item }) => item)
          )
        }
      ])
    )
  };
}

export function manualAnimeDirection(
  input: AnimeDirectionInput
): AnimeDirection {
  return {
    version: ANIME_DIRECTION_VERSION,
    attacks: input.tournament.matches.flatMap((m) =>
      m.events.map((e) => ({
        matchId: m.id,
        eventId: e.id,
        name: manual[m.id]!.names[e.id]!,
        kind:
          manual[m.id]!.kinds?.[e.id] === "dash"
            ? "dash"
            : input.choreography[m.id]!.kinds[e.id]!
      }))
    ),
    motion: input.tournament.matches.flatMap((m) =>
      m.fighterIds.map((fighterId, side) => {
        const original = tournament.matches.find((match) => match.id === m.id)!;
        const pos = manual[m.id]!.pos[original.fighterIds[side]!]!;
        const channel = (name: keyof typeof pos) =>
          (pos[name] ?? [])
            .filter((k) => k[0]! <= m.verdictSeconds)
            .map((k) => ({ t: k[0]!, value: k[1]! }));
        return {
          matchId: m.id,
          fighterId,
          x: channel("x"),
          y: channel("y"),
          depth: channel("depth"),
          face: channel("face"),
          rot: channel("rot")
        };
      })
    ),
    cutins: Object.entries(input.choreography).flatMap(([matchId, c]) =>
      c.cutins.map((ci, index) => ({
        matchId,
        index,
        at: manual[matchId]!.cutins[index]!.at,
        title: manual[matchId]!.cutins[index]!.title,
        quotes: (ci.type === "one" ? [ci.who!] : Object.keys(ci.quotes!)).map(
          (fighterId) => ({
            fighterId,
            text: strategyQuote(input.strategies[fighterId] ?? "")
          })
        )
      }))
    )
  };
}
