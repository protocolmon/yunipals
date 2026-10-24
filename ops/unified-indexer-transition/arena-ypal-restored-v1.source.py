#!/usr/bin/env python3
"""Explicit restored-source Arena leaf; current source and inverse are separate.

This qualifies runtime identity and existing free RPC policy. Canonical Arena
coverage remains the real NativeArenaSource reader's separate responsibility.
"""
import hashlib
import json
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-arena-ypal-restored-source-context-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
STATIC = OPS / 'ypal-restored-metadata-context-v1.py'
STATIC_SHA = 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
CURRENT = OPS / 'ypal-restored-read-current-context-v1.py'
CURRENT_SHA = 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932'
QUALIFIER = OPS / 'ypal-retained-proxy-current-v3.py'
QUALIFIER_SHA = '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf'
QUALIFICATION_RECEIPT_SHA = '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'
QUALIFICATION_COMPONENT_SHA = '57f0520e640ccd50743f02e0891bfb2ab3491e0368f698ea6d6f209d0d43c757'
RESTORE_SHA = 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34'
RESTORE_RECEIPT = '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
MANIFEST = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
SCHEMA = 'unified_ypal_20261023_v1'
BUILD = '71e2a7f3b7'
TABLES = {'_ponder_meta':'75963411','_ponder_checkpoint':'75963418','arena_tournament':'75963696',
          'arena_credit':'75963726','canonical_event':'75963666','chain_block':'75963636',
          'chain_checkpoint':'75963621','indexer_source':'75963651','transaction_candidate':'75963681'}


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def module(path, digest):
    need(re.fullmatch('[a-f0-9]{64}', digest) is not None, 'actual_frozen_Arena_source_dependency_required')
    for p in [*path.parents, path]:
        row = p.lstat(); need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
                              'protected_restored_Arena_source_dependency_required')
    first = path.lstat()
    need(stat.S_ISREG(first.st_mode) and first.st_nlink == 1 and first.st_size < 200000,
         'bounded_single_restored_Arena_source_dependency_required')
    raw = path.read_bytes(); last = path.lstat()
    fields = lambda row: (row.st_dev, row.st_ino, row.st_size, row.st_mtime_ns, row.st_ctime_ns)
    need(fields(first) == fields(last) and len(raw) == first.st_size and sha(raw) == digest,
         'exact_unchanged_restored_Arena_source_dependency_required')
    value = types.ModuleType(path.stem); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); return value


def rpc_current(qualifier):
    proof, parts = qualifier.qualified_rpc_components(QUALIFICATION_RECEIPT_SHA)
    need(proof['validated'] is proof['rpcScopeOnly'] is proof['freeOnly'] is True and
         proof['operatorSha256'] == QUALIFIER_SHA and proof['receiptSha256'] == QUALIFICATION_RECEIPT_SHA and
         proof['currentRPCComponentSha256'] == QUALIFICATION_COMPONENT_SHA and
         proof['paidAuthority'] is proof['historicalWholeValidatorPassed'] is proof['sourceActorQualified'] is
         proof['sourceReadinessQualified'] is proof['financialWriteAuthorityQualified'] is False and
         all(proof[k] == 0 for k in ['providerCalls', 'databaseWrites', 'serviceActions']),
         'actual_current_nine_RPC_only_proof_without_extra_authority_required')
    profile = parts['catalog']['profile']
    need(profile['enabled'] is True and isinstance(profile['expires_at'], str),
         'acknowledged_current_free_profile_required')
    # The pinned RPC producer independently checks all profiles' full catalog,
    # expiry, empty permits, private environments, boot and budget capacity.
    return proof, profile['expires_at']


def native_identity(native):
    need(native['schemaOid'] == '75963410' and len(native['tables']) == 44 and
         all(row['owner'] == '73004621' and row['kind'] == 'r' for row in native['tables'].values()) and
         all(native['tables'].get(name) == {'oid': oid, 'owner':'73004621', 'kind':'r'} for name, oid in TABLES.items()),
         'same_native44_and_nine_actual_Arena_table_identities_required')
    return {'sourceRelease': RELEASE, 'manifestHash': MANIFEST, 'schema': SCHEMA,
            'schemaOid':'75963410', 'buildId':BUILD,
            'nativeTableIdentitiesSha256': sha(encoded(native['tables']))}


