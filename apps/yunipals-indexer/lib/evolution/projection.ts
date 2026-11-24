export type EvolutionDomain = "card" | "job" | "adventure";
export interface EvolutionProjectionStore {
  get(
    domain: EvolutionDomain,
    id: string
  ): Promise<Record<string, unknown> | null>;
  put(
    domain: EvolutionDomain,
    id: string,
    value: Record<string, unknown>
  ): Promise<void>;
}
/** Event-only reducer; no AI, side effects or independent log ingestion. */
export async function applyEvolutionEvent(
  store: EvolutionProjectionStore,
  name: string,
  a: Record<string, unknown>
) {
  const update = async (
    domain: EvolutionDomain,
    id: string,
    patch: Record<string, unknown>
  ) => {
    await store.put(domain, id, {
      ...((await store.get(domain, id)) ?? {}),
      ...patch
    });
  };
  const token = String(a.tokenId);
  const request = String(a.requestId);
  if (name === "AdventureRequested") {
    await update("adventure", request, { ...a, settled: false });
    await update("card", token, {
      pendingAdventure: request,
      nextAdventureAt: a.nextAdventureAt
    });
  } else if (name === "AdventureSettled") {
    await update("adventure", request, { ...a, settled: true });
    await update("card", token, {
      pendingAdventure: null,
      ...(Number(a.serumId)
        ? {
            unused: {
              catalogueVersion: a.catalogueVersion,
              serumId: a.serumId,
              presenceId: a.presenceId
            }
          }
        : {})
    });
  } else if (name === "SerumCleared") {
    await update("card", token, { unused: null });
  } else if (name === "AdventureStateInherited") {
    await update("card", token, {
      unused: null,
      nextAdventureAt: a.nextAdventureAt
    });
  } else if (name === "EvolutionRequested") {
    await update("job", request, {
      ...a,
      status: String(a.randomnessId) === "0" ? "generating" : "randomness"
    });
    for (const parent of [a.parentA, a.parentB].filter(
      (v) => String(v) !== "0"
    ))
      await update("card", String(parent), { pendingEvolution: request });
  } else if (name === "EvolutionFeeReserved") {
    await update("job", request, {
      fee: String(a.fee),
      sponsored: String(a.fee) === "0",
      sponsoredSerumsUsed: String(a.sponsoredSerumsUsed)
    });
  } else if (name === "FinishAssigned") {
    await update("card", token, { finish: a.finish });
  } else if (
    name === "FusionPresenceSettled" ||
    name === "EvolutionRandomnessSettled"
  ) {
    await update("job", request, { ...a, status: "generating" });
  } else if (name === "EvolutionCompleted") {
    const job = await store.get("job", request);
    if (!job) throw new Error("Evolution completion without request.");
    for (const parent of [job.parentA, job.parentB].filter(
      (v) => String(v) !== "0" && String(v) !== token
    ))
      await update("card", String(parent), { pendingEvolution: null });
    const previous = await store.get("card", token);
    const doses = (previous?.doses ?? []) as unknown[];
    await update("card", token, {
      ...a,
      pendingEvolution: null,
      doses:
        String(job.parentB) === "0"
          ? [
              ...doses,
              {
                catalogueVersion: job.catalogueVersion,
                serumId: job.serumId,
                presenceId: job.presenceId
              }
            ]
          : []
    });
    await update("job", request, { status: "completed", resultTokenId: token });
  } else if (name === "FusionMinted") {
    await update("card", token, {
      ...a,
      owner: String(a.recipient).toLowerCase(),
      burned: false
    });
    for (const parent of [a.parentA, a.parentB])
      await update("card", String(parent), { burned: true, owner: null });
  } else if (name === "CardReserved") {
    await update("card", token, {
      reservedBy: a.controller,
      transferLocked: a.transferLocked
    });
  } else if (name === "CardReleased") {
    await update("card", token, { reservedBy: null, transferLocked: false });
  }
}
