export type AnimeKitChoice = {
  id: string;
  name: string;
  kind: "projectile" | "strike" | "dash";
  description?: string;
};
export function compatibleAnimeKit(kit: AnimeKitChoice, kind: string): boolean;
export function resolveAnimeKit(
  attackName: string,
  kind: string,
  loadout?: readonly AnimeKitChoice[],
  selected?: string | null
): AnimeKitChoice | undefined;
