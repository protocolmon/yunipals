import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import type { Pool } from "pg";
vi.mock("../lib/ownership/readiness.js", () => ({
  assertOwnershipAvailable: async () => ({ fingerprint: "fixture" })
}));
vi.mock("../lib/offchain/sql.js", () => ({
  ownershipPonderSchema: "version_evm",
  ownershipBnbSchema: "version_evm",
  ponderSchema: "version_evm"
}));
vi.mock("../lib/metadata/read-source.js", () => ({
  metadataReadRelation: "metadata.token_metadata",
  metadataSearchReadRelation: "metadata.token_search",
  metadataTraitReadRelation: "metadata.token_trait"
}));
import { collections, ZERO_ADDRESS } from "../lib/constants.js";
import { solanaSchemaStatements } from "../lib/solana/schema.js";
import { parseVersionManifest } from "../lib/versions/manifest.js";
import { storeVersionManifest } from "../lib/versions/import.js";
import { buildVersionQuery, parseVersionQuery } from "../lib/versions/query.js";
import {
  versionSolanaSnapshot,
  versionSummaries
} from "../lib/versions/read.js";
import {
  monsterAssetKey,
  parseMonsterAsset
} from "@protopals/yunipals-market-core/monsterVersions";
import { registerMonsterVersionRoutes } from "../lib/versions/routes.js";
import {
  solanaVersionCandidates,
  addSolanaVersionGroups,
  type BaseIdentityAudit
} from "../lib/versions/solana.js";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const key = (n: number) => "1".repeat(31) + alphabet[n]!;
const alice = `0x${"a".repeat(40)}`;
const solanaOwner = key(33),
  otherSolanaOwner = key(9);
const hash = `0x${"a".repeat(64)}`,
  revision = "b".repeat(64),
  auditSha = "c".repeat(64);
const assetKey = (n: number) => n.toString(16).padStart(64, "0");
const baseId = (n: number) => String(1000002000000 + n);
const manifestInput = () => ({
  version: 1,
  metadataReleaseId: "archive",
  groups: Array.from({ length: 30 }, (_, index) => {
    const n = index + 1;
    return {
      members: [
        {
          chain: "solana",
          contractAddress: null,
          tokenId: key(n),
          lifecycle: 1,
          mintTransactionHash: null,
          mintLogIndex: null,
          sourceHash: assetKey(n + 100),
          assetKey: assetKey(n),
          role: "original"
        },
        {
          chain: "base",
          contractAddress: collections.base.address,
          tokenId: baseId(n),
          lifecycle: 1,
          mintTransactionHash: hash,
          mintLogIndex: n,
          assetKey: assetKey(n),
          role: "airdrop"
        },
        ...(n === 1
          ? [
              {
                chain: "polygon",
                contractAddress: collections.polygon.address,
                tokenId: baseId(n),
                lifecycle: 1,
                mintTransactionHash: hash,
                mintLogIndex: n,
                assetKey: assetKey(n),
                role: "version"
              }
            ]
          : [])
      ],
      evidence: {
        kind: "base-mint-and-source-identity",
        source: "audited shared identity",
        auditSha256: auditSha,
        initialOwners: [
          {
            tokenId: baseId(n),
            recipient: alice,
            transactionHash: hash,
            logIndex: n
          }
        ]
      }
    };
  })
});
type GroupRow = {
  id: string;
  members: {
    chain: string;
    tokenId: string;
    owner: string;
    contractAddress: string | null;
    lifecycle: number;
  }[];
  position: { score: string | null; tokenId: string; chain: string };
};

