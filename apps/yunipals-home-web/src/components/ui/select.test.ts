import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("application dropdowns use the shared Select component", async () => {
  async function check(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await check(path);
      else if (entry.name.endsWith(".tsx")) {
        assert(
          !/<select\b/.test(await readFile(path, "utf8")),
          `Use Select from @/components/ui/select in ${path}`
        );
      }
    }
  }
  await check(fileURLToPath(new URL("../../", import.meta.url)));
});
