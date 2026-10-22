import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = join(root, "apps/yunipals-market-api");
assert.equal(process.cwd(), app, "Run from the Arena API cwd.");
const require = createRequire(join(app, "package.json"));
const pg = require("pg");
const { verifyMessage, verifyTypedData } = require("viem");
const live = join(app, "src/arena/live");
const load = (name) => import(pathToFileURL(join(live, name + ".ts")).href);
const { migrateArena } = await load("schema");
const { ArenaIntake } = await load("intake");
const { ArenaCapacity } = await load("capacity");
const { ArenaIdentityAnalysis, PreparingIdentity } =
  await load("identityAnalysis");
const { NativeArenaDisclosure } = await load("nativeDisclosure");
const { ArenaReadModels } = await load("readModels");
const { StrategyCipher } = await load("crypto");
const { transaction } = await import(
  pathToFileURL(join(app, "src/db/pool.ts")).href
);
const ownerUrl = "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
const u = new URL(ownerUrl);
assert.equal(u.hostname, "127.0.0.1");
assert.equal(u.port, "55441");
assert.equal(u.pathname, "/arena");
const owner = new pg.Pool({
  connectionString: ownerUrl,
  max: 8,
  statement_timeout: 10000,
  lock_timeout: 2000
});
const run = randomBytes(4).toString("hex");
const scratch = join(app, ".arena-role-fixtures-" + run);
let unexpectedFetches = 0;
globalThis.fetch = async () => {
  unexpectedFetches++;
  throw new Error("Unexpected real HTTP request forbidden in local fixture");
};
const rolePools = new Map(),
  roleNames = new Map(),
  grants = [],
  findings = [],
  cases = [];
const hash = (b) => createHash("sha256").update(b).digest("hex");
const inputPath = join(
  root,
  "docs/unified-indexer/arena-live-compat-build-overlay-manifest-2026-10-22.json"
);
const inputs = JSON.parse(await readFile(inputPath, "utf8"));
assert.equal(
  hash(await readFile(inputPath)),
  "a7ec13c29a7af5f37390fffabd27ce7c1b9aa8f8bb1b254f8fafe32123b13393"
);
for (const f of inputs.files)
  assert.equal(
    hash(await readFile(join(root, f.path))),
    f.sha256,
    "Frozen source changed: " + f.path
  );