def validate_current(*, terminal_ok=False):
    need(type(terminal_ok) is bool, 'explicit_Arena_inverse_source_mode_required')
    static = module(STATIC, STATIC_SHA); qualifier = module(QUALIFIER, QUALIFIER_SHA)
    rpc, expires = rpc_current(qualifier)
    parts = static.query_components(); native = parts['nativeIdentity']; identity = native_identity(native)
    receipt = parts['privilegedSourcePrimitives']['restoreReceipt']
    need(receipt['operatorSha256'] == RESTORE_SHA and parts['sourceContext'].RESULT_SHA == RESTORE_RECEIPT,
         'actual_new_restore_receipt_ancestry_required')
    if terminal_ok:
        source = static.validate_inverse_runtime()
        need(source['validated'] is True and source['restoreReceiptSha256'] == RESTORE_RECEIPT and
             source['restoreOperatorSha256'] == RESTORE_SHA and source['nativeIdentity'] == native and
             source['sourceState'] in {'acknowledged-active', 'terminal'} and
             source['sourceTerminalQualified'] is (source['sourceState'] == 'terminal') and
             source['frameworkReadinessQualified'] is source['currentCanonicalCoverageQualified'] is
             source['financialAuthorityQualified'] is False,
             'only_exact_restored_active_or_terminal_inverse_source_required')
        terminal = source['sourceTerminalQualified']; actor = None if terminal else source['recordedSource']
        runtime_pin = sha(encoded(source))
    else:
        current = module(CURRENT, CURRENT_SHA); source = current.validate_runtime()
        need(source['sourceRelease'] == RELEASE and source['manifestHash'] == MANIFEST and source['schema'] == SCHEMA and
             source['schemaOid'] == '75963410' and source['buildId'] == BUILD and source['nativeTableIdentities'] == native['tables'] and
             source['operationalRestore']['producerSha256'] == RESTORE_SHA and
             source['operationalRestore']['receiptSha256'] == RESTORE_RECEIPT and
             source['sourceReadinessQualified'] is source['currentCanonicalCoverageQualified'] is False,
             'actual_active_restored_source_only_not_c96_or_readiness_required')
        terminal, actor, runtime_pin = False, source['source'], sha(encoded(source))
    after, after_expires = rpc_current(qualifier)
    need(after == rpc and after_expires == expires, 'current_RPC_or_financial_identity_changed_during_Arena_source_check')
    return {'format':FORMAT, 'validated':True, 'releaseId':RELEASE, 'manifestHash':MANIFEST, 'schema':SCHEMA,
            'schemaOid':'75963410', 'buildId':BUILD, 'tables':dict(TABLES), 'dataIdentity':identity,
            'sourceTerminal':terminal, 'inverseOnly':terminal_ok, 'source':actor,
            'sourceActorQualified':not terminal, 'currentWriterExclusivityQualified':False,
            'bootId':receipt['bootId'], 'financialExpiresAt':expires, 'freeOnly':True, 'paidAuthority':False,
            'permits':0, 'financialWindowRenewed':False,
            'currentRPCQualification':{'file':str(qualifier.BASE / 'result.json'), 'sha256':QUALIFICATION_RECEIPT_SHA,
                'operatorSha256':QUALIFIER_SHA, 'componentSha256':QUALIFICATION_COMPONENT_SHA},
            'sourceReceiptSha256':RESTORE_RECEIPT, 'sourceOperatorSha256':RESTORE_SHA,
            'sourceStartIntentSha256':receipt['startIntentSha256'], 'sourceRuntimeProofSha256':runtime_pin,
            'originalWholeValidationPassed':False, 'nativeReadinessQualified':False,
            'currentCanonicalCoverageQualified':False, 'databaseWrites':0, 'serviceChanges':0, 'providerRequests':0}


if __name__ == '__main__':
    print(json.dumps({'format':FORMAT, 'staticOnly':True, 'sourceActorQualified':False,
                      'databaseWrites':0, 'serviceChanges':0, 'providerRequests':0}, sort_keys=True))
