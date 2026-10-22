export type RacerAbility = {
  id: string;
  name: string;
  energyCost: number;
  cooldownBeats: number;
  targets: ("racer" | "terrain" | "self")[];
  capability: string;
  limits: string;
};

// Proposed race powers for this pilot, not claims about official NFT metadata.
// A production race resolves trusted token profiles before reading player plans.
export const PILOT_ABILITIES: Record<string, RacerAbility> = {
  dash: {
    id: "dash",
    name: "Dash",
    energyCost: 15,
    cooldownBeats: 1,
    targets: ["self"],
    capability: "A short burst along a connected course line.",
    limits: "No teleportation, flight shortcut or guaranteed pass."
  },
  shove: {
    id: "shove",
    name: "Shove",
    energyCost: 10,
    cooldownBeats: 1,
    targets: ["racer"],
    capability: "A gentle shoulder shove against a racer within reach.",
    limits: "Requires proximity; contact can cost the attacker momentum too."
  },
  pulse_bolt: {
    id: "pulse_bolt",
    name: "Pulse bolt",
    energyCost: 20,
    cooldownBeats: 1,
    targets: ["racer"],
    capability: "A visible short-range pulse aimed at another racer.",
    limits:
      "Visible windup and reachable firing path; local bolt cover applies."
  },
  vine_snare: {
    id: "vine_snare",
    name: "Vine snare",
    energyCost: 20,
    cooldownBeats: 1,
    targets: ["terrain"],
    capability:
      "Grow a small temporary vine tangle on a nearby planted verge or turf line.",
    limits:
      "No growth through bare stone, entire-course blockade or unavoidable trapping. Can be stepped over or bypassed; the creator can be snagged too."
  },
  wing_gust: {
    id: "wing_gust",
    name: "Wing gust",
    energyCost: 20,
    cooldownBeats: 1,
    targets: ["racer", "terrain"],
    capability:
      "A brief nearby gust from the fairy's wings can upset balance or move loose water or foliage.",
    limits:
      "No global storm, instant drying, flight shortcut, permanent shield or automatic knockdown."
  },
  water_splash: {
    id: "water_splash",
    name: "Water splash",
    energyCost: 20,
    cooldownBeats: 1,
    targets: ["racer", "terrain"],
    capability:
      "Splash a finite amount of water onto a nearby rival or a small reachable track patch.",
    limits:
      "Wet polished stone loses grip; turf absorbs water more quickly. No entire-island flood, instant ice or guaranteed slip. A wet patch affects any racer crossing it, including its creator."
  }
};
