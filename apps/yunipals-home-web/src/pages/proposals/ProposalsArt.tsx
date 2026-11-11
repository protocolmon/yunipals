import { Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import "./proposals-art.css";

const SKETCH: readonly { d: string; color: string; width?: number }[] = [
  // Pack outline with crimped ends.
  {
    d: "M120 92 l10 -10 10 10 10 -10 10 10 10 -10 10 10 10 -10 10 10 10 -10 10 10 10 -10 10 10 V308 l-10 10 -10 -10 -10 10 -10 -10 -10 10 -10 -10 -10 10 -10 -10 -10 10 -10 -10 -10 10 -10 -10Z",
    color: "#0d1526",
    width: 4
  },
  { d: "M120 118 H240 M120 282 H240", color: "#0d1526" },
  // Star on the pack.
  {
    d: "M180 150 l12 30 32 2 -25 20 9 32 -28 -18 -28 18 9 -32 -25 -20 32 -2Z",
    color: "#7e22ce",
    width: 4
  },
  // Arrow and note, right side.
  {
    d: "M330 96 C300 92 276 108 258 136 M258 136 l2 -18 M258 136 l17 -5",
    color: "#4f46e5"
  },
  { d: "M300 62 h62 M300 76 h44", color: "#4f46e5" },
  // Lightbulb doodle, left side.
  {
    d: "M58 196 a26 26 0 1 1 30 0 v12 h-30Z M62 218 h22 M66 228 h14 M73 148 v-12 M40 160 l-9 -8 M106 160 l9 -8",
    color: "#b13bff"
  },
  // Dimension line and scribbled underline.
  {
    d: "M268 300 v-190 M260 118 l8 -10 8 10 M260 292 l8 10 8 -10",
    color: "#22d3ee"
  },
  {
    d: "M96 350 c20 -12 34 10 54 0 s34 10 54 0 34 10 54 0 34 8 46 2",
    color: "#7e22ce",
    width: 4
  }
];

/**
 * Decorative illustration for the proposals catalog header: a sketchbook page
 * where a pack concept draws itself, stroke by stroke.
 */
export function ProposalsArt({ className }: { className?: string }) {
  return (
    <div className={cn("pa-art", className)} aria-hidden="true">
      <div className="pa-paper absolute inset-[4%] -rotate-3 rounded-card shadow-cardHover">
        <svg className="pa-canvas" viewBox="0 0 400 400">
          {SKETCH.map((stroke, index) => (
            <path
              key={index}
              className="pa-draw"
              pathLength={1}
              d={stroke.d}
              stroke={stroke.color}
              strokeWidth={stroke.width ?? 3}
              style={{ animationDelay: `${index * 0.45}s` }}
            />
          ))}
        </svg>
      </div>
      <span className="pa-bob absolute bottom-[8%] right-[6%] grid h-[16cqw] w-[16cqw] place-items-center rounded-full bg-grape text-white shadow-cardHover">
        <Pencil className="h-1/2 w-1/2" />
      </span>
    </div>
  );
}
