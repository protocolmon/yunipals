export class UnsafePortalThemeError extends Error {
  constructor() {
    super(
      "Theme publication blocked: use plain creative text without links, markup or account/payment instructions."
    );
  }
}

type ThemeText = {
  title: string;
  brief: string;
  contributions: { requestId: string; inspiration: string }[];
};

/** A small deterministic publication check, independent of the model's instructions. */
export function assertSafePortalTheme(value: ThemeText) {
  const fields = [
    [value?.title, 96],
    [value?.brief, 768],
    ...(Array.isArray(value?.contributions)
      ? value.contributions.map((c) => [c?.inspiration, 1000])
      : [])
  ] as const;
  if (!Array.isArray(value?.contributions) || value.contributions.length !== 3)
    throw new UnsafePortalThemeError();
  for (const [text, maximum] of fields) {
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > Number(maximum) ||
      !/^[\x20-\x7e]+$/.test(text)
    )
      throw new UnsafePortalThemeError();
    const compact = text.replace(/\s+/g, "");
    if (
      /[<>`@]|&(?:#\d+|#x[\da-f]+|[a-z]+);|\]\s*\(/i.test(text) ||
      /\b(?:https?|hxxps?|ftp|ipfs|javascript|data|mailto|wc):|www\./i.test(
        compact
      ) ||
      /\b[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,63}\b/i.test(text) ||
      /\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)/i.test(text) ||
      /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b0x[a-f\d]{40}\b/i.test(text) ||
      /\b(?:wallets?|passwords?|passcodes?|mnemonic|login)\b|\b(?:seed|recovery)\s+phrase\b|\bprivate\s+keys?\b|\b(?:log|sign)\s+in\b/i.test(
        text
      ) ||
      /\b(?:send|pay|transfer|deposit|approve|authorize|sign)\b.{0,80}\b(?:usdc|eth|crypto|tokens?|payments?|transactions?|allowances?|fees?|funds|signatures?)\b/i.test(
        text
      ) ||
      /\b(?:claim|redeem)\b.{0,60}\b(?:prizes?|rewards?|airdrops?)\b/i.test(
        text
      )
    )
      throw new UnsafePortalThemeError();
  }
}

/** Revalidate saved model output as well as new output. Never replace a submitted theme. */
export async function validatedThemeOutput<T extends ThemeText>(
  progress: Record<string, unknown>,
  sources: { requestId: string }[],
  generate: () => Promise<T>,
  save: () => Promise<void>
): Promise<T> {
  const failures = Number(progress.themeValidationFailures ?? 0);
  if (failures >= 3)
    throw new Error(
      "Theme needs operator review after three rejected outputs."
    );
  try {
    const output = (progress.output ?? (await generate())) as T;
    assertSafePortalTheme(output);
    if (
      new Set(output.contributions.map((c) => c.requestId)).size !== 3 ||
      output.contributions.some(
        (c) => !sources.some((s) => s.requestId === c.requestId)
      )
    )
      throw new UnsafePortalThemeError();
    progress.output = output;
    await save();
    return output;
  } catch (error) {
    if (error instanceof UnsafePortalThemeError) {
      // A previously broadcast transaction must be reconciled, never discarded/replaced.
      if (!progress.transaction) {
        delete progress.output;
        delete progress.artifact;
      }
      progress.themeValidationFailures = progress.transaction
        ? 3
        : failures + 1;
      await save();
    }
    throw error;
  }
}
