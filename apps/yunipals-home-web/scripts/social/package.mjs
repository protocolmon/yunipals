import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { nodeFileTrace } from "@vercel/nft";
import { build } from "esbuild";

/** Trace native packages with their pnpm symlinks. Bundle to a staging file
 * inside the repository so traced paths are portable to any output directory. */
export async function packageSocial(app, output) {
  const repository = join(app, "../..");
  const stage = join(app, "node_modules/.cache/social-entry.mjs");
  await mkdir(dirname(stage), { recursive: true });
  await build({
    entryPoints: [join(app, "server/social/entry.ts")],
    outfile: stage,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["sharp", "@resvg/resvg-js"],
    banner: {
      js: 'import { createRequire as __socialCreateRequire } from "node:module"; const require = __socialCreateRequire(import.meta.url);'
    }
  });
  const directory = join(output, ".social");
  await mkdir(directory, { recursive: true });
  await rm(join(directory, "runtime"), { recursive: true, force: true });
  const trace = await nodeFileTrace([stage], {
    base: repository,
    processCwd: app
  });
  for (const file of trace.fileList) {
    const destination = join(directory, "runtime", file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repository, file), destination, {
      dereference: false,
      verbatimSymlinks: true
    });
  }
  const entry = join("runtime", relative(repository, stage));
  // The bundled handler resolves packaged files relative to its own module.
  const runtimeDirectory = dirname(join(directory, entry));
  await cp(join(directory, "assets"), join(runtimeDirectory, "social-assets"), {
    recursive: true
  });
  for (const file of ["social-config.json", "social-template.html"])
    await cp(join(directory, file), join(runtimeDirectory, file));
  await writeFile(
    join(directory, "index.mjs"),
    `export { default, socialNodeHandler } from ${JSON.stringify(`./${entry}`)};\n`
  );
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ type: "module" })
  );
  async function manifestFiles(path) {
    const files = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) files.push(...(await manifestFiles(file)));
      else if (entry.isSymbolicLink()) {
        const target = await readlink(file);
        if (
          isAbsolute(target) ||
          !resolve(path, target).startsWith(directory + sep)
        )
          throw new Error("Nonportable preview dependency link.");
        files.push({ path: relative(directory, file), target });
      } else if (entry.isFile())
        files.push({
          path: relative(directory, file),
          sha256: createHash("sha256")
            .update(await readFile(file))
            .digest("hex")
        });
      else throw new Error("Unexpected preview dependency type.");
    }
    return files;
  }
  await writeFile(
    join(directory, "runtime-manifest.json"),
    JSON.stringify(
      (await manifestFiles(directory))
        .filter((file) => file.path !== "runtime-manifest.json")
        .sort((a, b) => a.path.localeCompare(b.path))
    )
  );
}

export function socialRoutes() {
  return [
    {
      src: "/images/og/(.*)",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      continue: true
    },
    { src: "/(api/og/.*)", dest: "/api/social-page?__socialPath=/$1" },
    // Root query variants must be resolved before the static homepage.
    { src: "/", dest: "/api/social-page?__socialPath=/" },
    { src: "/leaderboard", dest: "/api/social-page?__socialPath=/leaderboard" },
    {
      src: "/((?:collection|exomon|portals)(?:/.*)?)",
      dest: "/api/social-page?__socialPath=/$1"
    },
    {
      src: "/((?:monsters|grading/(?:cards|tokens)|collector)/.*)",
      dest: "/api/social-page?__socialPath=/$1"
    },
    { src: "/\\.social(?:/.*)?", status: 404 }
  ];
}

export async function packageVercelSocial(app, release, output) {
  const directory = join(output, "functions/api/social-page.func");
  await cp(join(release, ".social"), directory, {
    recursive: true,
    verbatimSymlinks: true
  });
  await writeFile(
    join(directory, ".vc-config.json"),
    JSON.stringify({
      runtime: "nodejs24.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      maxDuration: 10
    })
  );
  // Assert the build contains the template and configuration, not a source HTML stub.
  const config = JSON.parse(
    await readFile(join(directory, "social-config.json"), "utf8")
  );
  if (!config.staticRevision) throw new Error("Missing social image revision.");
}