describe("Solana and EVM monster versions", () => {
  let db: PGlite;
  let adapter: Parameters<typeof storeVersionManifest>[0];
  beforeAll(async () => {
    vi.stubEnv("SOLANA_API_ENABLED", "true");
    vi.stubEnv("API_MONSTER_VERSIONS_ENABLED", "true");
    db = new PGlite();
    adapter = { query: db.query.bind(db) } as unknown as typeof adapter;
    await db.exec(`CREATE SCHEMA metadata;CREATE SCHEMA metadata_source;CREATE SCHEMA version_evm;
      CREATE TABLE metadata_source.archive_release(release_id text,state text);INSERT INTO metadata_source.archive_release VALUES('archive','active');
      CREATE TABLE metadata_source.source_record(release_id text,asset_key text,legacy_id text,content_hash text,chain_id text,origin_type text,issue text);
      CREATE TABLE metadata_source.lifecycle_binding(release_id text,chain_id text,contract_address text,token_id text,mint_transaction_hash text,mint_log_index integer,asset_key text);
      CREATE TABLE version_evm.token(collection text,chain_id int,contract_address text,token_id text,owner text,burned boolean,lifecycle int,mint_block bigint,last_transfer_block bigint);
      CREATE TABLE version_evm.token_lifecycle(collection text,token_id text,lifecycle int,minted_to text,mint_transaction_hash text,mint_block bigint);
      CREATE TABLE version_evm.transfer_event(id text,collection text,chain_id int,contract_address text,token_id text,lifecycle int,"from" text,"to" text,transaction_hash text,block_number bigint,transaction_index int,log_index int);
      CREATE TABLE metadata.token_metadata(collection text,token_id numeric,lifecycle int,name text,image text,attributes jsonb,token_uri text);
      CREATE TABLE metadata.token_search(collection text,token_id numeric,lifecycle int,metadata_available boolean,rarity_points numeric,rarity_points_capped numeric);
      CREATE TABLE metadata.token_trait(collection text,token_id numeric,lifecycle int,trait_type text,value text);
      CREATE TABLE metadata.token_visibility(collection text,token_id numeric,owner text,lifecycle int,anchor_event_id text,anchor_block bigint,anchor_transaction_index int,anchor_log_index int);`);
    for (const sql of solanaSchemaStatements) await db.exec(sql);
    await db.exec(`INSERT INTO solana_indexer.manifest(singleton,release_id,checksum,asset_count) VALUES(true,'archive','checksum',30);
      INSERT INTO solana_indexer.scan_run(id,manifest_checksum,state,asset_count,batch_size,completed_at) VALUES(1,'checksum','published',30,30,now());
      UPDATE solana_indexer.sync_state SET published_run_id=1;`);
    for (let n = 1; n <= 30; n++) {
      await db.query(
        "INSERT INTO solana_indexer.manifest_asset VALUES($1,$2,$3,$4,'archive')",
        [key(n), baseId(n), assetKey(n), assetKey(n + 100)]
      );
      await db.query(
        'INSERT INTO solana_indexer.asset_metadata(mint,release_id,source_hash,document,content_hash,name,image,attributes,rarity_points,rarity_points_capped) VALUES($1,\'archive\',$2,\'{}\',$2,$3,NULL,\'[{"trait_type":"Type","value":"Water"},{"trait_type":"Color","value":"Red"}]\',$4,NULL)',
        [
          key(n),
          assetKey(n + 100),
          `Exomon ${n}`,
          n % 6 === 0 ? null : String(n % 4)
        ]
      );
      await db.query(
        "INSERT INTO solana_indexer.token(mint,owner,burnt,observed_at,published_run_id) VALUES($1,$2,false,now(),1)",
        [key(n), n === 2 ? otherSolanaOwner : solanaOwner]
      );
      await db.query(
        "INSERT INTO metadata_source.source_record VALUES('archive',$1,$2,$3,'mainnet-beta','GEN1_EXOMON_DROP',NULL)",
        [assetKey(n), key(n), assetKey(n + 100)]
      );
      for (const chain of n === 1
        ? (["base", "polygon"] as const)
        : (["base"] as const)) {
        await db.query(
          "INSERT INTO version_evm.token VALUES($1,$2,$3,$4,$5,false,1,1,1)",
          [
            chain,
            collections[chain].chainId,
            collections[chain].address,
            baseId(n),
            alice
          ]
        );
        await db.query(
          "INSERT INTO version_evm.token_lifecycle VALUES($1,$2,1,$3,$4,1)",
          [chain, baseId(n), alice, hash]
        );
        await db.query(
          "INSERT INTO version_evm.transfer_event VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,1,0,$9)",
          [
            `${chain}:${n}`,
            chain,
            collections[chain].chainId,
            collections[chain].address,
            baseId(n),
            ZERO_ADDRESS,
            alice,
            hash,
            n
          ]
        );
        await db.query(
          "INSERT INTO metadata_source.lifecycle_binding VALUES('archive',$1,$2,$3,$4,$5,$6)",
          [
            String(collections[chain].chainId),
            collections[chain].address,
            baseId(n),
            hash,
            n,
            assetKey(n)
          ]
        );
        await db.query(
          "INSERT INTO metadata.token_metadata VALUES($1,$2,1,$3,NULL,'[]',NULL)",
          [chain, baseId(n), `Base Exomon ${n}`]
        );
        await db.query(
          "INSERT INTO metadata.token_search VALUES($1,$2,1,true,$3,NULL)",
          [chain, baseId(n), n % 6 === 0 ? null : String(n % 4)]
        );
        await db.query(
          "INSERT INTO metadata.token_trait VALUES($1,$2,1,'Type','Fire'),($1,$2,1,'Color','Blue')",
          [chain, baseId(n)]
        );
      }
    }
    await db.exec(`INSERT INTO version_evm.token SELECT 'ethereum',1,'${collections.ethereum.address}',n::text,'${alice}',false,1,1,1 FROM generate_series(1,3)n;
      INSERT INTO metadata.token_metadata SELECT 'ethereum',n,1,'Singleton',NULL,'[]',NULL FROM generate_series(1,3)n;
      INSERT INTO metadata.token_search SELECT 'ethereum',n,1,true,NULL,NULL FROM generate_series(1,3)n;`);
    await storeVersionManifest(
      adapter,
      parseVersionManifest(manifestInput()),
      revision,
      auditSha,
      true
    );
  }, 30000);
  afterAll(async () => {
    await db?.close();
    vi.unstubAllEnvs();
  });
  async function page(
    params = "",
    owners: Record<string, string> = {},
    snapshot = "evm:solana-1"
  ) {
    const q = buildVersionQuery(
      parseVersionQuery(new URLSearchParams(params)),
      revision,
      owners,
      snapshot
    );
    const row = (
      await db.query<{
        groupTotal: number;
        nftTotal: number;
        groups: GroupRow[];
      }>(q.text, q.values)
    ).rows[0]!;
    return { ...row, ...q.page(row.groups) };
  }
  it("groups Solana, Polygon, and Base together before pagination", async () => {
    const all = await page("limit=24");
    expect(all).toMatchObject({ groupTotal: 33, nftTotal: 64 });
    const group = all.groups.find((g) => g.members.length === 3)!;
    expect(group.members.map((m) => m.chain).sort()).toEqual([
      "base",
      "polygon",
      "solana"
    ]);
    expect(group.members.find((m) => m.chain === "solana")?.tokenId).toBe(
      key(1)
    );
    const info = await versionSummaries(
      adapter,
      revision,
      group.members.map(parseMonsterAsset)
    );
    expect(Object.values(info)).toHaveLength(3);
    expect(
      info[monsterAssetKey({ chain: "solana", tokenId: key(1) })]
    ).toMatchObject({
      role: "original",
      versions: expect.arrayContaining([
        expect.objectContaining({ chain: "polygon", role: "version" }),
        expect.objectContaining({ chain: "base", role: "airdrop" })
      ])
    });
  });
  it.each([
    "token-id-asc",
    "token-id-desc",
    "rarity-asc",
    "rarity-desc",
    "rarity-capped-asc",
    "rarity-capped-desc"
  ])(
    "pages through mixed and Solana-only groups in both directions: %s",
    async (sort) => {
      for (const chain of ["", "&chain=solana"]) {
        const params = `sort=${sort}&limit=7${chain}`;
        const pages = [await page(params)];
        while (pages.at(-1)!.nextCursor) {
          expect(pages.length).toBeLessThan(8);
          pages.push(
            await page(`${params}&cursor=${pages.at(-1)!.nextCursor}`)
          );
        }
        const ids = pages.flatMap((p) => p.groups.map((g) => g.id));
        expect(ids).toHaveLength(chain ? 30 : 33);
        expect(new Set(ids).size).toBe(ids.length);
        for (let n = pages.length - 1; n > 0; n--) {
          const previous = await page(
            `${params}&cursor=${pages[n]!.previousCursor}`
          );
          expect(previous.groups.map((g) => g.id)).toEqual(
            pages[n - 1]!.groups.map((g) => g.id)
          );
        }
      }
    }
  );
  it("keeps ownership, mint search, and trait filters on the same NFT", async () => {
    const owner = await page(`chain=solana&owner=${solanaOwner}`, {
      solana: solanaOwner
    });
    expect(owner).toMatchObject({ groupTotal: 29, nftTotal: 29 });
    expect(
      (
        await page(`chain=solana&owner=${otherSolanaOwner}`, {
          solana: otherSolanaOwner
        })
      ).nftTotal
    ).toBe(1);
    expect(
      (await page(`chain=solana&q=${key(1)}`)).groups[0]!.members
    ).toHaveLength(1);
    expect((await page("t.Type=Water&t.Color=Blue")).groups).toEqual([]);
    expect((await page("chain=solana&t.Type=Water&t.Color=Red")).nftTotal).toBe(
      30
    );
    expect((await page("chain=solana&metadata=missing")).nftTotal).toBe(0);
    expect(
      (await page("chain=solana&rarityCappedMin=3&rarityCappedMax=3")).nftTotal
    ).toBe(7);
    expect((await page("chain=solana&q=Exomon%203")).nftTotal).toBe(2);
    expect(
      (await page(`chain=solana&q=${key(9).toLowerCase()}`)).nftTotal
    ).toBe(0);
    expect(
      (
        await page(`owner=${alice}`, {
          ethereum: alice,
          base: alice,
          polygon: alice
        })
      ).nftTotal
    ).toBe(34);
    expect(
      (
        await page(`chain=solana&owner=${solanaOwner}&visibility=hidden`, {
          solana: solanaOwner
        })
      ).nftTotal
    ).toBe(0);
  });
  it("omits hidden and burned holdings while retaining a burned counterpart reference", async () => {
    await db.exec("BEGIN");
    try {
      await db.query(
        "INSERT INTO metadata.token_visibility VALUES('base',$1,$2,1,'base:1',1,0,1)",
        [baseId(1), alice]
      );
      await db.query(
        "UPDATE solana_indexer.token SET burnt=true WHERE mint=$1",
        [key(2)]
      );
      const groups = await page();
      expect(groups.nftTotal).toBe(62);
      const info = await versionSummaries(adapter, revision, [
        {
          chain: "solana",
          contractAddress: null,
          tokenId: key(1),
          lifecycle: 1
        },
        {
          chain: "base",
          contractAddress: collections.base.address,
          tokenId: baseId(2),
          lifecycle: 1
        }
      ]);
      expect(
        (
          info[`solana:${key(1)}`] as { versions: { chain: string }[] }
        ).versions.some((v) => v.chain === "base")
      ).toBe(false);
      expect(
        info[`base:${collections.base.address}:${baseId(2)}`]
      ).toMatchObject({
        versions: expect.arrayContaining([
          expect.objectContaining({ chain: "solana", burned: true })
        ])
      });
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("reports incomplete Solana coverage and rejects stale snapshots and cursors from another scan", async () => {
    expect(await versionSolanaSnapshot(adapter)).toEqual({
      fingerprint: "checksum:1",
      unavailableNfts: 0
    });
    const first = await page("chain=solana&limit=7");
    await expect(
      page(
        `chain=solana&limit=7&cursor=${first.nextCursor}`,
        {},
        "evm:solana-2"
      )
    ).rejects.toThrow("expired");
    await db.exec("BEGIN");
    try {
      await db.exec("UPDATE solana_indexer.scan_run SET missing_count=1");
      expect(await versionSolanaSnapshot(adapter)).toMatchObject({
        unavailableNfts: 1
      });
      await db.exec(
        "UPDATE solana_indexer.scan_run SET missing_count=0,completed_at=now()-interval '25 hours'"
      );
      await expect(versionSolanaSnapshot(adapter)).rejects.toThrow(
        "solana_ownership_unavailable"
      );
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("validates the immutable Solana source hash and rejects fabricated mint evidence", async () => {
    const bad = manifestInput();
    bad.groups[0]!.members[0]!.sourceHash = assetKey(999);
    await expect(
      storeVersionManifest(
        adapter,
        parseVersionManifest(bad),
        revision,
        auditSha,
        false
      )
    ).rejects.toThrow("Solana member");
    const fabricated = manifestInput();
    fabricated.groups[0]!.members[0]!.mintTransactionHash = hash;
    expect(() => parseVersionManifest(fabricated)).toThrow("member");
    expect(() =>
      parseMonsterAsset({
        chain: "solana",
        tokenId: key(1),
        contractAddress: null,
        lifecycle: 2
      })
    ).toThrow();
  });
  it("keeps an unobserved original as an unavailable reference without inventing a holding", async () => {
    await db.exec("BEGIN");
    try {
      await db.query("DELETE FROM solana_indexer.token WHERE mint=$1", [
        key(3)
      ]);
      await db.exec("UPDATE solana_indexer.scan_run SET missing_count=1");
      const result = await page();
      expect(result.nftTotal).toBe(63);
      expect(
        result.groups
          .flatMap((g) => g.members)
          .some((m) => m.chain === "solana" && m.tokenId === key(3))
      ).toBe(false);
      const info = await versionSummaries(adapter, revision, [
        {
          chain: "base",
          contractAddress: collections.base.address,
          tokenId: baseId(3),
          lifecycle: 1
        }
      ]);
      expect(
        info[`base:${collections.base.address}:${baseId(3)}`]
      ).toMatchObject({
        versions: expect.arrayContaining([
          expect.objectContaining({
            chain: "solana",
            tokenId: key(3),
            unavailable: true,
            burned: false
          })
        ])
      });
      await expect(
        storeVersionManifest(
          adapter,
          parseVersionManifest(manifestInput()),
          revision,
          auditSha,
          false
        )
      ).resolves.toBeUndefined();
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("extends an audited Polygon/Base pair into one three-version lineage", async () => {
    const input = manifestInput();
    const group = input.groups[0]!;
    const existing = parseVersionManifest({
      ...input,
      groups: [
        {
          ...group,
          members: group.members
            .filter((m) => m.chain !== "solana")
            .map((m) => ({
              ...m,
              role: m.chain === "polygon" ? "original" : m.role
            }))
        }
      ]
    });
    const audit: BaseIdentityAudit = {
      tokenId: baseId(1),
      lifecycle: 1,
      initialOwner: alice,
      initialMint: {
        recipient: alice,
        transactionHash: hash,
        logIndex: 1,
        blockNumber: "1"
      },
      status: "matched",
      archivedOriginals: [
        {
          tokenId: key(1),
          chainId: "mainnet-beta",
          family: "GEN1",
          originType: "GEN1_EXOMON_DROP",
          minted: true,
          sourceHash: assetKey(101)
        }
      ]
    };
    const candidates = await solanaVersionCandidates(adapter, "archive", [
      audit
    ]);
    const extended = addSolanaVersionGroups(existing, candidates, auditSha);
    expect(extended.groups).toHaveLength(1);
    expect(extended.groups[0]!.members).toHaveLength(3);
    expect(
      extended.groups[0]!.members.filter((m) => m.role === "original").map(
        (m) => m.chain
      )
    ).toEqual(["solana"]);
    await expect(
      storeVersionManifest(adapter, extended, revision, auditSha, false)
    ).resolves.toBeUndefined();
    expect(
      addSolanaVersionGroups(extended, candidates, auditSha).groups
    ).toEqual(extended.groups);
    const wrong = {
      ...audit,
      archivedOriginals: [
        {
          ...audit.archivedOriginals[0]!,
          tokenId: key(2),
          sourceHash: assetKey(102)
        }
      ]
    };
    await expect(
      solanaVersionCandidates(adapter, "archive", [wrong])
    ).rejects.toThrow("canonical evidence");
  });
  it("serves Solana summaries and collector groups through read-only API snapshots", async () => {
    vi.stubEnv("API_MONSTER_GROUPING_ENABLED", "true");
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
    const app = new Hono();
    app.onError((e) => {
      throw e;
    });
    const resolveOwner = vi.fn(async (input: string) => ({
      input,
      normalizedName: null,
      addresses: { base: alice as `0x${string}` }
    }));
    registerMonsterVersionRoutes(app, { pool, resolveOwner });
    const response = await app.request(
      `/v1/monster-groups?chain=solana&owner=${solanaOwner}&limit=7`
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nftTotal: 29,
      groupTotal: 29,
      resolvedAddresses: { solana: solanaOwner }
    });
    expect(resolveOwner).not.toHaveBeenCalled();
    const summary = await app.request(
      `/v1/monster-versions?asset=solana:${key(1)}:1`
    );
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({
      items: {
        [`solana:${key(1)}`]: { role: "original", versions: expect.any(Array) }
      }
    });
    expect(statements).toContain(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    await db.exec(
      "INSERT INTO solana_indexer.scan_run(id,manifest_checksum,state,asset_count,batch_size,completed_at) VALUES(2,'checksum','published',30,30,now()); UPDATE solana_indexer.scan_run SET missing_count=1 WHERE id=1;"
    );
    await db.query(
      "UPDATE solana_indexer.token SET published_run_id=2 WHERE mint=$1",
      [key(30)]
    );
    try {
      const partial = await app.request("/v1/monster-groups?chain=solana");
      expect(partial.status).toBe(200);
      expect(await partial.json()).toMatchObject({
        unavailableNfts: 1,
        nftTotal: 29
      });
      await db.exec(
        "UPDATE solana_indexer.scan_run SET completed_at=now()-interval '25 hours' WHERE id=1"
      );
      expect(
        (await app.request("/v1/monster-groups?chain=solana")).status
      ).toBe(503);
    } finally {
      await db.exec(
        "UPDATE solana_indexer.token SET published_run_id=1; DELETE FROM solana_indexer.scan_run WHERE id=2; UPDATE solana_indexer.scan_run SET missing_count=0,completed_at=now() WHERE id=1"
      );
    }
  });
});
