import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadArenaLabCatalog } from "./catalog";
import { canonicalJson, sha256, weightedDraw } from "./draw";
import { createArenaLabApp } from "./http";
import { ArenaError, ArenaLabService, type PrivateTournament } from "./service";
import { ArenaStore } from "./store";
import { addArenaProductionRoutes } from "./production";
import type { TournamentView } from "./types";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const catalog = loadArenaLabCatalog(root, 3);
const word = `0x${"72".repeat(32)}`;
const credentials = catalog.fighters.map(() => randomBytes(32).toString("hex"));
const strategies = [
  "PRIVATE_WATER_1: Slam a wide water hammer into the opponent's shoulder; dodge behind cover during recovery.",
  "PRIVATE_VINE_2: Feint with a vine, sidestep the released water shot, then lash the exposed flank.",
  "PRIVATE_FAIRY_3: Fly above the ground trap, bank at release, and fire a starburst into the attacker's chest.",
  "PRIVATE_DRAGON_4: Skim low, pressure with a blue blast and follow with a shoulder hit during their recovery."
];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "yunipals-arena-test-"));
  const path = join(directory, "arena.sqlite");
  const key = randomBytes(32);
  let store = new ArenaStore<PrivateTournament>(path, key);
  let service = new ArenaLabService(store, catalog);
  return {
    directory,
    path,
    key,
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    restart() {
      store.close();
      store = new ArenaStore(path, key);
      service = new ArenaLabService(store, catalog);
    },
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}
function joinFour(service: ArenaLabService) {
  const created = service.create();
  for (const [index, fighter] of catalog.fighters.entries())
    service.join(created.id, fighter.id, credentials[index]!);
  return service.get(created.id);
}
function ready(service: ArenaLabService) {
  const joined = joinFour(service);
  return service.fulfillTestDraw(joined.id, joined.draw!.requestId, word);
}
function submit(service: ArenaLabService, id: string, index: number) {
  return service.submit(
    id,
    catalog.fighters[index]!.id,
    credentials[index]!,
    strategies[index]!
  );
}
function code(status: number) {
  return (error: unknown) =>
    error instanceof ArenaError && error.status === status;
}

test("published pool has all 898 unique IDs and exactly 3 tickets per Genesis / 1 per Personal", () => {
  assert.equal(catalog.islands.length, 898);
  assert.equal(
    new Set(catalog.islands.map((island) => island.tokenId)).size,
    898
  );
  assert.equal(
    catalog.islands.filter((island) => island.edition === "Genesis").length,
    525
  );
  assert.equal(
    catalog.islands.filter((island) => island.edition === "Personal").length,
    373
  );
  assert.equal(
    catalog.islands.reduce((total, island) => total + island.weight, 0),
    1948
  );
  for (const island of catalog.islands)
    assert.equal(island.weight, island.edition === "Genesis" ? 3 : 1);
});

test("first join alone creates one draw; restart, repeated joins and later entrants retain its identity", () => {
  const f = setup();
  try {
    const created = f.service.create();
    assert.equal(created.draw, null);
    const joined = f.service.join(
      created.id,
      catalog.fighters[0]!.id,
      credentials[0]!
    );
    assert.equal(joined.draw?.word, null);
    f.restart();
    const repeated = f.service.join(
      created.id,
      catalog.fighters[0]!.id,
      credentials[0]!
    );
    assert.deepEqual(repeated.draw, joined.draw);
    const second = f.service.join(
      created.id,
      catalog.fighters[1]!.id,
      credentials[1]!
    );
    assert.deepEqual(second.draw, joined.draw);
    assert.throws(
      () => f.service.fulfillTestDraw(created.id, "different-request", word),
      code(409)
    );
    const fulfilled = f.service.fulfillTestDraw(
      created.id,
      joined.draw!.requestId,
      word
    );
    assert.ok(fulfilled.island);
    assert.deepEqual(
      f.service.fulfillTestDraw(created.id, joined.draw!.requestId, word),
      fulfilled
    );
    assert.throws(
      () =>
        f.service.fulfillTestDraw(
          created.id,
          joined.draw!.requestId,
          `0x${"13".repeat(32)}`
        ),
      code(409)
    );
  } finally {
    f.close();
  }
});

