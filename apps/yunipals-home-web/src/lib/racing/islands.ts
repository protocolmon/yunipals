export type IslandId = "C01" | "R04" | "M02";

export type TestIsland = {
  id: IslandId;
  name: string;
  rarity: string;
  image: string;
  traits: string[];
  question: string;
  resident: string;
  rules: string[];
  prompts: [string, string, string];
};

export const TEST_ISLANDS: TestIsland[] = [
  {
    id: "C01",
    name: "Cloverloop Meadow",
    rarity: "Common · Mint",
    image: "/images/island-pilot-v2/c01-cloverloop-meadow-v1-resident-v2.png",
    traits: ["Long straights", "Firm turf", "Exposed"],
    question: "Spend energy on an attack, or keep your momentum?",
    resident:
      "The Guide points out the next bend. Everyone sees the same course cue.",
    rules: [
      "Two long exposed straights connect through broad bends into a three-lap circuit. Firm turf has reliable grip. There is no magical landmark or protected detour.",
      "A racer can gain on a straight by dashing, but repeated bursts consume energy needed for later attacks or the final lap. Winding up an attack briefly gives up momentum.",
      "Rivals can weave to spoil a shot, feint a windup, draft visibly behind another racer, or shove at close range. These actions have position, energy or time costs.",
      "The mint Guide points out the approaching bend to everyone. It does not grant extra speed or obey player commands."
    ],
    prompts: [
      "Stay close enough to pressure the leader on the straights. Feint a bolt before committing, and use a short dash to pass when they dodge. If they keep weaving, save energy and take a cleaner line rather than wasting repeated shots.",
      "Let the others spend energy fighting early. Draft behind a visible rival without following them into a collision, use the wide bend when crowded, and keep enough energy for a final-lap dash. Sabotage only when it creates a passing opportunity.",
      "Try to lead from the start. Attack the closest pursuer when they threaten a pass, but avoid stopping to fight. If I lose the lead, pressure the new leader at the next bend exit."
    ]
  },
  {
    id: "R04",
    name: "Prismgate Reliquary",
    rarity: "Rare · Amethyst",
    image: "/images/island-pilot-v2/r04-prismgate-reliquary-v1-resident-v1.png",
    traits: ["Rotating prisms", "Slick stone", "Sheltered corridor"],
    question: "Bank a shot around the gate, or trade time for shelter?",
    resident:
      "The Trickster operates the visible prism cycle. Each bolt can reflect only once.",
    rules: [
      "Two wet stone straights join broad bends. Each straight has a rotating prism gate. The covered outer corridor is longer and connects back to the open course at a visible exit.",
      "A pulse bolt may reflect once from a currently aligned prism face, including around a gate that obstructs a direct shot. There must be a plausible visible firing path. A reflection is not an automatic hit, and recursive reflections are forbidden.",
      "The corridor blocks incoming and outgoing bolts while the racer is inside. Racers give up time and some attack opportunities to use it. Rivals can position themselves to intercept its exit.",
      "Rain makes tight turns on slick stone risky. A wider line or early braking costs time but provides more reliable grip. The amethyst Trickster operates and visibly signals the prism rotation; racers cannot command it."
    ],
    prompts: [
      "Use the prism to threaten a bank shot, then read the rival's response. If they flee into shelter, keep moving and intercept the exit. Only fire a reflected bolt when the current angle can actually reach them. Brake early on wet turns.",
      "Use the corridor when a visible attack threatens me, not simply because shelter exists. Leave quickly once the shot passes. If the exit is being watched, delay briefly or rejoin behind another racer rather than running into the ambush.",
      "Take the open line and keep pressure on the leader. Avoid firing into a rotating gate blindly. Try a close shove before the slick bend when reachable, then use the confusion to pass."
    ]
  },
  {
    id: "M02",
    name: "Umbra Orrery",
    rarity: "Mythic · Midnight Opal",
    image: "/images/island-pilot-v2/m02-umbra-orrery-v1-resident-v1.png",
    traits: ["Moving shadow", "Crumbling bridge", "Slick stone"],
    question: "Follow local protection, or take a faster exposed route?",
    resident:
      "The Guardian tends the shadow. Only the marked branch inside its moving sector blocks bolts.",
    rules: [
      "A three-lap terraced loop has rolling climbs, slick stone, one elevated crumbling bridge shortcut, and a connected stable lower route. The stable route is longer. A bridge warning is visible before failure; a closed bridge cannot be crossed.",
      "The orrery casts a moving, visibly marked shadow across sections of the longer route. A racer is protected from incoming pulse bolts only while physically inside the active shadow sector. Merely selecting the shadow route gives no permanent shield.",
      "The shadow keeps moving. Following it can require slowing down or giving up the bridge shortcut. Rivals can wait beyond its edge or pressure a future exit. Local bolt protection does not prevent a legal close shove.",
      "Wind and terrace climbs can alter passing opportunities and make a poorly timed shove or exposed dash costly. These conditions affect all racers. The midnight opal Guardian tends the visible shadow; it cannot be attacked, captured or commanded."
    ],
    prompts: [
      "Follow the shadow while a visible bolt threatens me, but do not sacrifice an entire lap just to stay protected. Watch for a rival camping its exit and leave on a different reachable line. Skip a warning bridge and preserve energy for a clear final climb.",
      "Take the bridge when its cue is safe and no visible rival can shove me at the landing. Attack the leader just after they leave the shadow. If the bridge warns, use the lower route rather than betting the race on a collapse.",
      "Pressure whoever leads. Threaten the shadow exit so they have to slow down, then use the stable route to pass when they hesitate. Do not waste bolts on a protected target; switch to a close shove only if I can actually reach them."
    ]
  }
];
