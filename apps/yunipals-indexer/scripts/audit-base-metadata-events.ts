import { createPublicClient, http } from 'viem';
import {readFile} from 'node:fs/promises';
import { collections } from '../lib/constants.js';
import { baseRpcUrlOf } from '../lib/rpc.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { canonicalJson } from '../lib/metadata/source/canonical.js';
import { baseMetadataAbi } from '../lib/metadata/source/base-events.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';
const args = argumentsOf({resume:{type:'boolean',default:false}});
async function main() {
    const { pool, env } = await postgresFrom(String(args['env-file'])), schema = sqlIdentifier(env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA);
    try {
        const scan = (await pool.query("SELECT * FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1'")).rows[0];
        if (!scan || BigInt(scan.next_block) <= BigInt(scan.target_block))
            throw new Error('Finish Base replay before auditing');
        const rpc = createPublicClient({ transport: http(baseRpcUrlOf(env), { retryCount: 2, timeout: 20000 }) }), block = BigInt(scan.target_block);
        if ((await rpc.getBlock({ blockNumber: block })).hash !== scan.target_hash)
            throw new Error('Finalized Base target changed');
        const implementation = await rpc.getStorageAt({ address: collections.base.address, slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', blockNumber: block });
        if (implementation?.slice(-40).toLowerCase() !== '4ad380760abb9fad95cd48ef2d7c46ed5a072fca')
            throw new Error('Base ABI implementation needs review');
        const coverage = (await pool.query(`WITH m AS MATERIALIZED(SELECT * FROM metadata_source.chain_metadata_event WHERE chain_id=8453 AND contract_address=$1 AND event_name='Mint')
   SELECT count(*)::text AS indexed_mints,count(*) FILTER(WHERE m.token_id IS NULL)::text AS missing_mint,
    count(*) FILTER(WHERE m.block_number IS DISTINCT FROM l.mint_block OR m.recipient IS DISTINCT FROM l.minted_to)::text AS inconsistent_mint
   FROM ${schema}.token_lifecycle l LEFT JOIN m ON m.token_id=l.token_id AND m.transaction_hash=l.mint_transaction_hash
   WHERE l.collection='base' AND l.mint_block<=$2`, [collections.base.address, scan.target_block])).rows[0];
        const eventCounts = (await pool.query(`SELECT event_name,count(*)::text AS events,count(DISTINCT token_id)::text AS tokens FROM metadata_source.chain_metadata_event
   WHERE chain_id=8453 AND contract_address=$1 GROUP BY event_name`, [collections.base.address])).rows;
        const rows = (await pool.query(`WITH latest AS MATERIALIZED(SELECT DISTINCT ON(token_id) token_id,traits,event_name,block_number FROM metadata_source.chain_metadata_event
   WHERE chain_id=8453 AND contract_address=$1 ORDER BY token_id,block_number DESC,transaction_index DESC,log_index DESC)
   (SELECT * FROM latest ORDER BY md5(token_id) LIMIT 20) UNION (SELECT * FROM latest WHERE event_name='Update' ORDER BY block_number DESC LIMIT 10)`, [collections.base.address])).rows;
        const previous=args.resume?JSON.parse(await readFile('docs/metadata-migration/base-event-validation.json','utf8')):null;
        if(previous&&previous.checkpoint.target_hash!==scan.target_hash)throw new Error('Sample checkpoint changed');
        const samples = [];
        for (const row of rows) {
            const prior=previous?.samples.find((s:any)=>s.id===row.token_id&&s.status==='matched');
            if(prior){samples.push(prior);continue;}
            let status = 'rpc_failed';
            let failure:string|undefined;
            for(let attempt=0;attempt<3&&status==='rpc_failed';attempt++)try {
                await new Promise(resolve=>setTimeout(resolve,attempt?5000:1000));
                const value = await rpc.readContract({ address: collections.base.address, abi: baseMetadataAbi, functionName: 'yunipal', args: [BigInt(row.token_id)], blockNumber: block });
                status = canonicalJson({ ...value, rarityScore: value.rarityScore.toString() }) === canonicalJson(row.traits) ? 'matched' : 'mismatch';
            }
            catch(e) {failure=e instanceof Error?e.name:'Error';}
            samples.push({ id: row.token_id, lastEvent: row.event_name, eventBlock: String(row.block_number), status,...(status==='rpc_failed'?{failure}:{}) });
        }
        const complete = coverage.missing_mint === '0' && coverage.inconsistent_mint === '0' && eventCounts.find(r => r.event_name === 'Mint')?.events === coverage.indexed_mints && samples.length > 0 && samples.every(s => s.status === 'matched');
        const report = { observedAt: new Date().toISOString(), complete, checkpoint: scan, coverage, eventCounts, samples,
            interpretation: 'Verified raw on-chain tuples and event provenance. Archived names/images remain historical source metadata; numeric fields are not guessed into legacy names.' };
        await writeReport('docs/metadata-migration/base-event-validation.json', report);
        console.log(JSON.stringify(report));
        if (!complete)
            process.exitCode = 2;
    }
    finally {
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
