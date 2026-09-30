import { createPublicClient, http } from "viem";
import type { Pool } from "pg";
import { base } from "viem/chains";
import { collections } from "../constants.js";
import { baseRpcUrlOf } from "../rpc.js";
import { baseMetadataAbi, commitBaseMetadataRange, type BaseMetadataEvent } from "./source/base-events.js";
async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 0;; attempt++)
        try {
            return await operation();
        }
        catch (error) {
            const causes = [];
            for (let e: any = error; e; e = e.cause)
                causes.push(e);
            if (attempt >= attempts || causes.some(e => e.name === "ResponseBodyTooLargeError" || e.code === -32005 || [400, 413].includes(e.status) || /response body too large|too many results|block range|limit the query/i.test(e.details ?? "")))
                throw error;
            await new Promise(resolve => setTimeout(resolve, Math.min(15000, 1000 * 2 ** attempt)));
        }
}
export async function replayBaseMetadata(pool: Pool, env: NodeJS.ProcessEnv, options: { advance?: boolean; range?: number; maxRanges?: number; includeCounts?: boolean; stopping?: () => boolean } = {}) {
    const name = "base_metadata_v1", stopping = options.stopping ?? (() => false);
    let range = options.range ?? 10000;
    if (!Number.isSafeInteger(range) || range < 1 || range > 100000) throw new Error("Invalid block range");
    const client = createPublicClient({ chain: base, transport: http(baseRpcUrlOf(env), { retryCount: 0, timeout: 30000 }) });
    const lock = await pool.connect();
    const acquired = (await lock.query("SELECT pg_try_advisory_lock(hashtext('metadata:base-replay')) AS acquired")).rows[0].acquired;
    if (!acquired) { lock.release(); return { busy: true }; }
    const maximumRange = range;
    try {
        const final = await retry(() => client.getBlock({ blockTag: "finalized" }));
        if (!final.number || !final.hash)
            throw new Error("Finalized Base block unavailable");
        await pool.query(`INSERT INTO metadata_source.chain_metadata_scan(name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash)
   VALUES($1,8453,$2,$3,$3,$4,$5) ON CONFLICT DO NOTHING`, [name, collections.base.address, collections.base.deploymentBlock, final.number.toString(), final.hash]);
        let scan = (await pool.query("SELECT * FROM metadata_source.chain_metadata_scan WHERE name=$1", [name])).rows[0];
        if (options.advance && BigInt(scan.next_block) > BigInt(scan.target_block)) {
            // A lagging RPC backend can report an older finalized tag. Keep
            // serving the stored checkpoint if its block hash still matches;
            // never move the target backward or skip the hash checks below.
            if (final.number >= BigInt(scan.target_block)) {
                if ((await client.getBlock({ blockNumber: BigInt(scan.target_block) })).hash !== scan.target_hash)
                    throw new Error("Previously finalized Base checkpoint changed");
                await pool.query("UPDATE metadata_source.chain_metadata_scan SET target_block=$2,target_hash=$3 WHERE name=$1", [name, final.number.toString(), final.hash]);
                scan = (await pool.query("SELECT * FROM metadata_source.chain_metadata_scan WHERE name=$1", [name])).rows[0];
            }
        }
        if ((await client.getBlock({ blockNumber: BigInt(scan.target_block) })).hash !== scan.target_hash)
            throw new Error("Base scan target hash changed");
        const implementation = await retry(() => client.getStorageAt({ address: collections.base.address,
            slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", blockNumber: BigInt(scan.target_block) }));
        if (implementation?.slice(-40).toLowerCase() !== "4ad380760abb9fad95cd48ef2d7c46ed5a072fca")
            throw new Error("Base implementation needs ABI review");
        if (scan.last_scanned_hash && (await client.getBlock({ blockNumber: BigInt(scan.next_block) - 1n })).hash !== scan.last_scanned_hash)
            throw new Error("Base scan checkpoint hash changed");
        let from = BigInt(scan.next_block), requests = 0, observed = 0;
        while (!stopping() && from <= BigInt(scan.target_block) && requests < (options.maxRanges ?? Infinity)) {
            const to = from + BigInt(range) - 1n < BigInt(scan.target_block) ? from + BigInt(range) - 1n : BigInt(scan.target_block);
            let logs;
            try {
                logs = await retry(() => client.getLogs({ address: collections.base.address, events: baseMetadataAbi.filter(a => a.type === "event"), fromBlock: from, toBlock: to, strict: false }), range === 1 ? 3 : 0);
            }
            catch (error) {
                if (stopping() || range <= 1)
                    throw error;
                console.log(JSON.stringify({ retryFrom: from.toString(), reducedRange: Math.max(1, Math.floor(range / 2)), error: "rpc_range_failed" }));
                range = Math.max(1, Math.floor(range / 2));
                continue;
            }
            const block = await retry(() => client.getBlock({ blockNumber: to }));
            if (!block.hash)
                throw new Error("Base range endpoint unavailable");
            const events: BaseMetadataEvent[] = logs.map(log => {
                if (log.removed || !log.transactionHash || log.logIndex === null || log.transactionIndex === null || log.blockNumber === null || !log.blockHash || !log.args.yunipal || log.args.tokenId === undefined || !log.args.to)
                    throw new Error("Incomplete Base metadata log");
                const value = log.args.yunipal;
                return { transactionHash: log.transactionHash, logIndex: log.logIndex, transactionIndex: log.transactionIndex, blockNumber: log.blockNumber.toString(), blockHash: log.blockHash,
                    eventName: log.eventName, tokenId: log.args.tokenId.toString(), recipient: log.args.to.toLowerCase(), traits: { ...value, rarityScore: value.rarityScore.toString() } };
            });
            await commitBaseMetadataRange(pool, name, from, to, block.hash, events);
            observed += events.length;
            from = to + 1n;
            requests++;
            if (events.length < 100 && range < maximumRange)
                range = Math.min(maximumRange, range * 2);
            if (requests % 25 === 0 || from > BigInt(scan.target_block))
                console.log(JSON.stringify({ from: from.toString(), target: scan.target_block, range, observedThisInvocation: observed }));
        }
        if (from > BigInt(scan.target_block) && (await client.getBlock({ blockNumber: BigInt(scan.target_block) })).hash !== scan.target_hash)
            throw new Error("Finalized Base target changed during scan");
        const report = { observedAt: new Date().toISOString(), complete: from > BigInt(scan.target_block), checkpoint: (await pool.query("SELECT * FROM metadata_source.chain_metadata_scan WHERE name=$1", [name])).rows[0],
            counts: options.includeCounts ? (await pool.query("SELECT event_name,count(*)::text FROM metadata_source.chain_metadata_event WHERE chain_id=8453 AND contract_address=$1 GROUP BY event_name", [collections.base.address])).rows : undefined };
        return report;
    }
    finally {
        await lock.query("SELECT pg_advisory_unlock(hashtext('metadata:base-replay'))").finally(() => lock.release());
    }
}
