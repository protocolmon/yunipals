import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { animeFighterName } from "./src/fighterNames.js";
const root = dirname(fileURLToPath(import.meta.url));
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export async function prepareFixture(job) {
  const assets = join(job, "assets");
  await mkdir(assets, { recursive: true });
  for (const name of await readdir(join(root, "fixtures/assets")))
    await copyFile(join(root, "fixtures/assets", name), join(assets, name));
  for (const name of ["tournament.json", "choreography.json"])
    await copyFile(join(root, "fixtures", name), join(assets, name));
  const tournament = JSON.parse(
    await readFile(join(assets, "tournament.json"), "utf8")
  );
  for (const fighter of Object.values(tournament.fighters)) {
    fighter.name = animeFighterName(fighter.name);
    fighter.species = animeFighterName(fighter.species);
  }
  await writeFile(join(assets, "tournament.json"), JSON.stringify(tournament));
  for (const name of await readdir(join(root, "static/assets")))
    await copyFile(join(root, "static/assets", name), join(assets, name));
  const sprites = JSON.parse(
    await readFile(join(root, "fixtures/sprites.json"), "utf8")
  );
  const bg = await readFile(join(assets, "bg-arena.webp"));
  sprites["bg-arena"] = {
    file: "bg-arena.webp",
    sha256: createHash("sha256").update(bg).digest("hex")
  };
  await writeFile(join(assets, "sprites.json"), JSON.stringify(sprites));
  const looks = runInNewContext(
    (await readFile(join(root, "fixtures/look.js"), "utf8")) +
      ";JSON.stringify(FIXTURE_LOOK)"
  );
  const fighters = Object.fromEntries(
    Object.entries(JSON.parse(looks)).map(([id, l]) => {
      const manifest = {
        look: {
          attackKind: l.kind,
          face: l.defFace,
          palette: { color: l.color, light: l.light, dark: l.dark },
          stageHeight: l.h,
          origin: l.origin,
          torso: l.torso
        },
        sprites: Object.fromEntries(
          Object.keys(l.h)
            .concat("cutin")
            .map((p) => [p, sprites[id + "-" + p]])
        )
      };
      return [
        id,
        {
          manifest,
          manifestHash:
            "0x" +
            createHash("sha256").update(canonical(manifest)).digest("hex")
        }
      ];
    })
  );
  await writeFile(join(assets, "fighters.json"), JSON.stringify(fighters));
}
