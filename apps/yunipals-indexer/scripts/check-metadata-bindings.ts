import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { collections, ZERO_ADDRESS } from '../lib/constants.js';
import { archiveMigrations } from '../lib/metadata/source/schema.js';
import { ensureCandidate, beginSource, commitSourceBatch } from '../lib/metadata/source/archive.js';
import { sourceIdentity } from '../lib/metadata/source/identity.js';
import { contentHash } from '../lib/metadata/source/canonical.js';
import { ArchiveOwnershipReader, storeBindings, type BindingInput } from '../lib/metadata/source/bindings.js';
import { commitBaseMetadataRange, latestBaseMetadata, baseMetadataState, type BaseMetadataEvent } from '../lib/metadata/source/base-events.js';
import { argumentsOf, postgresFrom, safeFailure } from './metadata/support.js';
const args = argumentsOf();
async function main() {
    const { pool } = await postgresFrom(String(args['env-file']));
    try {
        assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name, /^metadata_archive_test_[a-z0-9_]+$/);
        for (const sql of archiveMigrations)
            await pool.query(sql);
        const release = `bindings-${randomUUID()}`, hash = (c: string) => `0x${c.repeat(64)}`, owner = `0x${'a'.repeat(40)}`, nextOwner = `0x${'b'.repeat(40)}`;
        await ensureCandidate(pool, release, {});
        await pool.query(`CREATE SCHEMA IF NOT EXISTS binding_check;
   CREATE TABLE IF NOT EXISTS binding_check.token(collection text,chain_id integer,contract_address text,token_id text,owner text,burned boolean,lifecycle integer,last_transfer_block bigint,last_transfer_timestamp bigint,last_transaction_hash text,PRIMARY KEY(collection,token_id));
   CREATE TABLE IF NOT EXISTS binding_check.token_lifecycle(collection text,token_id text,lifecycle integer,mint_transaction_hash text,mint_block bigint,PRIMARY KEY(collection,token_id,lifecycle));
   CREATE TABLE IF NOT EXISTS binding_check.transfer_event(collection text,token_id text,lifecycle integer,transaction_hash text,block_number bigint,"from" text,log_index integer);
   TRUNCATE binding_check.token,binding_check.token_lifecycle,binding_check.transfer_event`);
        const fixture = JSON.parse(await readFile(new URL('../test/fixtures/metadata/gen1_booster.json', import.meta.url), 'utf8'));
        const envelope = fixture.envelope, identity = sourceIdentity(envelope);
        await beginSource(pool, release, 'test.source', {}, 'one');
        await commitSourceBatch(pool, release, 'test.source', null, 'one', [{ key: 'one', payload: envelope, ...identity, burned: false }], true);
        const input: BindingInput = { collection: 'base', chainId: 8453, contractAddress: collections.base.address, tokenId: '10', lifecycle: 1, burned: false,
            tokenUri: `https://meta.yunipals.com/meta?id=${identity.legacyId}`, uriProvenance: 'current_token_uri_call', documentId: identity.legacyId, documentName: 'name',
            mintTransactionHash: hash('1'), mintLogIndex: 2, assetKey: identity.assetKey!, sourceHash: contentHash(envelope), sourceLegacyId: identity.legacyId!, family: identity.family! };
        await pool.query(`INSERT INTO binding_check.token VALUES('base',8453,$1,'10',$2,false,1,100,1700000000,$3)`, [collections.base.address, owner, hash('1')]);
        await pool.query(`INSERT INTO binding_check.token_lifecycle VALUES('base','10',1,$1,100)`, [hash('1')]);
        await pool.query(`INSERT INTO binding_check.transfer_event VALUES('base','10',1,$1,100,$2,2)`, [hash('1'), ZERO_ADDRESS]);
        const reader = new ArchiveOwnershipReader(pool, release, 'binding_check', true);
        const isolated = await new ArchiveOwnershipReader(pool, release, 'binding_check').token('base', '10');
        assert.equal(isolated!.owner, owner);
        assert.equal(isolated!.metadataStatus, 'archive_unavailable');
        assert.equal(isolated!.assetKey, null);
        assert.equal((await reader.token('base', '10'))!.metadataStatus, 'binding_unavailable');
        await storeBindings(pool, release, [input]);
        await storeBindings(pool, release, [input]);
        assert.equal((await reader.token('base', '10'))!.owner, owner);
        assert.equal((await reader.snapshot('base', '10'))!.metadata!.document.address, owner);
        assert.equal(await reader.token('ethereum', '10'), null); // same numeric ID cannot cross collection
        await assert.rejects(storeBindings(pool, release, [{ ...input, assetKey: 'f'.repeat(64) }]), /conflict/);
        await pool.query(`UPDATE binding_check.token SET owner=$1,last_transfer_block=101,last_transaction_hash=$2`, [nextOwner, hash('2')]);
        assert.equal((await reader.token('base', '10'))!.owner, nextOwner); // no archive ownership writes
        await pool.query(`UPDATE binding_check.token SET owner=$1,burned=true,last_transfer_block=102,last_transaction_hash=$2`, [ZERO_ADDRESS, hash('3')]);
        assert.equal((await reader.token('base', '10'))!.owner, null);
        assert.equal((await reader.snapshot('base', '10'))!.metadata!.document.minted, false);
        // A remint uses a new anchor even when tokenId is reused.
        await pool.query(`UPDATE binding_check.token SET owner=$1,burned=false,lifecycle=2,last_transfer_block=103,last_transaction_hash=$2`, [owner, hash('4')]);
        await pool.query(`INSERT INTO binding_check.token_lifecycle VALUES('base','10',2,$1,103)`, [hash('4')]);
        await pool.query(`INSERT INTO binding_check.transfer_event VALUES('base','10',2,$1,103,$2,7)`, [hash('4'), ZERO_ADDRESS]);
        assert.equal((await reader.token('base', '10'))!.metadataStatus, 'binding_unavailable');
        await storeBindings(pool, release, [{ ...input, lifecycle: 2, mintTransactionHash: hash('4'), mintLogIndex: 7 }]);
        assert.equal((await reader.token('base', '10'))!.assetKey, input.assetKey);
        // Rebuilding may renumber lifecycle counters; the canonical mint anchor survives.
        await pool.query(`UPDATE binding_check.token SET lifecycle=9;UPDATE binding_check.token_lifecycle SET lifecycle=9 WHERE lifecycle=2;UPDATE binding_check.transfer_event SET lifecycle=9 WHERE lifecycle=2`);
        assert.equal((await reader.token('base', '10'))!.assetKey, input.assetKey);
        // A reorg replacing the mint anchor must not attach the old asset binding.
        await pool.query(`UPDATE binding_check.token_lifecycle SET mint_transaction_hash=$1 WHERE lifecycle=9;`, [hash('5')]);
        await pool.query(`UPDATE binding_check.transfer_event SET transaction_hash=$1 WHERE lifecycle=9;`, [hash('5')]);
        assert.equal((await reader.token('base', '10'))!.metadataStatus, 'binding_unavailable');
        assert.equal((await reader.token('base', '10'))!.owner, owner);
        const name = `events-${randomUUID()}`;
        await pool.query(`DELETE FROM metadata_source.chain_metadata_event`);
        await pool.query(`INSERT INTO metadata_source.chain_metadata_scan(name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash) VALUES($1,8453,$2,100,100,105,$3)`, [name, collections.base.address, hash('f')]);
        const mint: BaseMetadataEvent = { transactionHash: hash('6'), logIndex: 0, transactionIndex: 0, blockNumber: '100', blockHash: hash('7'), eventName: 'Mint', tokenId: '10', recipient: owner,
            traits: { monsterType: 1, color: 2, horn: 3, background: 4, glitter: 0, rarityScore: '9' } };
        await commitBaseMetadataRange(pool, name, 100n, 100n, hash('7'), [mint, mint]);
        assert.equal((await latestBaseMetadata(pool, '10'))!.eventName, 'Mint');
        await assert.rejects(commitBaseMetadataRange(pool, name, 100n, 100n, hash('7'), [mint]), /checkpoint/);
        await assert.rejects(commitBaseMetadataRange(pool, name, 101n, 101n, hash('8'), [{ ...mint, blockNumber: '101' }]), /Conflicting stored/);
        assert.equal((await pool.query('SELECT next_block::text FROM metadata_source.chain_metadata_scan WHERE name=$1', [name])).rows[0].next_block, '101');
        const update = { ...mint, eventName: 'Update' as const, transactionHash: hash('8'), blockHash: hash('9'), blockNumber: '101', traits: { ...mint.traits, color: 7 } };
        await commitBaseMetadataRange(pool, name, 101n, 101n, hash('9'), [update]);
        assert.equal((await latestBaseMetadata(pool, '10'))!.traits.color, 7);
        await pool.query(`INSERT INTO metadata_source.chain_metadata_scan(name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash)
   VALUES('base_metadata_v1',8453,$1,100,102,105,$2) ON CONFLICT(name) DO UPDATE SET next_block=102,target_block=105`, [collections.base.address, hash('f')]);
        assert.equal((await baseMetadataState(pool, '10')).status, 'catching_up');
        assert.equal((await baseMetadataState(pool, '10')).event.traits.color, 7);
        await assert.rejects(commitBaseMetadataRange(pool, name, 102n, 102n, hash('a'), [{ ...update, blockNumber: '102', traits: { ...update.traits, horn: 65536 } }]));
        await commitBaseMetadataRange(pool, name, 102n, 104n, hash('a'), [{ ...update, transactionHash: hash('a'), blockHash: hash('a'), blockNumber: '104', traits: { ...update.traits, color: 9 } }]);
        assert.equal((await baseMetadataState(pool, '10')).event.traits.color, 7); // never expose events beyond the reported checkpoint
        await pool.query(`UPDATE metadata_source.chain_metadata_scan SET next_block=106 WHERE name='base_metadata_v1'`);
        assert.equal((await baseMetadataState(pool, '10')).status, 'scanned');
        assert.equal((await baseMetadataState(pool, '10')).event.traits.color, 9);
        assert.equal((await baseMetadataState(pool, '11')).event, null);
        await pool.query(`UPDATE metadata_source.archive_release SET state='validated' WHERE release_id=$1`, [release]);
        await assert.rejects(storeBindings(pool, release, [input]));
        console.log('PASS: candidate isolation; ownership transfer/burn/remint; stable mint anchoring across rebuild; reorg isolation; missing metadata ownership; binding conflicts; Base event ordering, duplicate/conflict handling and atomic checkpoints');
    }
    finally {
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
