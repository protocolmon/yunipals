import { createPublicClient, http, parseAbi, ContractFunctionRevertedError, BaseError } from 'viem';
import { collections, collectionSlugs, ZERO_ADDRESS } from '../lib/constants.js';
import { baseRpcUrlOf, polygonRpcUrlOf, bnbRpcUrlOf } from '../lib/rpc.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';
const args = argumentsOf({ release: { type: 'string' }, output: { type: 'string', default: 'docs/metadata-migration/ownership-validation.json' } }), abi = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']);
async function main() {
    const { pool, env } = await postgresFrom(String(args['env-file'])), schema = sqlIdentifier(env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA);
    try {
        const consistency = (await pool.query(`WITH latest AS MATERIALIZED(SELECT DISTINCT ON(collection,token_id) collection,token_id,lifecycle,"to",block_number,transaction_hash
   FROM ${schema}.transfer_event ORDER BY collection,token_id,block_number DESC,transaction_index DESC,log_index DESC)
   SELECT t.collection,count(*)::text AS tokens,count(*) FILTER(WHERE e.token_id IS NULL)::text AS missing_event,
    count(*) FILTER(WHERE t.owner IS DISTINCT FROM e."to" OR t.burned IS DISTINCT FROM (e."to"=$1) OR t.lifecycle IS DISTINCT FROM e.lifecycle
     OR t.last_transfer_block IS DISTINCT FROM e.block_number OR t.last_transaction_hash IS DISTINCT FROM e.transaction_hash)::text AS mismatches
   FROM ${schema}.token t LEFT JOIN latest e ON e.collection=t.collection AND e.token_id=t.token_id GROUP BY t.collection`, [ZERO_ADDRESS])).rows;
        const samples = [];
        for (const collection of collectionSlugs) {
            const rows = (await pool.query(`(SELECT token_id,owner,burned,last_transfer_block::text AS block FROM ${schema}.token WHERE collection=$1 AND NOT burned ORDER BY token_id LIMIT 3)
    UNION ALL (SELECT token_id,owner,burned,last_transfer_block::text AS block FROM ${schema}.token WHERE collection=$1 AND burned ORDER BY token_id LIMIT 2)`, [collection])).rows;
            const url = collection === 'base' ? baseRpcUrlOf(env) : collection === 'polygon' ? polygonRpcUrlOf(env) : collection === 'bnb' ? bnbRpcUrlOf(env) : env.PONDER_RPC_URL_1;
            const rpc = createPublicClient({ transport: http(url, { retryCount: 2, timeout: 20000 }) });
            for (const row of rows) {
                let status = 'rpc_failed';
                try {
                    const owner = await rpc.readContract({ address: collections[collection].address, abi, functionName: 'ownerOf', args: [BigInt(row.token_id)], blockNumber: BigInt(row.block) });
                    status = !row.burned && owner.toLowerCase() === row.owner.toLowerCase() ? 'matched' : 'mismatch';
                }
                catch (e) {
                    if (row.burned && e instanceof BaseError && e.walk(c => c instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError)
                        status = 'burn_revert_confirmed';
                }
                samples.push({ collection, id: row.token_id, block: row.block, burned: row.burned, status });
            }
        }
        const report = { release: args.release, observedAt: new Date().toISOString(), scope: 'Existing Ethereum/Base/Polygon/BNB canonical index. Full event consistency at a PostgreSQL statement snapshot; bounded ownerOf checks at the indexed last transfer block.', consistency, samples };
        await writeReport(String(args.output), report);
        console.log(JSON.stringify(report));
        if (consistency.some(r => r.missing_event !== '0' || r.mismatches !== '0') || samples.some(r => !['matched', 'burn_revert_confirmed'].includes(r.status)))
            process.exitCode = 2;
    }
    finally {
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
