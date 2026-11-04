import { boosterAssetUrl } from "@/lib/boosters";

export function boosterArtworkPreviewUrl(image: string | null): string | null {
  const safeUrl = image && boosterAssetUrl(image);
  if (!safeUrl) return null;
  const url = new URL(safeUrl);
  const match = /\/v1\/boosters\/art-assets\/([a-f0-9]{64})\.png$/.exec(
    url.pathname
  );
  if (!match || url.search || url.hash) return null;
  url.pathname = url.pathname.replace(
    /\/art-assets\/[^/]+$/,
    `/art-previews/v1/${match[1]}.webp`
  );
  return url.href;
}
