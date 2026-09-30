import { describe, it, expect } from 'vitest';
import { metadataLookupId, verifyBinding, type BindingInput } from '../lib/metadata/source/bindings.js';
import { collections } from '../lib/constants.js';
import { sourceIdentity } from '../lib/metadata/source/identity.js';
import { sourceDifference } from '../lib/metadata/source/reconcile.js';
const binding: BindingInput = { collection: 'base', chainId: 8453, contractAddress: collections.base.address, tokenId: '10', lifecycle: 1, burned: false,
    tokenUri: 'https://meta.yunipals.com/meta?id=10', uriProvenance: 'current_base_formula', documentId: '10', documentName: 'name',
    mintTransactionHash: `0x${'1'.repeat(64)}`, mintLogIndex: 0, assetKey: '2'.repeat(64), sourceHash: '1'.repeat(64), sourceLegacyId: '10', family: 'GEN1' };
describe('verified archive bindings', () => {
    it('requires observed metadata URI evidence and configured contract identity', () => {
        expect(verifyBinding(binding).lookupId).toBe('10');
        for (const patch of [{ chainId: 1 }, { contractAddress: collections.ethereum.address }, { tokenId: '01' }, { mintLogIndex: -1 },
            { uriProvenance: 'guess' }, { tokenUri: 'https://meta.yunipals.com/meta?id=11' }, { uriProvenance: 'historical_formula_fallback' }, { documentId: '20' }])
            expect(() => verifyBinding({ ...binding, ...patch })).toThrow();
        expect(() => verifyBinding({ ...binding, burned: true, uriProvenance: 'historical_formula_fallback' })).not.toThrow();
    });
    it('does not accept unrelated URLs or ambiguous lookup arguments', () => {
        for (const uri of ['https://example.com/meta?id=10', 'http://meta.yunipals.com/meta?id=10',
            'https://meta.yunipals.com/meta?id=10&id=11', 'https://meta.yunipals.com/meta?id=10&family=other',
            'https://meta.yunipals.com/meta?id=10#x', 'https://user@meta.yunipals.com/meta?id=10',
            'https://meta.yunipals.com/meta?id=../10'])
            expect(() => metadataLookupId(uri)).toThrow();
    });
    it('accepts only the evidenced BSC Baby identity offset and origin', () => {
        const doc = { id: 'GEN1_202300015513', genId: { type: 'GEN1', id: '1300000215513' }, nft: { id: '202300015513' }, origin: { type: 'GEN1_BSC_BABY_MYSTERY_BOX' } };
        expect(sourceIdentity(doc).issue).toBeNull();
        for (const patch of [{ id: 'wrong' }, { origin: { type: 'GEN1_BOOSTER' } }, { genId: { type: 'GEN1', id: '1300000215514' } }])
            expect(sourceIdentity({ ...doc, ...patch }).issue).toBe('identity_disagreement');
    });
    it('retains a distinction between owner drift and metadata changes', () => {
        const a = { ownerAddress: 'a', nft: { name: 'old', attributes: { type: 'one' } } };
        expect(sourceDifference(a, { ...a, ownerAddress: 'b' })).toBe('ownership_projection_changed');
        expect(sourceDifference(a, { ...a, nft: { ...a.nft, name: 'new' } })).toBe('metadata_changed');
        expect(sourceDifference(a, { ...a, updatedAt: 'changed' })).toBe('metadata_changed'); // timestamp changes require explicit review
    });
});
