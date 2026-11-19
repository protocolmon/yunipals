// Copy the built server away from the repository to catch absolute pnpm links
// and undeclared/native dependencies that a normal local import would hide.
import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "yunipals-packaged-social-"));
const source = resolve(process.argv[2] || "dist/.social");
try {
  await cp(source, directory, { recursive: true, verbatimSymlinks: true });
  async function checkLinks(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await readlink(file);
        assert.equal(isAbsolute(target), false, file);
        assert.ok(resolve(path, target).startsWith(directory + sep), file);
      } else if (entry.isDirectory()) await checkLinks(file);
    }
  }
  await checkLinks(directory);
  // A fresh process prevents the parent process's module cache hiding missing files.
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import {createServer} from 'node:http';
    const {socialNodeHandler} = await import(${JSON.stringify(pathToFileURL(join(directory, "index.mjs")).href)});
    const server=createServer(socialNodeHandler);
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try {
      const base='http://127.0.0.1:'+server.address().port;
      const page=await fetch(base+'/?edition=tcg');
      assert.equal(page.status,200);
      const html=await page.text();
      assert.match(html,/Your next adventure/);
      assert.match(html,/property="og:image"/);
      assert.match(html,/\\/assets\\//);
      assert.equal((await fetch(base+'/api/og/token/ethereum/-1.png')).status,404);
      assert.equal((await fetch(base+'/portals/cards/12',{redirect:'manual'})).status,308);
    } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
  `
    ],
    { encoding: "utf8", env: { ...process.env, NODE_PATH: "" }, timeout: 20000 }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(
    "Packaged social server passed isolated HTML, image-route and redirect checks."
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
