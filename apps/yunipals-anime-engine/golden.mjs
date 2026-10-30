import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareFixture } from "./fixture.mjs";
import { withFilm } from "./render.mjs";
const job = await mkdtemp(join(tmpdir(), "anime-golden-"));
try {
  await prepareFixture(job);
  const automated = process.argv.includes("--automated");
  if (automated)
    await writeFile(
      join(job, "assets/choreography.json"),
      await readFile(
        new URL("./fixtures/automated-choreography.json", import.meta.url)
      )
    );
  const actual = await withFilm(job, async ({ page, frame, info, lock }) => {
    const text = await page.evaluate(
      ({ readyAt, resultAt }) => {
        const ctx = document.getElementById("c").getContext("2d");
        const fillText = ctx.fillText;
        const labels = [];
        ctx.fillText = function (value, ...args) {
          labels.push(String(value));
          return fillText.call(this, value, ...args);
        };
        try {
          YunipalsFilm.drawFrame(ctx, readyAt);
          YunipalsFilm.drawFrame(ctx, resultAt);
        } finally {
          ctx.fillText = fillText;
        }
        return { encoding: document.characterSet, labels };
      },
      {
        readyAt: info.chapters[0].t + 7.7,
        resultAt: info.chapters[0].winnerAt + 2.5
      }
    );
    assert.equal(text.encoding, "UTF-8");
    assert.ok(
      text.labels.includes("READY…"),
      "Ready label must retain its ellipsis"
    );
    assert.ok(
      text.labels.includes("→ advances to the Grand Final"),
      "Winner label must retain its arrow"
    );
    assert.ok(
      text.labels.some((label) => label.includes("  •  ")),
      "Result label must retain its bullet"
    );
    const frames = [];
    for (let i = 0; i < 12; i++)
      frames.push(
        createHash("sha256")
          .update(await frame(((i + 0.5) * info.duration) / 12, true))
          .digest("hex")
      );
    return {
      engineVersion: lock.version,
      chromium: lock.chromium,
      duration: info.duration,
      cuesSha256: createHash("sha256")
        .update(JSON.stringify(info.cues))
        .digest("hex"),
      frames
    };
  });
  const path = new URL(
    automated ? "./fixtures/automated-golden.json" : "./fixtures/golden.json",
    import.meta.url
  );
  if (process.argv.includes("--update")) {
    try {
      const old = JSON.parse(await readFile(path, "utf8"));
      if (
        old.engineVersion === actual.engineVersion &&
        JSON.stringify(old) !== JSON.stringify(actual)
      )
        throw new Error(
          "Bump the engine version before updating changed goldens"
        );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await writeFile(path, JSON.stringify(actual, null, 2) + "\n");
  } else assert.deepEqual(actual, JSON.parse(await readFile(path, "utf8")));
  console.log(
    `12 ${automated ? "automated choreography" : "manual reference"} golden frames, UTF-8 labels, cue sheet and duration verified`
  );
} finally {
  await rm(job, { recursive: true, force: true });
}