const historical = "/root/yunipals/ops/arena-native-role-review";
const proposal = await readFile(
  join(historical, "grant-proposal.sql.txt"),
  "utf8"
);
const graph = JSON.parse(
  await readFile(join(historical, "capabilities.v1.json"), "utf8")
);
const expectedFixtures = new Map(
  inputs.files
    .filter((x) =>
      /native(Intake|Referee|Transactions|Media|ClientTransactions)\.test\.ts$/.test(
        x.path
      )
    )
    .map((x) => [x.path.split("/").at(-1), x.sha256])
);
async function fixtureModule(name, exports = ["fixture"]) {
  const file = name + ".test.ts",
    p = join(live, file),
    bytes = await readFile(p, "utf8");
  assert.equal(hash(bytes), expectedFixtures.get(file));
  const end = bytes.indexOf("\ntest(");
  assert(end > 0);
  const code =
    bytes
      .slice(0, end)
      .replace(
        /from\s+(["'])(\.[^"']+)\1/g,
        (_m, _q, p) => "from " + JSON.stringify(resolve(live, p))
      ) +
    "\nexport {" +
    exports.join(",") +
    "};\n";
  const out = join(scratch, name + ".ts");
  await writeFile(out, code, { flag: "wx" });
  return import(pathToFileURL(out).href);
}
const q = (s) => '"' + s.replaceAll('"', '""') + '"';
const role = (id) => rolePools.get(id);
async function grant(id, text, reason) {
  assert(roleNames.has(id));
  await owner.query(text + " TO " + q(roleNames.get(id)));
  grants.push({ worker: id, sql: text + " TO LOCAL_ROLE", reason });
}
async function permission(action, expected) {
  try {
    await action();
    assert.fail("Expected missing permission " + expected);
  } catch (e) {
    assert.equal(e.code, "42501", String(e));
    findings.push({
      kind: "historical-grant-gap",
      object: expected,
      sqlstate: e.code
    });
  }
}
async function denied(id, sql, values = []) {
  await assert.rejects(role(id).query(sql, values), (e) => e?.code === "42501");
}
async function attach(f, id, objects = []) {
  const p = role(id);
  assert(p);
  Object.defineProperty(f.service, "pool", { value: p, writable: true });
  for (const object of objects)
    if (object && Object.hasOwn(object, "pool"))
      Object.defineProperty(object, "pool", { value: p, writable: true });
  return p;
}
async function step(name, fn) {
  await test(name, async () => {
    await fn();
    cases.push(name);
  });
}
const funded = {
  openaiFundingMode: "ongoing",
  openaiBudgetMicrousd: 0,
  openaiBudgetExpiresAt: 0,
  runwareMicrousd: 100000000,
  vrfAvailableWei: "100000000000000",
  vrfQuoteWei: "1000000000000",
  vrfMaxWei: "10000000000000",
  refereeGasWei: "200000000000000",
  operatorGasWei: "100000000000000",
  diskFreeBytes: 100 * 1024 ** 3,
  mediaStoredBytes: 1024 ** 3,
  mediaQuotaBytes: 80 * 1024 ** 3,
  mediaReserveBytes: 6 * 1024 ** 3
};
let intake, referee, transactions, media, client;
const postgresVersion = (
  await owner.query("SELECT current_setting('server_version') AS version")
).rows[0].version;
try {
  await owner.query("DROP SCHEMA IF EXISTS yunipals_arena CASCADE");
  await migrateArena(owner);
  await mkdir(scratch, { mode: 0o700 });
  for (const w of graph.workers) {
    const name = "arena_accept_" + run + "_" + w.id,
      pass = randomBytes(24).toString("hex");
    roleNames.set(w.id, name);
    await owner.query(
      "CREATE ROLE " +
        q(name) +
        " LOGIN PASSWORD '" +
        pass +
        "' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS"
    );
    const marker = "-- " + w.id + ":";
    const start = proposal.indexOf(marker);
    assert(start >= 0);
    const end = proposal.indexOf("\n-- ", start + marker.length);
    const body = proposal.slice(start, end < 0 ? undefined : end);
    for (const stmt of body
      .split(";")
      .map((s) => s.slice(s.indexOf("GRANT ")))
      .filter((s) => s.startsWith("GRANT "))) {
      assert(/ TO "REVIEW_ONLY_[a-z_]+"$/.test(stmt.trim()));
      await owner.query(stmt.trim().replace(/"REVIEW_ONLY_[a-z_]+"$/, q(name)));
    }
    const url = new URL(ownerUrl);
    url.username = name;
    url.password = pass;
    const p = new pg.Pool({
      connectionString: url.href,
      max: 6,
      statement_timeout: 10000,
      lock_timeout: 2000
    });
    rolePools.set(w.id, p);
    const actual = (
      await p.query(`SELECT current_user,session_user,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolbypassrls,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
    (SELECT nspowner=r.oid FROM pg_namespace WHERE nspname='yunipals_arena') AS owns_schema FROM pg_roles r WHERE rolname=current_user`)
    ).rows[0];
    assert.equal(actual.current_user, name);
    assert.equal(actual.session_user, name);
    assert.equal(actual.memberships, 0);
    for (const k of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolbypassrls",
      "owns_schema"
    ])
      assert.equal(actual[k], false);
  }
  intake = await fixtureModule("nativeIntake", ["fixture", "entryFixture"]);
  referee = await fixtureModule("nativeReferee");
  transactions = await fixtureModule("nativeTransactions");
  media = await fixtureModule("nativeMedia");
  client = await fixtureModule("nativeClientTransactions");
  await step(
    "Eight dedicated nonowner LOGIN sessions retain no owner membership, DDL, selectors or legacy public projection rights",
    async () => {
      for (const w of graph.workers) {
        await denied(
          w.id,
          "CREATE TABLE yunipals_arena.forbidden_role_table(id int)"
        );
        await denied(w.id, "SELECT * FROM yunipals_arena.tournament");
        await denied(w.id, "SELECT * FROM yunipals_arena.chain_event");
        await denied(w.id, "SELECT * FROM yunipals_arena.credit");
        await denied(
          w.id,
          "UPDATE yunipals_arena.deployment SET indexer_mode='legacy'"
        );
        await denied(
          w.id,
          "INSERT INTO yunipals_arena.source_selection(deployment) VALUES('forbidden')"
        );
        await denied(
          w.id,
          "INSERT INTO yunipals_arena.operational_migration(version,checksum)VALUES(99,'forbidden')"
        );
      }
    }
  );
  await step(
    "Protected invoker-trigger functions need no direct worker EXECUTE or trigger-attachment authority",
    async () => {
      for (const w of graph.workers) {
        const rows = (
          await role(w.id).query(
            "SELECT p.proname,p.prosecdef,has_function_privilege(current_user,p.oid,'EXECUTE') AS direct_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='yunipals_arena' AND p.proname=ANY($1::text[])",
            [
              graph.triggerFunctions.map((f) =>
                f.name.split(".").at(-1).replace(/\(\)$/, "")
              )
            ]
          )
        ).rows;
        assert.equal(rows.length, graph.triggerFunctions.length);
        assert(
          rows.every((f) => f.prosecdef === false && f.direct_execute === false)
        );
        await denied(
          w.id,
          "CREATE TRIGGER forbidden_fixture_trigger BEFORE UPDATE ON yunipals_arena.deployment FOR EACH ROW EXECUTE FUNCTION yunipals_arena.intent_immutable()"
        );
      }
    }
  );
  await step(
    "Current artwork queue proves historical API and worker graphs need finite modern identity_job additions",
    async () => {
      const f = await intake.fixture();
      try {
        const api = await attach(f, "api");
        const nft = {
          nftChainId: 8453,
          collection: f.state.seats[0].collection,
          tokenId: "1"
        };
        const payload = {
          token: {
            chain: "base",
            chain_id: 8453,
            contract_address: nft.collection,
            token_id: nft.tokenId,
            image:
              "https://drive.polychainmonsters.com/ipfs/QmSyntheticArtworkAcceptance123",
            attributes: [
              { trait_type: "Type", value: "Unidragon" },
              { trait_type: "Color", value: "Blue" },
              { trait_type: "Horn", value: "Gold Spiral" }
            ]
          }
        };
        const queued = new ArenaIdentityAnalysis(api, f.deployment, "ongoing");
        await permission(
          () => queued.resolve(nft, payload, f.accounts[0].address),
          "api.identity_job"
        );
        await grant(
          "api",
          "GRANT SELECT,INSERT ON TABLE yunipals_arena.identity_job",
          "Modern queue resolve/status before payment"
        );
        await assert.rejects(
          queued.resolve(nft, payload, f.accounts[0].address),
          PreparingIdentity
        );
        const cached = (
          await owner.query(
            "SELECT key,state FROM yunipals_arena.identity_job WHERE deployment=$1",
            [f.deployment]
          )
        ).rows;
        assert.equal(cached.length, 1);
        assert.equal(cached[0].state, "queued");
        assert.equal((await queued.status(cached[0].key)).state, "preparing");
        await denied(
          "api",
          "UPDATE yunipals_arena.identity_job SET state='ready' WHERE deployment=$1",
          [f.deployment]
        );
        const workerPool = await attach(f, "referee_provider");
        Object.assign(f.service.nativeSource, {
          work: async () => ({ ...f.observe(), ids: ["1"] })
        });
        await new ArenaCapacity(owner, f.deployment).save(funded);
        const worker = new ArenaIdentityAnalysis(
          workerPool,
          f.deployment,
          "ongoing",
          f.service,
          () =>
            new ArenaCapacity(workerPool, f.deployment, f.service).check(false)
        );
        await permission(
          () =>
            worker.step("synthetic-provider-key", 0, 0, async () => {
              throw Error("Must fail before fetch");
            }),
          "referee_provider.identity_job"
        );
        await grant(
          "referee_provider",
          "GRANT SELECT,UPDATE(state,updated_at,artwork,reserved_microusd,profile,provider_id,usage,profile_hash) ON TABLE yunipals_arena.identity_job",
          "Modern cached one-result artwork worker; no delete/insert"
        );
        let images = 0,
          posts = 0;
        const fetcher = async (url, init) => {
          if (String(url).startsWith("https://drive.")) {
            images++;
            return new Response(Buffer.from("89504e470d0a1a0a00000000", "hex"));
          }
          assert.equal(String(url), "https://api.openai.com/v1/responses");
          assert.equal(init.method, "POST");
          posts++;
          return Response.json({
            id: "resp_synthetic_role_acceptance",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      singleSubject: true,
                      wings: "absent",
                      description:
                        "A blue unicorn dragon standing on four visible legs with a golden horn."
                    })
                  }
                ]
              }
            ]
          });
        };
        assert.equal(
          await worker.step("synthetic-provider-key", 0, 0, fetcher),
          "ready"
        );
        assert.equal(
          await worker.step("synthetic-provider-key", 0, 0, fetcher),
          "idle"
        );
        assert.equal(images, 1);
        assert.equal(posts, 1);
        assert.equal((await queued.status(cached[0].key)).state, "ready");
        await denied(
          "referee_provider",
          "DELETE FROM yunipals_arena.identity_job WHERE deployment=$1",
          [f.deployment]
        );
      } finally {
        await owner.query(
          "DELETE FROM yunipals_arena.identity_job WHERE deployment=$1",
          [f.deployment]
        );
        await owner.query(
          "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
          [f.deployment]
        );
        await f.cleanup();
      }
    }
  );
  await step(
    "Intake and private history work under API role; executor freezes and disclosure uses immutable current identity dependencies",
    async () => {
      const f = await intake.fixture();
      try {
        await attach(f, "api");
        const p = role("api");
        const challenge = await f.service.challenge(f.accounts[0].address);
        const auth = await f.service.authenticate(
          challenge.id,
          await f.accounts[0].signMessage({ message: challenge.message })
        );
        assert.equal(
          await f.service.wallet(auth.token),
          f.accounts[0].address.toLowerCase()
        );
        for (let seat = 0; seat < 4; seat++)
          await f.service.submit(
            "1",
            f.accounts[seat].address,
            await f.submission(seat)
          );
        assert.equal(
          (await f.service.ownStrategy("1", f.accounts[0].address, 0)).locked,
          true
        );
        await assert.rejects(
          f.service.ownStrategy("1", f.accounts[1].address, 0),
          /another wallet/
        );
        const page = await new ArenaReadModels(f.service).tournaments();
        assert.equal(page.items.length, 1);
        assert.deepEqual(page.items[0].submittedSeats, [0, 1, 2, 3]);
        const origin = f.observe().tournament.incarnation;
        await assert.rejects(
          p.query(
            "UPDATE yunipals_arena.tournament_identity SET cipher_context='changed' WHERE deployment=$1",
            [f.deployment]
          ),
          /immutable/
        );
        await denied(
          "api",
          "DELETE FROM yunipals_arena.submission WHERE deployment=$1",
          [f.deployment]
        );
        await attach(f, "execution_referee");
        const prepared = await f.service.prepareInput(
          "1",
          (_s, strategies) => ({ strategies })
        );
        f.freeze(prepared);
        await attach(f, "disclosure");
        const worker = new NativeArenaDisclosure(f.service, async () => {});
        assert.equal((await worker.tick()).revealed, 1);
        const revealed = (
          await owner.query(
            "SELECT revealed_event_id,incarnation FROM yunipals_arena.frozen_input WHERE deployment=$1",
            [f.deployment]
          )
        ).rows[0];
        assert.equal(revealed.incarnation, origin);
        assert.equal(
          revealed.revealed_event_id,
          f.observe().tournament.inputFrozen.id
        );
        await denied(
          "disclosure",
          "UPDATE yunipals_arena.frozen_input SET ciphertext='replaced' WHERE deployment=$1",
          [f.deployment]
        );
        await attach(f, "api");
        assert.equal((await f.service.publicView("1")).strategies.length, 4);
      } finally {
        await f.cleanup();
      }
    }
  );
  await step(
    "Referee reservations, trigger evidence and saved-provider recovery use only the dedicated provider role",
    async () => {
      const f = await referee.fixture();
      try {
        await attach(f, "referee_provider", [f.api, f.adjudicator]);
        await f.api.reserve(
          f.deployment,
          "1",
          f.request(),
          1600000,
          f.first.incarnation
        );
        await Promise.all([
          f.api.step(f.deployment, "1", f.first.incarnation),
          f.api.step(f.deployment, "1", f.first.incarnation)
        ]);
        assert.equal(f.counts().posts, 1);
        const proof = (
          await owner.query(
            "SELECT evidence FROM yunipals_arena.provider_action_evidence e JOIN yunipals_arena.provider_task p USING(request_id) WHERE p.deployment=$1",
            [f.deployment]
          )
        ).rows[0];
        assert.equal(proof.evidence.incarnation, f.first.incarnation);
        f.fork();
        f.unavailable = true;
        f.responseState = "completed";
        const recovered = await f.worker.reconcile();
        assert.equal(recovered.completed, 1);
        assert.equal(f.counts().posts, 1);
        assert.equal(f.counts().gets, 1);
        await denied(
          "referee_provider",
          "UPDATE yunipals_arena.provider_task SET request='{}' WHERE deployment=$1",
          [f.deployment]
        );
        await denied(
          "referee_provider",
          "DELETE FROM yunipals_arena.provider_task WHERE deployment=$1",
          [f.deployment]
        );
      } finally {
        await f.close();
      }
    }
  );
  await step(
    "Nonowner referee adjudication reuses its completed provider result and inserts only the current validated input",
    async () => {
      const f = await referee.fixture();
      try {
        await attach(f, "referee_provider", [f.api, f.adjudicator]);
        assert.equal(
          (
            await f.adjudicator.step(
              f.deployment,
              "1",
              1600000,
              f.first.incarnation
            )
          ).state,
          "queued"
        );
        f.responseState = "completed";
        assert.equal(
          (
            await f.adjudicator.step(
              f.deployment,
              "1",
              1600000,
              f.first.incarnation
            )
          ).state,
          "valid"
        );
        assert.equal(f.counts().posts, 1);
        const rows = (
          await owner.query(
            "SELECT incarnation,input_hash,state FROM yunipals_arena.adjudication WHERE deployment=$1",
            [f.deployment]
          )
        ).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].incarnation, f.first.incarnation);
        assert.equal(rows[0].input_hash, f.state.inputHash);
      } finally {
        await f.close();
      }
    }
  );
  await step(
    "Signed intents preserve the same bytes, global nonce and receipt history across restart and orphaned opening",
    async () => {
      const f = await transactions.fixture();
      try {
        await attach(f, "execution_referee", [f.capacity]);
        const control = f.control(),
          intent = await control.prepare("expire", "1");
        assert.equal(intent.incarnation, f.observe().tournament.incarnation);
        f.loseBroadcastOnce();
        await assert.rejects(
          control.advanceIntent(intent),
          /lost broadcast response/
        );
        await control.advanceIntent(intent);
        await f.mine(intent);
        assert.equal((await control.advanceIntent(intent)).state, "confirmed");
        const stored = (
          await owner.query(
            "SELECT raw_transaction,nonce FROM yunipals_arena.transaction_intent WHERE action_id=$1",
            [intent.action_id]
          )
        ).rows[0];
        assert.equal(stored.raw_transaction, intent.raw_transaction);
        await assert.rejects(
          role("execution_referee").query(
            "UPDATE yunipals_arena.transaction_intent SET raw_transaction='0x00' WHERE action_id=$1",
            [intent.action_id]
          ),
          (e) => e.code === "42501" || /immutable/.test(e.message)
        );
        await denied(
          "execution_referee",
          "DELETE FROM yunipals_arena.transaction_intent WHERE action_id=$1",
          [intent.action_id]
        );
        f.forkOpening();
        assert.equal((await control.advanceIntent(intent)).state, "orphaned");
        await assert.rejects(
          control.prepare("expire", "1"),
          /saved transaction/
        );
      } finally {
        await f.cleanup();
      }
    }
  );
  await step(
    "Current capacity sampler uses bounded media-observation reads and cannot inspect private prompts",
    async () => {
      const f = await transactions.fixture();
      try {
        await attach(f, "capacity_sampler");
        const sampler = new ArenaCapacity(
          role("capacity_sampler"),
          f.service.deployment,
          f.service
        );
        await permission(
          () => sampler.save(funded, new Date().toISOString()),
          "capacity_sampler.media_job_observation"
        );
        await grant(
          "capacity_sampler",
          "GRANT SELECT(deployment,state,updated_at) ON TABLE yunipals_arena.media_job",
          "Current sampler publication-race guard only"
        );
        await permission(
          () => sampler.save(funded, new Date().toISOString()),
          "capacity_sampler.capacity_upsert"
        );
        await grant(
          "capacity_sampler",
          "GRANT SELECT(snapshot,checked_at) ON TABLE yunipals_arena.capacity",
          "PostgreSQL ON CONFLICT reads excluded snapshot/check time"
        );
        await permission(
          () => sampler.save(funded, new Date().toISOString()),
          "capacity_sampler.capacity_conflict_key"
        );
        await grant(
          "capacity_sampler",
          "GRANT SELECT(deployment) ON TABLE yunipals_arena.capacity",
          "PostgreSQL conflict-key and own cache-delete predicate read"
        );
        await sampler.save(funded, new Date().toISOString());
        try {
          await role("capacity_sampler").query(
            "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
            [f.service.deployment]
          );
        } catch (e) {
          assert.equal(e.code, "42501");
          findings.push({
            kind: "historical-grant-gap",
            object: "capacity_sampler.capacity_predicate",
            sqlstate: e.code
          });
          await grant(
            "capacity_sampler",
            "GRANT SELECT(deployment) ON TABLE yunipals_arena.capacity",
            "Own cache invalidation predicate only"
          );
          await role("capacity_sampler").query(
            "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
            [f.service.deployment]
          );
        }
        await denied(
          "capacity_sampler",
          "SELECT ciphertext FROM yunipals_arena.submission"
        );
        await denied(
          "capacity_sampler",
          "INSERT INTO yunipals_arena.transaction_intent(deployment)VALUES('forbidden')"
        );
      } finally {
        await f.cleanup();
      }
    }
  );
  await step(
    "Lobby executor persists an origin-free opening and binds its same signed action to the indexed opening",
    async () => {
      const f = await transactions.fixture(false);
      try {
        await attach(f, "execution_lobby", [f.capacity]);
        await permission(
          () => f.control().prepare("open-lobby", "1"),
          "execution_lobby.identity_job_capacity"
        );
        await grant(
          "execution_lobby",
          "GRANT SELECT ON TABLE yunipals_arena.identity_job",
          "Modern capacity identity reservations"
        );
        const control = f.control(),
          intent = await control.prepare("open-lobby", "1");
        assert.equal(intent.incarnation, null);
        await control.advanceIntent(intent);
        await f.mine(intent);
        assert.equal((await control.advanceIntent(intent)).state, "confirmed");
        const rows = (
          await owner.query(
            "SELECT incarnation,action_id FROM yunipals_arena.opening_action_observation WHERE action_id=$1",
            [intent.action_id]
          )
        ).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].incarnation, f.observe().tournament.incarnation);
        assert.equal(f.broadcasts.length, 1);
        await denied(
          "execution_lobby",
          "UPDATE yunipals_arena.opening_action_observation SET incarnation='forbidden'"
        );
      } finally {
        await f.cleanup();
      }
    }
  );
  await step(
    "Client tracker preserves receipt history and same-hash recovery with separate API and tracker credentials",
    async () => {
      const f = await client.fixture();
      try {
        await f.permit();
        f.mined("entry");
        await attach(f, "api");
        await f.tracker.register(f.wallet, f.txhash, f.entry);
        await attach(f, "client_tracker");
        await f.tick();
        assert.equal(
          (await f.tracker.read(f.wallet, f.txhash)).state,
          "indexed"
        );
        f.proof.inclusion = "changed";
        assert.equal(
          (await f.tracker.read(f.wallet, f.txhash)).state,
          "reorged"
        );
        f.missing = true;
        await f.tick();
        f.mined("entry");
        await f.tick();
        const rows = (
          await owner.query(
            "SELECT canonical FROM yunipals_arena.client_receipt_history WHERE deployment=$1 ORDER BY first_seen_at",
            [f.deployment]
          )
        ).rows;
        assert.deepEqual(rows, [{ canonical: false }, { canonical: true }]);
        assert.equal(
          (await f.tracker.read(f.wallet, f.txhash)).state,
          "indexed"
        );
        await denied(
          "client_tracker",
          "DELETE FROM yunipals_arena.client_receipt_history WHERE deployment=$1",
          [f.deployment]
        );
        await denied(
          "client_tracker",
          "SELECT ciphertext FROM yunipals_arena.frozen_input"
        );
      } finally {
        await f.close();
      }
    }
  );
  await step(
    "Media role recovers its known provider UUID without new requests during source outage",
    async () => {
      const f = await media.fixture();
      try {
        await attach(f, "media_provider", [f.api, f.media]);
        const dep = f.service.deployment,
          inc = f.first.incarnation;
        await f.api.reserve(dep, "1", "SF1/image", f.request, inc);
        f.lost();
        await assert.rejects(
          f.api.step(dep, "1", "SF1/image", await f.folder(), inc),
          /unconfirmed/
        );
        f.source(true);
        assert.equal((await f.scheduler.reconcile()).completed, 1);
        assert.deepEqual(f.counts(), { posts: 1, gets: 1, downloads: 1 });
        await denied(
          "media_provider",
          "DELETE FROM yunipals_arena.provider_task WHERE deployment=$1",
          [dep]
        );
      } finally {
        await f.close();
      }
    }
  );
  await step(
    "Media publication fires native binding triggers and atomically invalidates only its deployment capacity cache",
    async () => {
      const f = await media.fixture();
      try {
        const { mediaFolder } = await load("mediaPaths");
        const {
          publishedMediaTypes,
          buildMediaPublication,
          commitMediaPublication
        } = await load("mediaPublication");
        const dep = f.service.deployment,
          inc = f.first.incarnation,
          folder = mediaFolder(join(f.storage, "published"), dep, "1", inc);
        await mkdir(folder, { recursive: true });
        for (const name of Object.keys(publishedMediaTypes))
          await writeFile(join(folder, name), "synthetic " + name);
        const filmHash = hash(await readFile(join(folder, "film.mp4")));
        await writeFile(
          join(folder, "input.json"),
          JSON.stringify({
            inputSha256: f.state.inputHash.slice(2),
            input: f.input
          })
        );
        await writeFile(
          join(folder, "outcome.json"),
          JSON.stringify({
            inputSha256: f.state.inputHash.slice(2),
            outcomeSha256: f.state.resultHash.slice(2),
            outcome: f.candidate
          })
        );
        await writeFile(
          join(folder, "film.json"),
          JSON.stringify({
            sha256: filmHash,
            outcomeSha256: f.state.resultHash.slice(2)
          })
        );
        const pub = await buildMediaPublication(folder, {
          deployment: dep,
          tournamentId: "1",
          incarnation: inc,
          inputHash: f.state.inputHash,
          outcomeHash: f.state.resultHash
        });
        await new ArenaCapacity(owner, dep).save(funded);
        await attach(f, "media_provider", [f.api, f.media]);
        const proof = await f.guard.check("1", "media", inc);
        await permission(
          () =>
            transaction(role("media_provider"), (db) =>
              commitMediaPublication(db, f.service, pub, proof.proof)
            ),
          "media_provider.capacity_invalidation"
        );
        await grant(
          "media_provider",
          "GRANT DELETE ON TABLE yunipals_arena.capacity",
          "Current publication invalidates stale capacity atomically"
        );
        await transaction(role("media_provider"), (db) =>
          commitMediaPublication(db, f.service, pub, proof.proof)
        );
        assert.equal(
          (
            await owner.query(
              "SELECT 1 FROM yunipals_arena.capacity WHERE deployment=$1",
              [dep]
            )
          ).rowCount,
          0
        );
        assert.equal(
          (
            await owner.query(
              "SELECT 1 FROM yunipals_arena.media_publication WHERE deployment=$1",
              [dep]
            )
          ).rowCount,
          1
        );
        await permission(
          () =>
            role("media_provider").query(
              "SELECT artwork FROM yunipals_arena.identity_job WHERE deployment=$1 AND state='ready' AND profile->>'imageSha256'=$2 LIMIT 1",
              [dep, "0".repeat(64)]
            ),
          "media_provider.cached_identity_artwork"
        );
        await grant(
          "media_provider",
          "GRANT SELECT ON TABLE yunipals_arena.identity_job",
          "Current analyzed fighter artwork reference query"
        );
        assert.equal(
          (
            await role("media_provider").query(
              "SELECT artwork FROM yunipals_arena.identity_job WHERE deployment=$1 AND state='ready' AND profile->>'imageSha256'=$2 LIMIT 1",
              [dep, "0".repeat(64)]
            )
          ).rowCount,
          0
        );
        await denied(
          "media_provider",
          "UPDATE yunipals_arena.media_publication SET manifest='{}' WHERE deployment=$1",
          [dep]
        );
      } finally {
        await owner.query(
          "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
          [f.service.deployment]
        );
        await f.close();
      }
    }
  );
  await step(
    "A real owner source-selector change makes the old API actor refuse before any new private write",
    async () => {
      const f = await intake.fixture();
      try {
        await attach(f, "api");
        const epoch = randomUUID(),
          sourceId = "0x" + "e".repeat(64),
          acceptedHash = "0x" + "9".repeat(64),
          reviewHash = "0x" + "4".repeat(64);
        await owner.query(
          "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
          [f.deployment]
        );
        const review = {
          target: { kind: "unified", sourceId },
          accepted: { block: "10", hash: acceptedHash },
          previous: null
        };
        await owner.query(
          "INSERT INTO yunipals_arena.source_switch_history(epoch,deployment,review_hash,review)VALUES($1,$2,$3,$4)",
          [epoch, f.deployment, reviewHash, review]
        );
        await owner.query(
          "INSERT INTO yunipals_arena.source_selection(deployment,epoch,kind,source_id,accepted_block,accepted_hash,review_hash)VALUES($1,$2,'unified',$3,10,$4,$5)",
          [f.deployment, epoch, sourceId, acceptedHash, reviewHash]
        );
        await owner.query(
          "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
          [f.deployment]
        );
        await assert.rejects(
          f.service.submit("1", f.accounts[0].address, await f.submission(0)),
          /source epoch changed/
        );
        assert.equal(
          (
            await owner.query(
              "SELECT 1 FROM yunipals_arena.submission WHERE deployment=$1",
              [f.deployment]
            )
          ).rowCount,
          0
        );
        // Immutable selector/history intentionally survive until the owned whole
        // local schema teardown; do not bypass their no-delete triggers.
      } finally {
        await f.pool.end();
      }
    }
  );
} finally {
  assert.equal(unexpectedFetches, 0);
  for (const p of rolePools.values()) await p.end();
  await owner.query("DROP SCHEMA IF EXISTS yunipals_arena CASCADE");
  for (const name of roleNames.values())
    await owner.query("DROP ROLE " + q(name));
  const remainingRoles = (
    await owner.query(
      "SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1::text[])",
      [[...roleNames.values()]]
    )
  ).rows[0].n;
  assert.equal(remainingRoles, 0);
  assert.equal(
    (await owner.query("SELECT to_regnamespace('yunipals_arena') AS namespace"))
      .rows[0].namespace,
    null
  );
  await owner.end();
  await rm(scratch, { recursive: true, force: true });
  const evidence = {
    format: "arena-current-native-role-local-acceptance-v1",
    candidateManifestSha256: hash(await readFile(inputPath)),
    historicalProposalSha256: hash(proposal),
    historicalCapabilitiesSha256: hash(
      await readFile(join(historical, "capabilities.v1.json"))
    ),
    testHarnessSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    remainingFixtureRoles: remainingRoles,
    fixtureSchemaRemoved: true,
    completedCases: cases,
    findings,
    currentGrantDelta: grants,
    unexpectedRealHttpRequests: unexpectedFetches,
    postgresVersion,
    rolesCreated: roleNames.size,
    rolesDropped: roleNames.size,
    providerEffects:
      "Only in-process synthetic fetch/broadcast fixtures; no actual provider or chain requests.",
    limits: [
      "OperationalroleDMLonly, not productionACLattestation or genuinePonderRPCbridge.",
      "Syntheticpublicnativeobservations are retained existingfixtures; no canonical sourceDBwrites used to fabricate liveproof.",
      "No frozenbusiness source, productionservices, Gitstate, globaldefaults or persistentroleschanged."
    ]
  };
  await writeFile(
    join(
      root,
      "docs/unified-indexer/arena-current-native-role-local-acceptance-2026-10-22.json"
    ),
    JSON.stringify(evidence, null, 2) + "\n"
  );
}
