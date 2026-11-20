import type { CSSProperties } from "react";

// Reviewed silhouettes for immutable published artwork with opaque exteriors.
// Match the content hash, not a token ID: other artwork versions keep their
// own alpha and cannot accidentally inherit a different card's outline.
const cutouts: Record<string, string> = {
  "9ea54ee68b81f02f6606e7a5f2ffbc43f080d80d48f6617737677700bce8dad3":
    "/images/card-effects/prismane-cursebreaker-cutout.svg"
};

export function cardArtworkCutoutStyle(
  image: string | null | undefined,
  cutout?: string
): CSSProperties | undefined {
  const hash = image?.match(/(?:^|\/)([a-f0-9]{64})\.png(?:[?#].*)?$/i)?.[1];
  const mask = cutout ?? (hash && cutouts[hash.toLowerCase()]);
  return mask
    ? ({
        "--card-artwork-cutout": `url(${JSON.stringify(mask)})`
      } as CSSProperties)
    : undefined;
}
