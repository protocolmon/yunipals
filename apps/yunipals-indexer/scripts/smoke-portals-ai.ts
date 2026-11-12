/** One paid provider rehearsal. The operator supplies private credentials and an existing card PNG. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  portalModels,
  applyPortalOriginality,
  portalColorNames,
  type PortalAIContext
} from "@protopals/yunipals-market-core/portals";
import { OpenAIPortalAI } from "../lib/portals/provider.js";

async function main() {
  const input = process.env.PORTALS_SMOKE_INPUT_FILE,
    output = process.env.PORTALS_SMOKE_OUTPUT_DIRECTORY;
  if (!input || !output || !process.env.OPENAI_API_KEY)
    throw new Error(
      "Configure the private smoke input, output directory and existing API key."
    );
  const ai = new OpenAIPortalAI(process.env.OPENAI_API_KEY, portalModels);
  const baseColor = process.env.PORTALS_SMOKE_BASE_COLOR;
  if (!portalColorNames.some((color) => color === baseColor))
    throw new Error(
      "Set PORTALS_SMOKE_BASE_COLOR to the underlying card color."
    );
  const context: PortalAIContext = {
    portalKindId: process.env.PORTALS_SMOKE_PORTAL_KIND ?? "1",
    baseColor: baseColor as PortalAIContext["baseColor"]
  };
  const before = await readFile(input);
  const spell =
    "Add a small crown made of translucent violet stained-glass stars above the dragon's horn. Keep its friendly face, blue scales and card nameplate.";
  const embedding = await ai.embed(spell);
  const image = await ai.edit(spell, before, context);
  const finding = await ai.originality(spell, [
    {
      requestId: "1",
      submitter: "other",
      sameAuthor: false,
      similarity: 0.9,
      spell:
        "Give the dragon a crown of translucent violet stained-glass stars above its horn while keeping its friendly blue face."
    },
    {
      requestId: "2",
      submitter: "other",
      sameAuthor: false,
      similarity: 0.2,
      spell: "Make the background a snowy forest."
    }
  ]);
  const grade = await ai.grade(spell, before, image.bytes, context);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "after.png"), image.bytes, { flag: "wx" });
  const report = {
    portalContext: context,
    models: {
      image: image.model,
      originality: finding.model,
      grading: grade.model,
      embeddings: portalModels.embeddings
    },
    embeddingDimensions: embedding.length,
    baseScores: grade.scores,
    scores: applyPortalOriginality(grade.scores, finding, portalModels.copyCap),
    originality: finding,
    gradingReason: grade.reason,
    usage: { image: image.usage, grading: grade.usage }
  };
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2),
    { flag: "wx" }
  );
  console.log(JSON.stringify(report));
}
main().catch(() => {
  console.error(
    "Portal live AI rehearsal failed; credentials and private provider payloads were not logged."
  );
  process.exitCode = 1;
});
