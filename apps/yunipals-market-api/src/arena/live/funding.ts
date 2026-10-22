export type ArenaOpenaiFundingMode = "capped" | "ongoing";

/** Ongoing operation is an explicit operator choice. Capped/expired remains the
 * default for new installations and preserves the original pilot controls. */
export function arenaOpenaiFundingMode(
  env: NodeJS.ProcessEnv = process.env
): ArenaOpenaiFundingMode {
  const mode = env.ARENA_OPENAI_FUNDING_MODE ?? "capped";
  if (mode !== "capped" && mode !== "ongoing")
    throw new Error("Invalid Arena OpenAI funding mode.");
  return mode;
}