test("both a full roster and a fulfilled island are required; duplicate/fifth entries cannot change the bracket", () => {
  const f = setup();
  try {
    const one = f.service.create();
    const first = f.service.join(
      one.id,
      catalog.fighters[0]!.id,
      credentials[0]!
    );
    f.service.fulfillTestDraw(one.id, first.draw!.requestId, word);
    assert.throws(() => submit(f.service, one.id, 0), code(409));
    const four = joinFour(f.service);
    assert.equal(four.phase, "drawing-island");
    assert.throws(() => submit(f.service, four.id, 0), code(409));
    const island = f.service.fulfillTestDraw(
      four.id,
      four.draw!.requestId,
      word
    );
    assert.equal(island.phase, "collecting-strategies");
    assert.throws(
      () => f.service.join(four.id, catalog.fighters[0]!.id, "0".repeat(64)),
      code(409)
    );
    const expanded = new ArenaLabService(f.store, {
      ...catalog,
      fighters: [
        ...catalog.fighters,
        { ...catalog.fighters[0]!, id: "fifth", tokenId: "999" }
      ]
    });
    assert.throws(
      () => expanded.join(four.id, "fifth", "0".repeat(64)),
      code(409)
    );
    assert.deepEqual(f.service.get(four.id).semifinals, [
      ["bastion", "cedar"],
      ["zephyr", "elrond"]
    ]);
  } finally {
    f.close();
  }
});

test("all read routes hide the first three strategies; fourth submission atomically reveals and freezes all four", async () => {
  const f = setup();
  try {
    const tournament = ready(f.service);
    const app = createArenaLabApp(f.service);
    for (let index = 0; index < 3; index++) {
      const response = await app.request(
        `http://localhost/api/arena/tournaments/${tournament.id}/strategies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fighterId: catalog.fighters[index]!.id,
            credential: credentials[index],
            strategy: strategies[index]
          })
        }
      );
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(!body.includes("PRIVATE_"));
      for (const path of [
        "catalog",
        "tournaments",
        `tournaments/${tournament.id}`
      ]) {
        const read = await app.request(`http://localhost/api/arena/${path}`);
        assert.equal(read.status, 200);
        const content = await read.text();
        assert.ok(!content.includes("PRIVATE_"));
        assert.ok(!content.includes("credentialHash"));
        assert.ok(
          !credentials.some((credential) => content.includes(credential))
        );
        assert.equal(read.headers.get("Cache-Control"), "no-store");
      }
      assert.equal(
        (
          await app.request(
            `http://localhost/api/arena/tournaments/${tournament.id}/input`
          )
        ).status,
        409
      );
    }
    assert.ok(!readFileSync(f.path).toString("utf8").includes("PRIVATE_"));
    f.restart();
    assert.equal(f.service.get(tournament.id).submissionCount, 3);
    assert.equal(f.service.get(tournament.id).strategies, null);
    const revealed = submit(f.service, tournament.id, 3);
    assert.equal(revealed.phase, "revealed");
    assert.deepEqual(
      revealed.strategies?.map((strategy) => strategy.text),
      strategies
    );
    const bundle = f.service.export(tournament.id);
    assert.equal(bundle.inputSha256, sha256(canonicalJson(bundle.input)));
    assert.equal(
      submit(f.service, tournament.id, 3).inputSha256,
      revealed.inputSha256
    );
    assert.throws(
      () =>
        f.service.submit(
          tournament.id,
          "bastion",
          credentials[0]!,
          "Replace the plan after seeing opponents"
        ),
      code(409)
    );
  } finally {
    f.close();
  }
});

