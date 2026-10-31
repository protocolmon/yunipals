import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("../lib/offchain/sql.js", () => ({
  ownershipPonderSchema: "mint_evm",
  ownershipBnbSchema: "mint_bnb"
}));
import {
  initialOwnerPageQuery,
  initialOwnerScanQuery,
  readInitialOwnerPage,
  classifyInitialOwner,
  type InitialOwnerRow
} from "../lib/versions/initial-owners.js";
import { collections, ZERO_ADDRESS } from "../lib/constants.js";

const alice = `0x${"1".repeat(40)}`,
  bob = `0x${"2".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`,
  otherHash = `0x${"b".repeat(64)}`;
describe("Base initial-owner reconstruction", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA mint_evm; CREATE SCHEMA mint_bnb; CREATE SCHEMA metadata_source;
      CREATE TABLE mint_evm.token(collection text,chain_id int,contract_address text,token_id text,owner text,burned boolean,lifecycle int,PRIMARY KEY(collection,token_id));
      CREATE TABLE mint_evm.token_lifecycle(collection text,token_id text,lifecycle int,minted_to text,mint_transaction_hash text,mint_block numeric);
      CREATE TABLE mint_evm.transfer_event(collection text,token_id text,lifecycle int,chain_id int,contract_address text,"from" text,"to" text,transaction_hash text,block_number numeric,transaction_index int,log_index int);
      CREATE TABLE mint_bnb.token(LIKE mint_evm.token); CREATE TABLE mint_bnb.token_lifecycle(LIKE mint_evm.token_lifecycle); CREATE TABLE mint_bnb.transfer_event(LIKE mint_evm.transfer_event);
      CREATE TABLE metadata_source.lifecycle_binding(release_id text,chain_id text,contract_address text,token_id text,mint_transaction_hash text,mint_log_index int,asset_key text);
      CREATE TABLE metadata_source.source_record(release_id text,asset_key text,chain_id text,legacy_id text,issue text,family text,origin_type text,content_hash text);
      CREATE TABLE metadata_source.source_blob(content_hash text,payload jsonb);
      INSERT INTO mint_evm.token SELECT 'base',8453,'${collections.base.address}',id,'${bob}',false,1 FROM unnest(ARRAY['1','2','3','4','5','9007199254740993000000000000000']) id;
      INSERT INTO mint_evm.token SELECT 'ethereum',1,'${collections.ethereum.address}',id,'${alice}',false,1 FROM unnest(ARRAY['1','4']) id;
      INSERT INTO mint_bnb.token VALUES('bnb',56,'${collections.bnb.address}','4','${alice}',false,1);
      INSERT INTO mint_evm.token_lifecycle SELECT collection,token_id,1,'${alice}','${hash}',100 FROM mint_evm.token;
      INSERT INTO mint_bnb.token_lifecycle SELECT collection,token_id,1,'${alice}','${hash}',100 FROM mint_bnb.token;
      INSERT INTO mint_evm.transfer_event SELECT collection,token_id,1,chain_id,contract_address,'${ZERO_ADDRESS}','${alice}','${hash}',100,0,0 FROM mint_evm.token WHERE token_id<>'3';
      INSERT INTO mint_bnb.transfer_event SELECT collection,token_id,1,chain_id,contract_address,'${ZERO_ADDRESS}','${alice}','${hash}',100,0,0 FROM mint_bnb.token;
      UPDATE mint_evm.token SET lifecycle=2 WHERE collection='base' AND token_id='2';
      INSERT INTO mint_evm.token_lifecycle VALUES('base','2',2,'${bob}','${otherHash}',200);
      INSERT INTO mint_evm.transfer_event VALUES('base','2',2,8453,'${collections.base.address}','${ZERO_ADDRESS}','${bob}','${otherHash}',200,0,0);
      INSERT INTO metadata_source.lifecycle_binding SELECT 'archive',chain_id::text,contract_address,token_id,'${hash}',0,CASE token_id WHEN '1' THEN 'key1' WHEN '4' THEN 'key4' ELSE 'other' END FROM mint_evm.token WHERE token_id IN ('1','4');
      INSERT INTO metadata_source.lifecycle_binding VALUES('archive','56','${collections.bnb.address}','4','${hash}',0,'key4'),('archive','8453','${collections.base.address}','2','${otherHash}',0,'key1');
      INSERT INTO metadata_source.source_record VALUES('archive','key1','56','1',NULL,'GEN1','GEN1_BOOSTER','source1'),('archive','key4','1','4',NULL,'GEN1','GEN1_BOOSTER','source4'),('archive','key4','56','4',NULL,'GEN1','GEN1_BOOSTER','source4'),('archive','unminted','56','9007199254740993000000000000000',NULL,'GEN1_SS001E001','GEN1_NFB','unminted');
      INSERT INTO metadata_source.source_blob VALUES('source1','{"minted":true}'),('source4','{"minted":true}'),('unminted','{"minted":false}');
      INSERT INTO metadata_source.lifecycle_binding VALUES('archive','8453','${collections.base.address}','9007199254740993000000000000000','${hash}',0,'unminted');
    `);
  }, 30_000);
  afterAll(async () => {
    await db?.close();
  });
  async function page(after = "", limit = 500) {
    const adapter = { query: db.query.bind(db) } as unknown as Parameters<
      typeof readInitialOwnerPage
    >[0];
    return readInitialOwnerPage(adapter, "archive", after, limit);
  }
  it("recovers the first mint recipient even after transfers and remints", async () => {
    const rows = await page();
    const first = classifyInitialOwner(rows.find((r) => r.tokenId === "1")!);
    expect(first).toMatchObject({
      initialOwner: alice,
      currentOwner: bob,
      status: "matched",
      original: { chain: "ethereum", tokenId: "1" }
    });
    const remint = classifyInitialOwner(rows.find((r) => r.tokenId === "2")!);
    expect(remint).toMatchObject({
      initialOwner: alice,
      currentOwner: bob,
      status: "reminted",
      original: null
    });
    expect(remint.initialMint?.transactionHash).toBe(hash);
    const incomplete = classifyInitialOwner({
      ...rows.find((r) => r.tokenId === "1")!,
      lifecycle: 2,
      firstLifecycle: 2
    });
    expect(incomplete).toMatchObject({
      status: "incomplete_history",
      initialOwner: null,
      initialMint: null,
      original: null
    });
  });
  it("isolates missing mints, ambiguous sources and absent bindings", async () => {
    const rows = await page();
    const statuses = Object.fromEntries(
      rows.map((r) => [r.tokenId, classifyInitialOwner(r).status])
    );
    expect(statuses).toMatchObject({
      "3": "missing_mint",
      "4": "ambiguous_source",
      "5": "missing_binding"
    });
    expect(
      classifyInitialOwner(rows.find((r) => r.tokenId === "4")!).base
    ).toBeNull();
  });
  it("uses canonical identity across chains and distinguishes an archived monster from an indexed NFT", async () => {
    const rows = await page();
    const moved = classifyInitialOwner(rows.find((r) => r.tokenId === "1")!);
    expect(moved.archivedOriginals).toEqual([
      expect.objectContaining({ chainId: "56", tokenId: "1", minted: true })
    ]);
    expect(moved.original?.chain).toBe("ethereum");
    const archived = classifyInitialOwner(
      rows.find((r) => r.tokenId === "9007199254740993000000000000000")!
    );
    expect(archived).toMatchObject({
      status: "original_not_indexed",
      original: null,
      archivedOriginals: [
        {
          tokenId: "9007199254740993000000000000000",
          minted: false,
          family: "GEN1_SS001E001"
        }
      ]
    });
    await db.exec("BEGIN");
    try {
      await db.exec(
        "UPDATE metadata_source.lifecycle_binding SET asset_key='unrelated' WHERE chain_id='1' AND token_id='1'"
      );
      const changed = classifyInitialOwner(
        (await page()).find((r) => r.tokenId === "1")!
      );
      expect(changed.status).toBe("original_not_indexed");
      expect(changed.original).toBeNull();
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("uses the archived original ID when it differs from the Base token ID", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec(`UPDATE mint_evm.token SET token_id='123' WHERE collection='ethereum' AND token_id='1';
        UPDATE mint_evm.token_lifecycle SET token_id='123' WHERE collection='ethereum' AND token_id='1';
        UPDATE mint_evm.transfer_event SET token_id='123' WHERE collection='ethereum' AND token_id='1';
        UPDATE metadata_source.lifecycle_binding SET token_id='123' WHERE chain_id='1' AND token_id='1';
        UPDATE metadata_source.source_record SET legacy_id='123' WHERE asset_key='key1';`);
      const result = classifyInitialOwner(
        (await page()).find((r) => r.tokenId === "1")!
      );
      expect(result).toMatchObject({
        status: "matched",
        tokenId: "1",
        original: { chain: "ethereum", tokenId: "123", assetKey: "key1" }
      });
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("preserves a Solana original mint address without inventing an EVM counterpart", async () => {
    const mint = "DmYtG2zJsNk2xpC83dK3s3iFqcZ2FtxxYK8niock9unJ";
    await db.exec("BEGIN");
    try {
      await db.exec(`INSERT INTO mint_evm.token VALUES('base',8453,'${collections.base.address}','6','${bob}',false,1);
        INSERT INTO mint_evm.token_lifecycle VALUES('base','6',1,'${alice}','${hash}',100);
        INSERT INTO mint_evm.transfer_event VALUES('base','6',1,8453,'${collections.base.address}','${ZERO_ADDRESS}','${alice}','${hash}',100,0,0);
        INSERT INTO metadata_source.lifecycle_binding VALUES('archive','8453','${collections.base.address}','6','${hash}',0,'solana');
        INSERT INTO metadata_source.source_record VALUES('archive','solana','mainnet-beta','${mint}',NULL,'GEN1','GEN1_EXOMON_DROP','solana');
        INSERT INTO metadata_source.source_blob VALUES('solana','{"minted":true}');`);
      const result = classifyInitialOwner(
        (await page()).find((r) => r.tokenId === "6")!
      );
      expect(result).toMatchObject({
        status: "original_not_indexed",
        original: null,
        archivedOriginals: [
          { tokenId: mint, chainId: "mainnet-beta", minted: true }
        ]
      });
      await db.exec(`INSERT INTO mint_evm.token VALUES('polygon',137,'${collections.polygon.address}','6','${alice}',false,1);
        INSERT INTO mint_evm.token_lifecycle VALUES('polygon','6',1,'${alice}','${hash}',100);
        INSERT INTO mint_evm.transfer_event VALUES('polygon','6',1,137,'${collections.polygon.address}','${ZERO_ADDRESS}','${alice}','${hash}',100,0,0);
        INSERT INTO metadata_source.lifecycle_binding VALUES('archive','137','${collections.polygon.address}','6','${hash}',0,'solana');`);
      const evmVersion = classifyInitialOwner(
        (await page()).find((r) => r.tokenId === "6")!
      );
      expect(evmVersion).toMatchObject({
        status: "matched",
        original: { chain: "polygon", tokenId: "6", assetKey: "solana" },
        archivedOriginals: [{ tokenId: mint, chainId: "mainnet-beta" }]
      });
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("pages through every NFT exactly once without losing large token IDs", async () => {
    const ids: string[] = [];
    let after = "";
    while (true) {
      const rows = await page(after, 2);
      if (!rows.length) break;
      ids.push(...rows.map((r) => r.tokenId));
      after = rows.at(-1)!.tokenId;
    }
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toContain("9007199254740993000000000000000");
    expect(() => initialOwnerPageQuery("archive", "", 501)).toThrow();
  });
  it("streams all initial owners through one read-only database cursor", async () => {
    await db.exec("BEGIN READ ONLY");
    try {
      const q = initialOwnerScanQuery("archive");
      await db.query(
        "DECLARE base_initial_owner_scan NO SCROLL CURSOR FOR " + q.text,
        q.values
      );
      const ids: string[] = [];
      while (true) {
        const rows = (
          await db.query<InitialOwnerRow>(
            "FETCH FORWARD 2 FROM base_initial_owner_scan"
          )
        ).rows;
        if (!rows.length) break;
        ids.push(...rows.map((r) => r.tokenId));
        expect(
          rows.every(
            (r) => r.firstMints[0]?.recipient === alice || r.tokenId === "3"
          )
        ).toBe(true);
      }
      expect(new Set(ids).size).toBe(6);
      expect(ids).toHaveLength(6);
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("continues across short snapshots without repeating or skipping NFTs", async () => {
    let after = "";
    const ids: string[] = [];
    while (true) {
      await db.exec("BEGIN READ ONLY");
      let rows: InitialOwnerRow[] = [];
      try {
        const q = initialOwnerScanQuery("archive", after, 3);
        await db.query(
          "DECLARE base_initial_owner_scan NO SCROLL CURSOR FOR " + q.text,
          q.values
        );
        rows = (
          await db.query<InitialOwnerRow>(
            "FETCH ALL FROM base_initial_owner_scan"
          )
        ).rows;
      } finally {
        await db.exec("ROLLBACK");
      }
      if (!rows.length) break;
      expect(rows.every((r) => r.tokenId > after)).toBe(true);
      ids.push(...rows.map((r) => r.tokenId));
      after = rows.at(-1)!.tokenId;
    }
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});
