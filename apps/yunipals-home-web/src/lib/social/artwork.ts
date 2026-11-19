export type MonsterArtwork = {
  portalVersion?: string;
  completedGrade?: boolean;
  name: string | null;
  image: string | null;
  attributes: Record<string, string>;
  status: "ready" | "queued" | "blocked" | "missing";
  holo: { foreground: string; background: string; stars: string } | null;
};
export function parseMonsterArtwork(
  metadata: unknown,
  assetUrl: (uri: string) => string | null
): MonsterArtwork {
  if (typeof metadata !== "object" || metadata === null)
    throw new Error("Invalid monster metadata.");
  const name =
    "name" in metadata && typeof metadata.name === "string"
      ? metadata.name.slice(0, 200)
      : null;
  const image =
    "image" in metadata && typeof metadata.image === "string"
      ? assetUrl(metadata.image)
      : null;
  const attributes: Record<string, string> = {};
  if ("attributes" in metadata && Array.isArray(metadata.attributes)) {
    for (const attribute of metadata.attributes) {
      if (typeof attribute !== "object" || attribute === null) continue;
      const label: unknown = attribute.trait_type;
      const value: unknown = attribute.value;
      if (
        typeof label === "string" &&
        (typeof value === "string" || typeof value === "number")
      )
        attributes[label.toLowerCase().slice(0, 100)] = String(value).slice(
          0,
          200
        );
    }
  }
  const extension =
    "yunipals" in metadata &&
    typeof metadata.yunipals === "object" &&
    metadata.yunipals !== null
      ? (metadata.yunipals as Record<string, unknown>)
      : null;
  const rawHolo = extension?.holo;
  let holo: MonsterArtwork["holo"] = null;
  if (rawHolo && typeof rawHolo === "object") {
    const value = rawHolo as Record<string, unknown>;
    const foreground =
      typeof value.foreground === "string" ? assetUrl(value.foreground) : null;
    const background =
      typeof value.background === "string" ? assetUrl(value.background) : null;
    const stars =
      typeof value.stars === "string" ? assetUrl(value.stars) : null;
    if (foreground && background && stars)
      holo = { foreground, background, stars };
  }
  const status: MonsterArtwork["status"] =
    extension?.status === "blocked"
      ? "blocked"
      : extension?.status === "queued"
        ? "queued"
        : extension?.status === "missing"
          ? "missing"
          : image
            ? "ready"
            : "missing";
  return {
    ...(typeof extension?.historyCount === "string" &&
    /^\d+$/.test(extension.historyCount)
      ? { completedGrade: extension.historyCount !== "0" }
      : {}),
    name,
    image,
    attributes,
    status,
    holo,
    ...(typeof extension?.version === "string" &&
    /^\d+$/.test(extension.version)
      ? { portalVersion: extension.version }
      : {})
  };
}

export function matchesPortalDeployment(
  deployment: { chainId: number; grading: string; cards: string } | null,
  expected: { chainId: number; grading: string; cards: string }
) {
  return Boolean(
    deployment &&
      deployment.chainId === expected.chainId &&
      deployment.grading.toLowerCase() === expected.grading.toLowerCase() &&
      deployment.cards.toLowerCase() === expected.cards.toLowerCase()
  );
}

export function selectMonsterArtwork(
  original: MonsterArtwork | undefined,
  graded: MonsterArtwork | undefined
) {
  return graded?.portalVersion !== "0" && graded?.image ? graded : original;
}