test("simultaneous final submissions from two processes preserve both prompts and one frozen input", async () => {
  const f = setup();
  try {
    const tournament = ready(f.service);
    submit(f.service, tournament.id, 0);
    submit(f.service, tournament.id, 1);
    const run = (index: number) =>
      new Promise<string>((resolve, reject) => {
        const receipt = join(f.directory, `worker-${index}.json`);
        const source = `
        import { writeFileSync } from 'node:fs';
        import { ArenaStore } from './src/arena/store.ts';
        import { ArenaLabService } from './src/arena/service.ts';
        import { loadArenaLabCatalog } from './src/arena/catalog.ts';
        const store = new ArenaStore(${JSON.stringify(f.path)}, Buffer.from(${JSON.stringify(f.key.toString("hex"))}, 'hex'));
        const service = new ArenaLabService(store, loadArenaLabCatalog(${JSON.stringify(root)}, 3));
        const result = service.submit(${JSON.stringify(tournament.id)},${JSON.stringify(catalog.fighters[index]!.id)},${JSON.stringify(credentials[index])},${JSON.stringify(strategies[index])});
        writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({count: result.submissionCount, hash: result.inputSha256})); store.close();
      `;
        const childEnvironment = { ...process.env };
        // The test runner's child protocol is not valid for an ordinary worker.
        delete childEnvironment.NODE_TEST_CONTEXT;
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", source],
          { stdio: ["ignore", "pipe", "pipe"], env: childEnvironment }
        );
        let stderr = "";
        child.stdout.resume();
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (exit) => {
          if (exit !== 0)
            return reject(new Error(stderr || `Worker exited ${exit}`));
          try {
            resolve(readFileSync(receipt, "utf8"));
          } catch (error) {
            reject(error);
          }
        });
      });
    const results = (await Promise.all([run(2), run(3)])).map((value) =>
      JSON.parse(value)
    );
    assert.deepEqual(results.map((value) => value.count).sort(), [3, 4]);
    const final = f.service.get(tournament.id);
    assert.equal(
      results.find((value) => value.count === 4).hash,
      final.inputSha256
    );
    assert.deepEqual(
      final.strategies?.map((strategy) => strategy.text),
      strategies
    );
  } finally {
    f.close();
  }
});

test("server enforces seat ownership, immutable submission, size limits and no premature export", () => {
  const f = setup();
  try {
    const tournament = ready(f.service);
    assert.throws(
      () =>
        f.service.submit(
          tournament.id,
          "cedar",
          credentials[0]!,
          strategies[1]!
        ),
      code(403)
    );
    assert.throws(
      () => f.service.submit(tournament.id, "cedar", credentials[1]!, " "),
      code(400)
    );
    assert.throws(
      () =>
        f.service.submit(
          tournament.id,
          "cedar",
          credentials[1]!,
          "a".repeat(2401)
        ),
      code(400)
    );
    submit(f.service, tournament.id, 1);
    assert.throws(
      () =>
        f.service.submit(tournament.id, "cedar", credentials[1]!, "new text"),
      code(409)
    );
    assert.throws(() => f.service.export(tournament.id), code(409));
    const wrongKey = new ArenaStore<PrivateTournament>(f.path, randomBytes(32));
    assert.throws(() => wrongKey.read(tournament.id));
    wrongKey.close();
  } finally {
    f.close();
  }
});

test("configuration changes affect new tournaments only, including Genesis weighting", () => {
  const f = setup();
  try {
    const existing = f.service.create();
    const changed = new ArenaLabService(f.store, {
      ...catalog,
      islands: catalog.islands.map((island) => ({
        ...island,
        weight: island.edition === "Genesis" ? 5 : 1
      })),
      rules: { ...catalog.rules, version: "another-version" }
    });
    const next = changed.create();
    assert.notEqual(next.pool.sha256, existing.pool.sha256);
    assert.equal(changed.get(existing.id).pool.genesisWeight, 3);
    assert.equal(changed.get(existing.id).rulesSha256, existing.rulesSha256);
  } finally {
    f.close();
  }
});

