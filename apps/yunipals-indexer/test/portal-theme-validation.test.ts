import { expect, it, vi } from "vitest";
import {
  assertSafePortalTheme,
  validatedThemeOutput
} from "../lib/portals/theme-validation.js";

const sources = ["1", "2", "3"].map((requestId) => ({ requestId }));
const safe = {
  title: "Guardians of starlight",
  brief:
    "Create a fierce protector. Blend living light with a surprising gesture!",
  contributions: sources.map((s) => ({
    ...s,
    inspiration: "Movement and luminous textures."
  }))
};

it("allows creative text and rejects links, markup, credentials and payment instructions in every public field", () => {
  expect(() => assertSafePortalTheme(safe)).not.toThrow();
  const bad = [
    "Visit https://example.invalid/claim",
    "Go to example.invalid",
    "Go to example[dot]invalid",
    "Go to example(.)invalid",
    "h t t p s : / / example.invalid",
    "<a href='x'>Hello</a>",
    "&lt;script&gt;",
    "[Prize](https://example.invalid)",
    "Connect your wallet",
    "Reveal your recovery phrase",
    "Sign a transaction for the prize",
    "Send 1 USDC",
    "Claim your reward",
    "0x1111111111111111111111111111111111111111",
    "Visit 192.0.2.1"
  ];
  for (const text of bad) {
    expect(() => assertSafePortalTheme({ ...safe, brief: text })).toThrow(
      "publication blocked"
    );
    expect(() => assertSafePortalTheme({ ...safe, title: text })).toThrow();
    expect(() =>
      assertSafePortalTheme({
        ...safe,
        contributions: safe.contributions.map((c) => ({
          ...c,
          inspiration: text
        }))
      })
    ).toThrow();
  }
});

it("rejects cached unsafe themes before signing and regenerates a safe output without changing winners", async () => {
  const progress: Record<string, unknown> = {
    output: { ...safe, brief: "Connect your wallet" },
    artifact: { hash: "old" }
  };
  const generate = vi.fn(async () => safe),
    save = vi.fn(async () => {});
  await expect(
    validatedThemeOutput(progress, sources, generate, save)
  ).rejects.toThrow("publication blocked");
  expect(generate).not.toHaveBeenCalled();
  expect(progress.output).toBeUndefined();
  expect(progress.artifact).toBeUndefined();
  expect(progress.themeValidationFailures).toBe(1);
  await expect(
    validatedThemeOutput(progress, sources, generate, save)
  ).resolves.toEqual(safe);
  expect(save).toHaveBeenCalledTimes(2);
});

it("caps rejected generations and retains any already submitted transaction for reconciliation", async () => {
  const progress: Record<string, unknown> = {};
  const generate = vi.fn(async () => ({
      ...safe,
      brief: "Visit example.invalid"
    })),
    save = vi.fn(async () => {});
  for (let i = 0; i < 3; i++)
    await expect(
      validatedThemeOutput(progress, sources, generate, save)
    ).rejects.toThrow();
  await expect(
    validatedThemeOutput(progress, sources, generate, save)
  ).rejects.toThrow("operator review");
  expect(generate).toHaveBeenCalledTimes(3);
  const sent = {
    output: { ...safe, brief: "Connect your wallet" },
    transaction: "saved-hash"
  };
  await expect(
    validatedThemeOutput(sent, sources, generate, save)
  ).rejects.toThrow();
  expect(sent.transaction).toBe("saved-hash");
  expect(sent.output).toBeDefined();
});
