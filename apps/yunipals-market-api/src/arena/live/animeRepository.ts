import { existsSync, realpathSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
export function animeRepository() {
  let candidate = resolve(process.env.ARENA_REPOSITORY_ROOT ?? process.cwd());
  for (;;) {
    if (
      existsSync(
        join(candidate, "contracts/arena/config/anime-economics.json")
      ) &&
      existsSync(join(candidate, "docs/arena/rules-v2/rules.json"))
    )
      // Release selectors are symlinks. Use canonical paths so Node entrypoint
      // guards compare the same file URL and actually run the renderer.
      return realpathSync(candidate);
    const parent = dirname(candidate);
    if (parent === candidate)
      throw new Error(
        "Run the studio inside the repository or set ARENA_REPOSITORY_ROOT."
      );
    candidate = parent;
  }
}