test("weighted selection is reproducible, bound to the exact pool and rejects invalid randomness/weights", () => {
  const input = {
    tournamentId: "public-vector",
    poolSha256: "ab".repeat(32),
    word,
    entries: [
      { tokenId: "1", weight: 3 },
      { tokenId: "2", weight: 1 }
    ]
  };
  assert.deepEqual(weightedDraw(input), weightedDraw(structuredClone(input)));
  for (let index = 0; index < 50; index++) {
    const result = weightedDraw({
      ...input,
      word: `0x${index.toString(16).padStart(64, "0")}`
    });
    assert.equal(result.tokenId, result.ticket < 3 ? "1" : "2");
  }
  assert.throws(() => weightedDraw({ ...input, word: "0x1" }));
  assert.throws(() =>
    weightedDraw({ ...input, entries: [{ tokenId: "1", weight: 0 }] })
  );
  assert.throws(() =>
    weightedDraw({
      ...input,
      entries: [
        { tokenId: "1", weight: 1 },
        { tokenId: "1", weight: 3 }
      ]
    })
  );
});

test("HTTP rejects cross-origin writes, nonlocal hosts, malformed JSON and oversized bodies", async () => {
  const f = setup();
  try {
    const app = createArenaLabApp(f.service);
    const url = "http://localhost/api/arena/tournaments";
    assert.equal(
      (
        await app.request(url, {
          method: "POST",
          headers: {
            origin: "https://unrelated.test",
            "content-type": "application/json"
          },
          body: "{}"
        })
      ).status,
      403
    );
    assert.equal(
      (await app.request("http://unrelated.test/api/arena/catalog")).status,
      403
    );
    assert.equal(
      (await app.request(url, { method: "POST", body: "{}" })).status,
      415
    );
    const tournament = ready(f.service);
    const post = (body: string) =>
      app.request(`${url}/${tournament.id}/strategies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });
    assert.equal((await post("{")).status, 400);
    assert.equal((await post("[]")).status, 400);
    assert.equal(
      (await post(JSON.stringify({ strategy: "a".repeat(20000) }))).status,
      413
    );
    const response = await app.request(`${url}/${tournament.id}`);
    const body = (await response.json()) as TournamentView;
    assert.equal(body.submissionCount, 0);
  } finally {
    f.close();
  }
});

test("production artifacts stay private before reveal; only allowlisted files and valid byte ranges are served", async () => {
  const f = setup();
  try {
    const tournament = ready(f.service);
    const app = createArenaLabApp(f.service);
    addArenaProductionRoutes(app, f.service, f.directory);
    const base = `http://localhost/api/arena/tournaments/${tournament.id}`;
    const publicDirectory = join(f.directory, "jobs", tournament.id, "public");
    mkdirSync(publicDirectory, { recursive: true });
    writeFileSync(join(publicDirectory, "film.mp4"), "0123456789");
    writeFileSync(join(publicDirectory, "private.key"), "never-serve");
    assert.equal((await app.request(`${base}/artifacts/film.mp4`)).status, 409);
    for (let i = 0; i < 4; i++) submit(f.service, tournament.id, i);
    assert.equal(
      (await app.request(`${base}/artifacts/private.key`)).status,
      404
    );
    const range = await app.request(`${base}/artifacts/film.mp4`, {
      headers: { range: "bytes=2-5" }
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await range.text(), "2345");
    assert.equal(
      (
        await app.request(`${base}/artifacts/film.mp4`, {
          headers: { range: "bytes=100-200" }
        })
      ).status,
      416
    );
    assert.equal(
      (
        await app.request(`${base}/artifacts/film.mp4`, {
          headers: { range: "bytes=-" }
        })
      ).status,
      416
    );
  } finally {
    f.close();
  }
});
