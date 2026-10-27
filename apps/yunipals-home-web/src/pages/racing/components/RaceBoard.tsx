import { useId } from "react";

import type { IslandId } from "@/lib/racing/islands";
import { RACERS, type RaceBeat } from "@/lib/racing/llmRace";

// Display coordinates only. Progress, protection, actions and outcomes come
// from the LLM record; this renderer performs no racing or combat simulation.
export function RaceBoard({
  beat,
  islandId
}: {
  beat: RaceBeat;
  islandId: IslandId;
}) {
  const id = useId().replace(/:/g, "");
  const meadow = islandId === "C01";
  return (
    <svg
      viewBox="0 0 800 480"
      className="block w-full"
      role="img"
      aria-label="Schematic replay of positions supplied by the LLM"
    >
      <defs>
        <clipPath id={`${id}-racer-thumbnail`}>
          <circle r="24" />
        </clipPath>
        <radialGradient id={`${id}-sky`}>
          <stop stopColor={meadow ? "#28585c" : "#35304f"} />
          <stop offset="1" stopColor="#0d1526" />
        </radialGradient>
        <linearGradient id={`${id}-rock`} x2="0" y2="1">
          <stop stopColor="#716d94" />
          <stop offset="1" stopColor="#1c2340" />
        </linearGradient>
      </defs>
      <rect width="800" height="480" fill={`url(#${id}-sky)`} />
      <ellipse
        cx="400"
        cy="427"
        rx="260"
        ry="23"
        fill="#060d1c"
        opacity="0.6"
      />
      <path
        d="M 74 260 Q 85 413 275 410 L 355 459 L 475 414 Q 705 416 726 258 Z"
        fill={`url(#${id}-rock)`}
      />
      <ellipse
        cx="400"
        cy="240"
        rx="335"
        ry="174"
        fill={meadow ? "#accb99" : "#aaa2c4"}
      />
      <ellipse
        cx="400"
        cy="240"
        rx="275"
        ry="120"
        fill="none"
        stroke={meadow ? "#f1e5bf" : "#e0d7ef"}
        strokeWidth="34"
      />
      <ellipse
        cx="400"
        cy="240"
        rx="275"
        ry="120"
        fill="none"
        stroke="#a7a4b9"
        strokeWidth="1.5"
        strokeDasharray="5 12"
      />
      {!meadow && (
        <path
          d="M 305 128 Q 480 60 640 175 M 305 350 Q 480 420 640 305"
          fill="none"
          stroke={islandId === "R04" ? "#64768b" : "#897da7"}
          strokeWidth="23"
          strokeDasharray="9 3"
        />
      )}
      {islandId === "M02" && (
        <path
          d="M 563 146 L 610 169"
          stroke="#c4a677"
          strokeWidth="26"
          strokeDasharray="4 3"
        />
      )}
      <g transform="translate(400,240)">
        {meadow ? (
          <path
            d="M -12 5 C -50 -15 -28 -44 -6 -23 C 8 -59 35 -41 24 -15 C 65 -20 49 20 15 18 C 5 56 -22 45 -18 22 C -56 31 -59 1 -12 5 Z"
            fill="#cdf6cf"
          />
        ) : islandId === "R04" ? (
          <>
            <path
              d="M -27 22 L -27 -30 Q 0 -66 27 -30 L 27 22"
              fill="none"
              stroke="#ded5c6"
              strokeWidth="15"
            />
            <path d="M -12 13 L 0 -47 L 12 13 Z" fill="#b3e7f5" />
          </>
        ) : (
          <>
            <circle r="32" fill="#37356f" />
            <ellipse
              rx="60"
              ry="18"
              fill="none"
              stroke="#dac28c"
              strokeWidth="7"
              transform="rotate(-25)"
            />
            <ellipse
              rx="18"
              ry="54"
              fill="none"
              stroke="#dac28c"
              strokeWidth="7"
            />
          </>
        )}
        <text
          y="77"
          textAnchor="middle"
          fill="#0d1526"
          fontSize="13"
          fontWeight="700"
        >
          {meadow
            ? "EXPOSED STRAIGHTS"
            : islandId === "R04"
              ? "ROTATING PRISMS"
              : "ECLIPSE ORRERY"}
        </text>
      </g>
      {beat.racers.map((state) => {
        const index = RACERS.findIndex((racer) => racer.id === state.id);
        const profile = RACERS[index];
        const angle =
          -Math.PI / 2 + ((state.progress % 33.3333) / 33.3333) * Math.PI * 2;
        const outer = ["shelter", "shadow", "lower"].includes(state.route)
          ? 22
          : 0;
        const x =
          state.status === "finished"
            ? 325 + index * 75
            : 400 + Math.cos(angle) * (275 + outer);
        const y =
          state.status === "finished"
            ? 425
            : 240 + Math.sin(angle) * (120 + outer);
        return (
          <g key={state.id} transform={`translate(${x},${y})`}>
            {state.status === "protected" && (
              <circle
                r="25"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="3"
                strokeDasharray="4 4"
              />
            )}
            <title>
              {profile.name}: {profile.species} Yunipal racer
            </title>
            <image
              href={profile.image}
              x="-24"
              y="-24"
              width="48"
              height="48"
              clipPath={`url(#${id}-racer-thumbnail)`}
            />
            <circle r="24" fill="none" stroke={profile.color} strokeWidth="3" />
            <text
              y={-36 - index * 13}
              textAnchor="middle"
              fill="white"
              fontSize="13"
              fontWeight="700"
              paintOrder="stroke"
              stroke="#0d1526"
              strokeWidth="3"
            >
              {profile.name}
            </text>
            {state.ability !== "none" && (
              <text
                y="36"
                textAnchor="middle"
                fill="#fde68a"
                fontSize="11"
                fontWeight="700"
              >
                {state.ability.replace("pulse_", "").toUpperCase()}
              </text>
            )}
          </g>
        );
      })}
      <text x="400" y="469" textAnchor="middle" fill="#b3e7f5" fontSize="12">
        LLM-reported positions · schematic course · 3 laps
      </text>
    </svg>
  );
}
