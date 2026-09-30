import { parseAbi } from "viem";
import { z } from "zod";
import type { Pool } from "pg";
import { collections } from "../../constants.js";
import { canonicalJson } from "./canonical.js";
// Exact-match verified implementation 0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca.
export const baseMetadataAbi = parseAbi([
    "event Mint(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
    "event Update(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
    "function yunipal(uint256 tokenId) view returns ((uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore))"
]);
export const baseTraitsSchema = z.object({ monsterType: z.number().int().min(0).max(65535), color: z.number().int().min(0).max(65535),
    horn: z.number().int().min(0).max(65535), background: z.number().int().min(0).max(255), glitter: z.number().int().min(0).max(255),
    rarityScore: z.string().regex(/^\d+$/).refine(v => BigInt(v) < 2n ** 40n) }).strict();
export type BaseMetadataEvent = {
    transactionHash: string;
    logIndex: number;
    transactionIndex: number;
    blockNumber: string;
    blockHash: string;
    eventName: "Mint" | "Update";
    tokenId: string;
    recipient: string;
    traits: z.infer<typeof baseTraitsSchema>;
};
export async function commitBaseMetadataRange(pool: Pool, name: string, from: bigint, to: bigint, hash: string, events: BaseMetadataEvent[]) {
    if (from < 0n || to < from || !/^0x[0-9a-f]{64}$/.test(hash))
        throw new Error("Invalid Base event range");
    const identities = new Map<string, string>();
    for (const event of events) {
        baseTraitsSchema.parse(event.traits);
        if (BigInt(event.blockNumber) < from || BigInt(event.blockNumber) > to || !/^0x[0-9a-f]{64}$/.test(event.transactionHash)
            || !/^0x[0-9a-f]{64}$/.test(event.blockHash) || !/^0x[0-9a-f]{40}$/.test(event.recipient)
            || !/^(0|[1-9]\d*)$/.test(event.tokenId) || BigInt(event.tokenId) >= 2n ** 256n || !["Mint", "Update"].includes(event.eventName) || !Number.isSafeInteger(event.logIndex) || event.logIndex < 0
            || !Number.isSafeInteger(event.transactionIndex) || event.transactionIndex < 0)
            throw new Error("Invalid Base event identity");
        const key = `${event.transactionHash}:${event.logIndex}`, encoded = canonicalJson(event);
        if (identities.has(key) && identities.get(key) !== encoded)
            throw new Error("Conflicting Base event identity");
        identities.set(key, encoded);
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const cursor = (await client.query("SELECT next_block::text,chain_id,contract_address,target_block::text FROM metadata_source.chain_metadata_scan WHERE name=$1 FOR UPDATE", [name])).rows[0];
        if (!cursor || BigInt(cursor.next_block) !== from || cursor.chain_id !== 8453 || cursor.contract_address !== collections.base.address || to > BigInt(cursor.target_block))
            throw new Error("Base event checkpoint changed");
        await client.query(`INSERT INTO metadata_source.chain_metadata_event(chain_id,contract_address,transaction_hash,log_index,transaction_index,block_number,block_hash,event_name,token_id,recipient,traits)
   SELECT 8453,$1,"transactionHash","logIndex","transactionIndex","blockNumber"::bigint,"blockHash","eventName","tokenId",recipient,traits
   FROM jsonb_to_recordset($2::jsonb) AS x("transactionHash" text,"logIndex" integer,"transactionIndex" integer,"blockNumber" text,"blockHash" text,"eventName" text,"tokenId" text,recipient text,traits jsonb)
   ON CONFLICT DO NOTHING`, [collections.base.address, canonicalJson(events)]);
        const conflict = await client.query(`SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS x("transactionHash" text,"logIndex" integer,"transactionIndex" integer,"blockNumber" text,"blockHash" text,"eventName" text,"tokenId" text,recipient text,traits jsonb)
   JOIN metadata_source.chain_metadata_event e ON e.chain_id=8453 AND e.contract_address=$1 AND e.transaction_hash=x."transactionHash" AND e.log_index=x."logIndex"
   WHERE (e.transaction_index,e.block_number,e.block_hash,e.event_name,e.token_id,e.recipient,e.traits)
    IS DISTINCT FROM (x."transactionIndex",x."blockNumber"::bigint,x."blockHash",x."eventName",x."tokenId",x.recipient,x.traits) LIMIT 1`, [collections.base.address, canonicalJson(events)]);
        if (conflict.rowCount)
            throw new Error("Conflicting stored Base event");
        await client.query("UPDATE metadata_source.chain_metadata_scan SET next_block=$2,last_scanned_hash=$3,updated_at=now() WHERE name=$1", [name, (to + 1n).toString(), hash]);
        await client.query("COMMIT");
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}
export async function latestBaseMetadata(pool: Pool, tokenId: string) {
    const result = await pool.query(`SELECT event_name AS "eventName",traits,block_number::text AS "blockNumber",block_hash AS "blockHash",
  transaction_hash AS "transactionHash",log_index AS "logIndex" FROM metadata_source.chain_metadata_event
  WHERE chain_id=8453 AND contract_address=$1 AND token_id=$2 ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`, [collections.base.address, tokenId]);
    return result.rows[0] ?? null;
}
/** Chain tuples are explicit facts; numeric traits are not guessed into names/images. */
export async function baseMetadataState(pool: Pool, tokenId: string) {
    const scan = (await pool.query(`SELECT s.next_block::text,s.target_block::text,s.target_hash,row_to_json(e) AS event
  FROM metadata_source.chain_metadata_scan s LEFT JOIN LATERAL(
   SELECT event_name AS "eventName",traits,block_number::text AS "blockNumber",block_hash AS "blockHash",transaction_hash AS "transactionHash",log_index AS "logIndex"
   FROM metadata_source.chain_metadata_event WHERE chain_id=s.chain_id AND contract_address=s.contract_address AND token_id=$2 AND block_number<s.next_block
   ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1) e ON true
  WHERE s.name='base_metadata_v1' AND s.chain_id=8453 AND s.contract_address=$1`, [collections.base.address, tokenId])).rows[0];
    if (!scan)
        return { status: "unavailable" as const, event: null };
    return { status: BigInt(scan.next_block) > BigInt(scan.target_block) ? "scanned" as const : "catching_up" as const,
        asOfBlock: (BigInt(scan.next_block) - 1n).toString(), targetBlock: scan.target_block, targetHash: scan.target_hash, event: scan.event };
}
