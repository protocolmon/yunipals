import { createElement as el, type CSSProperties, type ReactNode } from "react";

import { PreviewBrand } from "./PreviewBrand";
import type { Preview } from "./resolve";

type PreviewDetails = Pick<Preview, "name" | "subtitle" | "traits" | "state">;
const palettes: Record<string, [string, string]> = {
  green: ["#def2df", "#abc9aa"],
  blue: ["#dcecf9", "#a4bfdc"],
  red: ["#f9dfdf", "#dfa8aa"],
  yellow: ["#fbefce", "#d9c38b"],
  purple: ["#eadff8", "#c0a5dd"],
  black: ["#e4e2ee", "#a6a0be"]
};

export function CollectiblePreview({
  preview,
  image,
  logo
}: {
  preview: PreviewDetails;
  image: string;
  logo: string;
}) {
  const color = preview.traits
    .find((trait) => trait.toLowerCase().startsWith("color:"))
    ?.split(":")[1]
    .trim()
    .toLowerCase();
  const [wash, accent] = palettes[color ?? ""] ?? palettes.purple;
  const title = preview.name.slice(0, 100);
  const traits = preview.traits.filter(
    (trait) => !trait.toLowerCase().startsWith("type:")
  );
  const box = (style: CSSProperties, ...children: ReactNode[]) =>
    el("div", { style: { display: "flex", ...style } }, ...children);

  return box(
    {
      width: 1200,
      height: 630,
      position: "relative",
      overflow: "hidden",
      backgroundColor: "#faf8f4",
      color: "#302343",
      fontFamily: "Inter"
    },
    box({
      position: "absolute",
      right: 0,
      top: 0,
      width: 596,
      height: 630,
      background: `linear-gradient(145deg, ${wash}, #f4f0fa)`
    }),
    box({
      position: "absolute",
      width: 680,
      height: 680,
      right: -65,
      top: -25,
      border: `1px solid ${accent}`,
      borderRadius: 340,
      opacity: 0.4
    }),
    box(
      {
        position: "absolute",
        left: 52,
        top: 36
      },
      PreviewBrand({ logo })
    ),
    box(
      {
        position: "absolute",
        left: 52,
        top: title.length > 48 ? 150 : 184,
        width: 480,
        flexDirection: "column"
      },
      box(
        { fontSize: 15, letterSpacing: 3, color: "#82748e", marginBottom: 20 },
        "A LITTLE WORLD OF WONDER"
      ),
      box(
        {
          fontFamily: "Archivo",
          fontSize: title.length > 64 ? 34 : title.length > 32 ? 44 : 64,
          lineHeight: 1.08,
          letterSpacing: -2,
          maxHeight: 160,
          overflow: "hidden"
        },
        title
      ),
      box(
        {
          marginTop: 20,
          fontSize: 20,
          lineHeight: 1.45,
          color: "#776a80",
          maxHeight: 60,
          overflow: "hidden"
        },
        preview.subtitle.slice(0, 130)
      ),
      box(
        { gap: 10, marginTop: 28, flexWrap: "wrap" },
        ...traits.slice(0, 3).map((trait) => {
          const separator = trait.indexOf(":");
          const label = separator < 0 ? "Trait" : trait.slice(0, separator);
          const value =
            separator < 0 ? trait : trait.slice(separator + 1).trim();
          return box(
            {
              flexDirection: "column",
              padding: "12px 16px",
              border: "1px solid #e7e0eb",
              borderRadius: 16,
              backgroundColor: "#ffffff",
              maxWidth: 225
            },
            box(
              { fontSize: 12, color: "#8a7d93", marginBottom: 5 },
              label.toUpperCase()
            ),
            box({ fontSize: 18, color: "#493456" }, value.slice(0, 32))
          );
        })
      )
    ),
    box(
      {
        position: "absolute",
        left: 52,
        bottom: 44,
        alignItems: "center",
        gap: 12,
        fontSize: 17,
        color: "#6b567f"
      },
      box({ width: 28, height: 2, backgroundColor: accent }),
      "Discover your next pal"
    ),
    box(
      {
        position: "absolute",
        right: 40,
        top: 43,
        width: 544,
        height: 544,
        boxSizing: "border-box",
        padding: 8,
        backgroundColor: "#ffffff",
        border: "1px solid #ffffff",
        borderRadius: 32,
        boxShadow: "0 18px 36px #3023431a"
      },
      el("img", {
        src: image,
        width: 526,
        height: 526,
        style: {
          objectFit: "contain",
          borderRadius: 24,
          backgroundColor: wash
        }
      })
    ),
    ...(preview.state === "pending"
      ? [
          box(
            {
              position: "absolute",
              right: 62,
              bottom: 60,
              padding: "8px 12px",
              borderRadius: 12,
              backgroundColor: "#ffffff",
              color: "#776a80",
              fontSize: 14
            },
            "Preview artwork"
          )
        ]
      : [])
  );
}
