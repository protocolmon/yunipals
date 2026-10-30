/** Shared browser/server selection. Kits change presentation only. */
export function compatibleAnimeKit(kit, kind) {
  return (
    kit.kind ===
    (kind === "dash"
      ? "dash"
      : kind === "vine"
        ? "strike"
        : ["star", "jet", "orb"].includes(kind)
          ? "projectile"
          : null)
  );
}
export function resolveAnimeKit(attackName, kind, loadout = [], selected) {
  if (selected !== undefined && selected !== null) {
    const kit = loadout.find((k) => k.id === selected);
    if (!kit || !compatibleAnimeKit(kit, kind))
      throw new Error(
        "Attack kit is outside the actor's loadout or incompatible with the event."
      );
    return kit;
  }
  const name = attackName.trim().toUpperCase();
  return (
    loadout.find(
      (k) => k.name.toUpperCase() === name && compatibleAnimeKit(k, kind)
    ) ?? loadout.find((k) => compatibleAnimeKit(k, kind))
  );
}
