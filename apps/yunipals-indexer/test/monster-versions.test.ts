import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import type { Pool } from "pg";
vi.mock("../lib/ownership/readiness.js", () => ({
  assertOwnershipAvailable: async () => ({ fingerprint: "fixture" })
}));
vi.mock("../lib/offchain/sql.js", () => ({
  ownershipPonderSchema: "versions_evm",
  ownershipBnbSchema: "versions_evm",
  ponderSchema: "versions_evm"
}));
vi.mock("../lib/metadata/read-source.js", () => ({
  metadataReadRelation: "metadata.token_metadata",
  metadataSearchReadRelation: "metadata.token_search",
  metadataTraitReadRelation: "metadata.token_trait"
}));
import { buildVersionQuery, parseVersionQuery } from "../lib/versions/query.js";
import { parseVersionManifest } from "../lib/versions/manifest.js";
import { monsterVersionMigrations } from "../lib/versions/schema.js";
import { collections } from "../lib/constants.js";
import { registerMonsterVersionRoutes } from "../lib/versions/routes.js";
import { storeVersionManifest } from "../lib/versions/import.js";

const revision = "a".repeat(64),
  alice = `0x${"1".repeat(40)}` as `0x${string}`,
  bob = `0x${"2".repeat(40)}` as `0x${string}`;
const hash = `0x${"b".repeat(64)}`;
const allocation = () => ({
  version: 1,
  metadataReleaseId: "archive",
  groups: [
    {
      evidence: {
        kind: "ownership-snapshot-airdrop",
        source: "allocation.json",
        snapshotBlock: "100",
        snapshotBlockHash: hash,
        allocationSha256: "c".repeat(64)
      },
      members: ["ethereum", "base"].map((chain) => ({
        chain,
        contractAddress: collections[chain as "base" | "ethereum"].address,
        tokenId: "1",
        lifecycle: 1,
        mintTransactionHash: hash,
        mintLogIndex: 0,
        assetKey: "d".repeat(64),
        role: chain === "base" ? "airdrop" : "original"
      }))
    }
  ]
});

describe("verified relationship import", () => {
  it("requires historical allocation evidence and rejects conflicts and unrelated assets", () => {
    const valid = allocation();
    expect(parseVersionManifest(valid).groups).toHaveLength(1);
    expect(() =>
      parseVersionManifest({
        ...valid,
        groups: [...valid.groups, ...valid.groups]
      })
    ).toThrow();
    const missing = allocation();
    missing.groups[0]!.evidence.kind = "same-artwork";
    expect(() => parseVersionManifest(missing)).toThrow();
    const unrelated = allocation();
    unrelated.groups[0]!.members[1]!.assetKey = "e".repeat(64);
    expect(() => parseVersionManifest(unrelated)).toThrow();
    const contract = allocation();
    contract.groups[0]!.members[1]!.contractAddress =
      collections.ethereum.address;
    expect(() => parseVersionManifest(contract)).toThrow();
  });
});

