/** Capture semantic before/after review frames. Offline only; no provider calls. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { prepareFixture } from "../../apps/yunipals-anime-engine/fixture.mjs";
import { withFilm } from "../../apps/yunipals-anime-engine/render.mjs";

const output = resolve(process.argv[2] ?? "");
if (!output.startsWith("/tmp/"))
  throw new Error("Use a private temporary review directory.");
await mkdir(output, { recursive: true });
const report = { version: "anime-engine-frame-review/v1", variants: {} };
for (const variant of ["manual", "automated"]) {
  const job = join(output, variant);
  await mkdir(job);
  await prepareFixture(job);
  if (variant === "automated")
    await writeFile(
      join(job, "assets/choreography.json"),
      await readFile(
        new URL(
          "../../apps/yunipals-anime-engine/fixtures/automated-choreography.json",
          import.meta.url
        )
      )
    );
  report.variants[variant] = await withFilm(
    job,
    async ({ frame, info, lock }) => {
      const frames = [];
      for (const chapter of info.chapters) {
        for (const [name, t] of [
          ["ready", chapter.t + 7.7],
          ["first-contact", chapter.events[0].contact + 0.04],
          ["reply", chapter.events[1].contact + 0.04],
          ["winner", chapter.winnerAt + 1]
        ]) {
          const filename = `${chapter.id}-${name}.png`,
            bytes = await frame(t, true);
          await writeFile(join(job, filename), bytes);
          frames.push({
            name: filename,
            t,
            sha256: createHash("sha256").update(bytes).digest("hex")
          });
        }
      }
      return {
        engineVersion: lock.version,
        engineSha256: lock.sha256,
        duration: info.duration,
        frames,
        tournamentSha256: createHash("sha256")
          .update(await readFile(join(job, "assets/tournament.json")))
          .digest("hex")
      };
    }
  );
}
await writeFile(
  join(output, "review.json"),
  JSON.stringify(report, null, 2) + "\n"
);
console.log(
  JSON.stringify({
    output,
    variants: Object.keys(report.variants),
    frames: 24,
    providerCalls: 0
  })
);
