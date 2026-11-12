/** One offchain extraction from the independently verified eleven-card rehearsal. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { keccak256, toHex } from "viem";
import { z } from "zod";
import {
  portalModels,
  stablePortalJson
} from "@protopals/yunipals-market-core/portals";
import { OpenAIPortalAI } from "../lib/portals/provider.js";

async function main() {
  const resultsFile = process.env.PORTALS_THEME_RESULTS_FILE;
  const proofFile = process.env.PORTALS_THEME_PROOF_FILE;
  const outputFile = process.env.PORTALS_THEME_OUTPUT_FILE;
  if (!resultsFile || !proofFile || !outputFile)
    throw new Error(
      "Configure private results, verification and output files."
    );
  const results = z
    .array(
      z.object({
        ordinal: z.number().int().positive(),
        spell: z.string().min(1),
        result: z.object({
          scores: z.array(z.number().int().min(1).max(100)).length(4),
          artwork: z.object({ hash: z.string() }),
          reportHash: z.string()
        })
      })
    )
    .length(11)
    .parse(JSON.parse(await readFile(resultsFile, "utf8")));
  const proof = z
    .object({
      chainId: z.literal(84532),
      batchSize: z.literal(11),
      realGrades: z.literal(11),
      rankings: z
        .array(
          z.object({
            entry: z.string(),
            score: z.number(),
            artwork: z.string()
          })
        )
        .length(11)
    })
    .parse(JSON.parse(await readFile(proofFile, "utf8")));
  const ordered = [...results].sort(
    (a, b) =>
      b.result.scores.reduce((sum, n) => sum + n, 0) -
        a.result.scores.reduce((sum, n) => sum + n, 0) || a.ordinal - b.ordinal
  );
  if (
    new Set(results.map((row) => row.ordinal)).size !== 11 ||
    ordered.some((row, index) => {
      const expected = proof.rankings[index];
      return (
        expected.entry !== String(row.ordinal) ||
        expected.score !== row.result.scores.reduce((sum, n) => sum + n, 0) ||
        expected.artwork !== row.result.artwork.hash
      );
    })
  )
    throw new Error("Results differ from the independently verified ranking.");
  const sources = ordered.slice(0, 3).map((row) => ({
    requestId: String(row.ordinal),
    spell: row.spell,
    reportHash: row.result.reportHash
  }));
  const policy = portalModels.competitionThemes;
  const inputHash = keccak256(toHex(stablePortalJson({ sources, policy })));
  let saved: { inputHash: string; output: unknown } | undefined;
  try {
    saved = JSON.parse(await readFile(outputFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (saved) {
    if (saved.inputHash !== inputHash) throw new Error("Saved inputs differ.");
    console.log(JSON.stringify({ reused: true, ...saved }));
    return;
  }
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        execute: false,
        inputHash,
        winners: sources.map((s) => s.requestId),
        model: policy.model
      })
    );
    return;
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("The authorized provider key is unavailable.");
  const output = await new OpenAIPortalAI(key, portalModels).theme(sources);
  const report = {
    inputHash,
    sources,
    policy,
    output,
    verifiedAt: new Date().toISOString(),
    onchainPublication: false
  };
  await mkdir(dirname(outputFile), { recursive: true, mode: 0o700 });
  await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600
  });
  console.log(JSON.stringify({ inputHash, output, onchainPublication: false }));
}

main().catch(() => {
  console.error(
    "Theme extraction failed; credentials and private provider payloads were not logged."
  );
  process.exitCode = 1;
});