type GroupRow = {
  id: string;
  members: {
    chain: string;
    tokenId: string;
    owner: string;
    lifecycle: number;
  }[];
  position: { score: string | null; tokenId: string; chain: string };
};
describe("grouped queries on PostgreSQL", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA metadata; CREATE SCHEMA metadata_source; CREATE SCHEMA versions_evm;
      CREATE TABLE versions_evm.token(collection text,chain_id int,contract_address text,token_id text,owner text,burned boolean,lifecycle int,mint_block numeric,last_transfer_block numeric);
      CREATE TABLE versions_evm.transfer_event(id text,collection text,token_id text,lifecycle int,"from" text,"to" text,block_number numeric,transaction_index int,log_index int);
      CREATE TABLE metadata.token_visibility(collection text,token_id numeric,owner text,lifecycle int,anchor_event_id text,anchor_block numeric,anchor_transaction_index int,anchor_log_index int);
      CREATE TABLE metadata.token_search(collection text,token_id numeric,lifecycle int,metadata_available boolean,rarity_points numeric,rarity_points_capped numeric);
      CREATE TABLE metadata.token_metadata(collection text,token_id numeric,lifecycle int,name text,image text,attributes jsonb,token_uri text);
      CREATE TABLE metadata.token_trait(collection text,token_id numeric,lifecycle int,trait_type text,value text);
      CREATE TABLE metadata_source.archive_release(release_id text,state text);
      CREATE TABLE versions_evm.token_lifecycle(collection text,token_id text,lifecycle int,minted_to text,mint_transaction_hash text,mint_block numeric);
      CREATE TABLE metadata_source.source_record(release_id text,asset_key text,chain_id text,legacy_id text,issue text,family text);
      ALTER TABLE versions_evm.transfer_event ADD COLUMN chain_id integer, ADD COLUMN contract_address text, ADD COLUMN transaction_hash text;
      CREATE TABLE metadata_source.lifecycle_binding(release_id text,chain_id text,contract_address text,token_id text,mint_transaction_hash text,mint_log_index int,asset_key text);
      INSERT INTO metadata_source.archive_release VALUES('archive','active');
      INSERT INTO versions_evm.token SELECT c.chain,c.chain_id,c.contract,id::text,'${alice}',false,1,1,1 FROM (VALUES('ethereum',1,'${collections.ethereum.address}'),('base',8453,'${collections.base.address}')) c(chain,chain_id,contract) CROSS JOIN generate_series(1,35) id;
      UPDATE versions_evm.token SET owner='${bob}' WHERE collection='base' AND token_id='2';
      INSERT INTO metadata.token_search SELECT collection,token_id::numeric,lifecycle,true,CASE WHEN token_id::int<=32 THEN (token_id::int/3)::numeric END,NULL FROM versions_evm.token;
      INSERT INTO metadata.token_metadata SELECT collection,token_id::numeric,lifecycle,'Monster '||token_id,'/same-artwork.png','[]',NULL FROM versions_evm.token;
      INSERT INTO metadata.token_trait SELECT collection,token_id::numeric,1,'Type',CASE collection WHEN 'ethereum' THEN 'Water' ELSE 'Fire' END FROM versions_evm.token;
      INSERT INTO metadata.token_trait SELECT collection,token_id::numeric,1,'Color',CASE collection WHEN 'ethereum' THEN 'Red' ELSE 'Blue' END FROM versions_evm.token;
    `);
    for (const sql of monsterVersionMigrations) await db.exec(sql);
    await db.query(
      "INSERT INTO metadata.monster_version_release VALUES($1,'archive',$1,true,now())",
      [revision]
    );
    await db.exec(`INSERT INTO versions_evm.token_lifecycle SELECT collection,token_id,lifecycle,'${alice}','${hash}',1 FROM versions_evm.token;
      INSERT INTO versions_evm.transfer_event SELECT 'mint:'||collection||':'||token_id,collection,token_id,lifecycle,'0x0000000000000000000000000000000000000000','${alice}',1,0,0,chain_id,contract_address,'${hash}' FROM versions_evm.token WHERE token_id::int<=10;
      INSERT INTO metadata_source.source_record SELECT 'archive',lpad(to_hex(token_id::int),64,'0'),'56',token_id,NULL,'GEN1' FROM versions_evm.token WHERE collection='ethereum' AND token_id::int<=10;
      INSERT INTO metadata_source.lifecycle_binding SELECT 'archive',chain_id::text,contract_address,token_id,'${hash}',0,lpad(to_hex(token_id::int),64,'0') FROM versions_evm.token WHERE token_id::int<=10;
      INSERT INTO metadata.monster_version_member SELECT '${revision}',lpad(to_hex(t.token_id::int),64,'0'),t.collection,t.contract_address,t.token_id,t.lifecycle,'${hash}',0,lpad(to_hex(t.token_id::int),64,'0'),CASE t.collection WHEN 'base' THEN 'airdrop' ELSE 'original' END,NULL,'{}' FROM versions_evm.token t WHERE t.token_id::int<=10;`);
  }, 30_000);
  afterAll(async () => {
    await db?.close();
  });
  async function page(
    params = "",
    owners: Record<string, string> = {},
    rev = revision,
    now = 1000
  ) {
    const statement = buildVersionQuery(
      parseVersionQuery(new URLSearchParams(params)),
      rev,
      owners,
      "ownership",
      now
    );
    const result = (
      await db.query<{
        groupTotal: number;
        nftTotal: number;
        groups: GroupRow[];
      }>(statement.text, statement.values)
    ).rows[0]!;
    return { ...result, ...statement.page(result.groups) };
  }
  it.each([
    "token-id-asc",
    "token-id-desc",
    "rarity-capped-asc",
    "rarity-capped-desc",
    "rarity-asc",
    "rarity-desc"
  ])(
    "groups before pagination and traverses both ways with ties and nulls: %s",
    async (sort) => {
      const pages = [await page(`sort=${sort}&limit=7`)];
      while (pages.at(-1)!.nextCursor) {
        expect(pages.length).toBeLessThan(15);
        pages.push(
          await page(`sort=${sort}&limit=7&cursor=${pages.at(-1)!.nextCursor}`)
        );
      }
      const groups = pages.flatMap((p) => p.groups);
      expect(groups).toHaveLength(60);
      expect(new Set(groups.map((g) => g.id)).size).toBe(60);
      expect(groups.flatMap((g) => g.members)).toHaveLength(70);
      expect(groups.filter((g) => g.members.length === 2)).toHaveLength(10);
      expect(pages[0]).toMatchObject({ groupTotal: 60, nftTotal: 70 });
      let current = pages.at(-1)!;
      for (let i = pages.length - 2; i >= 0; i--) {
        current = await page(
          `sort=${sort}&limit=7&cursor=${current.previousCursor}`
        );
        expect(current.groups.map((g) => g.id)).toEqual(
          pages[i]!.groups.map((g) => g.id)
        );
      }
      expect(current.previousCursor).toBeNull();
    }
  );
  it("applies chain, owner, and all traits to the same NFT before grouping", async () => {
    expect((await page("chain=base&t.Type=Water&t.Color=Blue")).nftTotal).toBe(
      0
    );
    expect((await page("t.Type=Water&t.Color=Blue")).nftTotal).toBe(0);
    expect((await page("chain=base")).groupTotal).toBe(35);
    const owned = await page(`owner=${bob}`, { base: bob, ethereum: bob });
    expect(owned.groups).toHaveLength(1);
    expect(owned.groups[0]!.members).toEqual([
      expect.objectContaining({ chain: "base", tokenId: "2", owner: bob })
    ]);
    expect((await page("q=35")).nftTotal).toBe(2);
  });
  it("binds cursors to mapping revision, filters and ownership and expires them", async () => {
    const first = await page("limit=1");
    for (const suffix of ["&chain=base", "&t.Type=Water", "&sort=token-id-asc"])
      await expect(
        page(`limit=1&cursor=${first.nextCursor}${suffix}`)
      ).rejects.toThrow();
    await expect(
      page(`limit=1&cursor=${first.nextCursor}`, {}, "f".repeat(64))
    ).rejects.toThrow();
    await expect(
      page(`limit=1&cursor=${first.nextCursor}`, {}, revision, 901001)
    ).rejects.toThrow();
  });
  it("excludes hidden peers before grouping and never reuses a reminted member", async () => {
    await db.exec(
      `INSERT INTO versions_evm.transfer_event VALUES('anchor','base','1',1,'old','${alice}',1,0,0); INSERT INTO metadata.token_visibility VALUES('base',1,'${alice}',1,'anchor',1,0,0);`
    );
    try {
      expect((await page("q=1")).nftTotal).toBe(1);
      const hidden = await page(`owner=${alice}&visibility=hidden`, {
        base: alice,
        ethereum: alice
      });
      expect(hidden.groups[0]!.members).toHaveLength(1);
      expect(hidden.groups[0]!.members[0]!.chain).toBe("base");
    } finally {
      await db.exec(
        "DELETE FROM metadata.token_visibility; DELETE FROM versions_evm.transfer_event WHERE id='anchor';"
      );
    }
    await db.exec(
      "UPDATE versions_evm.token SET lifecycle=2 WHERE collection='base' AND token_id='3'"
    );
    try {
      expect((await page("q=3")).groupTotal).toBe(2);
    } finally {
      await db.exec(
        "UPDATE versions_evm.token SET lifecycle=1 WHERE collection='base' AND token_id='3'"
      );
    }
  });
  it("rejects unsupported and unbounded input", () => {
    for (const p of [
      "limit=25",
      "limit=0",
      "limit=1&limit=2",
      "chain=unsupported",
      "sort=price-asc",
      "sale=listed",
      "visibility=hidden",
      "rarityMin=abc",
      "metadata=bogus",
      "q=x"
    ])
      expect(() => parseVersionQuery(new URLSearchParams(p))).toThrow();
  });
  it("serves validated summaries and grouped pages through the real read-only API", async () => {
    const app = new Hono();
    app.onError((error, c) => {
      throw error;
    });
    const statements: string[] = [];
    const pool = {
      connect: async () => ({
        query: async (sql: string, values?: unknown[]) => {
          statements.push(sql);
          return db.query(sql, values);
        },
        release() {}
      })
    } as unknown as Pick<Pool, "connect">;
    registerMonsterVersionRoutes(app, {
      pool,
      resolveOwner: async (input) => ({
        input,
        normalizedName: null,
        addresses: { base: bob, ethereum: bob }
      })
    });
    vi.stubEnv("API_MONSTER_VERSIONS_ENABLED", "true");
    vi.stubEnv("API_MONSTER_GROUPING_ENABLED", "true");
    try {
      const capability = await app.request("/v1/monster-version-capabilities");
      expect(await capability.json()).toMatchObject({
        enabled: true,
        revision
      });
      const result = await app.request("/v1/monster-groups?chain=base&limit=1");
      expect(result.status).toBe(200);
      const body = await result.json();
      expect(body).toMatchObject({
        groupTotal: 35,
        nftTotal: 35,
        query: "chain=base&limit=1"
      });
      expect(body.groups).toHaveLength(1);
      const summary = await app.request(
        `/v1/monster-versions?asset=base:${collections.base.address}:1:1`
      );
      const summaries = await summary.json();
      expect(
        summaries.items[`base:${collections.base.address}:1`]
      ).toMatchObject({ role: "airdrop", revision });
      expect(
        summaries.items[`base:${collections.base.address}:1`].versions
      ).toHaveLength(2);
      expect(statements).toContain(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
      expect(statements).toContain("SET LOCAL statement_timeout='1000ms'");
      expect((await app.request("/v1/monster-groups?limit=100")).status).toBe(
        400
      );
      vi.stubEnv("API_MONSTER_VERSIONS_ENABLED", "false");
      expect(
        await (await app.request("/v1/monster-version-capabilities")).json()
      ).toMatchObject({ enabled: false });
      expect((await app.request("/v1/monster-groups")).status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("checks imports without writes and validates every member before atomic publication", async () => {
    const raw = allocation();
    for (const m of raw.groups[0]!.members) m.assetKey = "1".padStart(64, "0");
    const manifest = parseVersionManifest(raw);
    const adapter = { query: db.query.bind(db) } as unknown as Parameters<
      typeof storeVersionManifest
    >[0];
    const active = async () =>
      (
        await db.query<{ revision: string }>(
          "SELECT revision FROM metadata.monster_version_release WHERE active"
        )
      ).rows[0]!.revision;
    await db.exec("BEGIN READ ONLY");
    try {
      await storeVersionManifest(
        adapter,
        manifest,
        "f".repeat(64),
        "c".repeat(64),
        false
      );
    } finally {
      await db.exec("ROLLBACK");
    }
    expect(await active()).toBe(revision);
    await db.exec("BEGIN");
    try {
      await storeVersionManifest(
        adapter,
        manifest,
        "f".repeat(64),
        "c".repeat(64),
        true
      );
      expect(await active()).toBe("f".repeat(64));
      expect(
        (
          await db.query<{ count: number }>(
            "SELECT count(*)::int FROM metadata.monster_version_member WHERE revision=$1",
            ["f".repeat(64)]
          )
        ).rows[0]!.count
      ).toBe(2);
    } finally {
      await db.exec("ROLLBACK");
    }
    expect(await active()).toBe(revision);
    const invalid = parseVersionManifest(raw);
    invalid.groups[0]!.members[1]!.mintLogIndex = 123;
    await expect(
      storeVersionManifest(
        adapter,
        invalid,
        "f".repeat(64),
        "c".repeat(64),
        true
      )
    ).rejects.toThrow("canonical mint evidence");
    expect(await active()).toBe(revision);
  });
  it("accepts mint reconstruction and checks the initial recipient rather than the current owner", async () => {
    const raw = allocation();
    const members = raw.groups[0]!.members.map((m) => ({
      ...m,
      tokenId: "2",
      assetKey: "2".padStart(64, "0")
    }));
    const reconstructed = {
      ...raw,
      groups: [
        {
          members,
          evidence: {
            kind: "base-mint-and-source-identity",
            source: "indexed mint audit",
            auditSha256: "c".repeat(64),
            initialOwners: [
              {
                tokenId: "2",
                recipient: alice,
                transactionHash: hash,
                logIndex: 0
              }
            ]
          }
        }
      ]
    };
    const manifest = parseVersionManifest(reconstructed);
    const adapter = { query: db.query.bind(db) } as unknown as Parameters<
      typeof storeVersionManifest
    >[0];
    await expect(
      storeVersionManifest(
        adapter,
        manifest,
        "f".repeat(64),
        "c".repeat(64),
        false
      )
    ).resolves.toBeUndefined();
    const incorrect = structuredClone(reconstructed);
    incorrect.groups[0]!.evidence.initialOwners[0]!.recipient = bob;
    await expect(
      storeVersionManifest(
        adapter,
        parseVersionManifest(incorrect),
        "f".repeat(64),
        "c".repeat(64),
        false
      )
    ).rejects.toThrow("canonical mint evidence");
    expect(() =>
      parseVersionManifest({
        ...reconstructed,
        groups: [{ ...reconstructed.groups[0], snapshotDate: "2026-01-01" }]
      })
    ).toThrow("snapshot date");
    const missing = structuredClone(reconstructed);
    missing.groups[0]!.evidence.initialOwners = [];
    expect(() => parseVersionManifest(missing)).toThrow(
      "initial mint recipient"
    );
  });
});
