import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { animeRepository } from "./animeRepository";

test("installed release selectors resolve to the canonical renderer root", async () => {
  const temporary = await mkdtemp("/tmp/yunipals-anime-root-");
  const previous = process.env.ARENA_REPOSITORY_ROOT;
  try {
    const release = join(temporary, "releases", "candidate");
    for (const folder of ["contracts/arena/config", "docs/arena/rules-v2"])
      await mkdir(join(release, folder), { recursive: true });
    await writeFile(
      join(release, "contracts/arena/config/anime-economics.json"),
      "{}"
    );
    await writeFile(join(release, "docs/arena/rules-v2/rules.json"), "{}");
    const selector = join(temporary, "current");
    await symlink("releases/candidate", selector);
    process.env.ARENA_REPOSITORY_ROOT = selector;
    assert.equal(animeRepository(), release);
    process.env.ARENA_REPOSITORY_ROOT = join(selector, "docs");
    assert.equal(animeRepository(), release);
  } finally {
    if (previous === undefined) delete process.env.ARENA_REPOSITORY_ROOT;
    else process.env.ARENA_REPOSITORY_ROOT = previous;
    await rm(temporary, { recursive: true, force: true });
  }
});
