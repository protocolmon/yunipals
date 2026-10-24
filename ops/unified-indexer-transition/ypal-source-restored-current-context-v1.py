#!/usr/bin/env python3
"""Fixed source-only context for the actual de4 original-pool5 restore epoch."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types

FORMAT = 'yunipals-source-restored-current-context-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
RESTORE = OPS / 'ypal-source-tail-restore-v1.py'
RESTORE_SHA = 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34'
RESULT = Path('/var/backups/yunipals-source-tail-restore-v1-20261024/result.json')
RESULT_SHA = '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'
REGISTERED = Path('/var/backups/yunipals-ypal-combined-release-register-v1-20261023/registered.json')
REGISTERED_SHA = '39b967846a4c84e320766075cd5c9ea478e29b85a38b6aa8306df95e94fe4cb7'
PROFILE = OPS / 'ypal-combined-rpc-v1/profile.json'
PROFILE_SHA = 'c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b'
RPC_SHA = '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf'
RPC_ACK_SHA = '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'
RPC_COMPONENT_SHA = '57f0520e640ccd50743f02e0891bfb2ab3491e0368f698ea6d6f209d0d43c757'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
MANIFEST = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
SCHEMA = 'unified_ypal_20261023_v1'
BUILD = '71e2a7f3b7'
BASE_INVENTORY = '02e217b73809bf22aed75a35407a2c175c16f49a7eab91c674be86de28507984'
C96 = 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
CONFIG_SHA = 'c4ff1ec83c766aa90286b5d73fd22b457135baa6e5880b4b52c4f8d06eca53a4'
ANCESTOR_OPERATOR = '47ab74673e33c624d368d9e549989d091e1538cfe15565ab56c161917afaa8d7'
ANCESTOR_OPERATION = 'c4f0e96876e29f0319a61e9241aed84a326fd8e7014b8078e560a6071074ecdc'


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(v): return (json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode()


def protected(path, expected):
    path = Path(path); need(path.is_absolute() and '..' not in path.parts and re.fullmatch('[a-f0-9]{64}', expected), 'fixed_protected_source_pin_required')
    for p in [*path.parents, path]:
        st = p.lstat(); need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_source_context_path_required')
    before = path.lstat(); identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 1000000, 'bounded_single_context_file_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, 1000001)
        need(identity(os.fstat(fd)) == identity(before) == identity(path.lstat()) and len(raw) == before.st_size, 'source_context_file_changed_during_read')
    finally: os.close(fd)
    need(sha(raw) == expected, 'exact_source_context_file_required'); return raw


def document(path, expected): return json.loads(protected(path, expected))
def restore():
    raw = protected(RESTORE, RESTORE_SHA)
    value = types.ModuleType('actual_original_config_restore'); value.__file__ = str(RESTORE)
    exec(compile(raw, str(RESTORE), 'exec'), value.__dict__); return value


def stable_source(proof, receipt):
    need(proof['format'] == 'yunipals-source-tail-restore-v1-source-current' and proof['validated'] is True and
         proof['operatorSha256'] == RESTORE_SHA and proof['receiptSha256'] == RESULT_SHA and proof['poolMaximum'] == 5 and
         proof['configurationSha256'] == CONFIG_SHA and proof['sourceRelease'] == RELEASE and proof['buildId'] == BUILD and proof['schema'] == SCHEMA and
         all(proof[k] is False for k in ['oldWholeSourceValidatorPassed', 'prior47abInverseResultClaimed', 'sourceReadinessQualified',
            'currentCanonicalCoverageQualified', 'currentWriterBackendRequalified', 'temporaryPackActorsQualified', 'financialAuthorityQualified', 'readerRoleGraphQualified']) and
         proof['databaseWrites'] == proof['serviceActions'] == proof['providerCalls'] == 0, 'exact_actual_de4_restored5_source_only_scope_required')
    native, actor, rpc = proof['native'], proof['source'], proof['currentRPC']
    need(native['schemaOid'] == '75963410' and native['app']['build_id'] == BUILD and len(native['tables']) == 44 and
         all(row['owner'] == '73004621' and row['kind'] == 'r' for row in native['tables'].values()), 'same_physical44_native_identity_required')
    need(receipt['format'] == 'yunipals-source-tail-restore-v1' and receipt['restored'] is True and receipt['operatorSha256'] == RESTORE_SHA and
         receipt['source'] == actor and receipt['poolMaximum'] == 5 and receipt['originalConfigSha256'] == CONFIG_SHA and
         receipt['ancestorOperatorSha256'] == ANCESTOR_OPERATOR and receipt['ancestorOperationSha256'] == ANCESTOR_OPERATION and
         receipt['allSixOriginalMountsQualified'] is receipt['safeRecoveryFloorsPreserved'] is True and
         receipt['prior47abInverseResultClaimed'] is receipt['oldC96ActorRelabelled'] is receipt['sourceReadinessQualified'] is receipt['paidAuthorityAdded'] is False,
         'new_restore_ACK_not_c96_or47ab_inverse_success_required')
    need(rpc['operatorSha256'] == RPC_SHA and rpc['receiptSha256'] == RPC_ACK_SHA and rpc['currentRPCComponentSha256'] == RPC_COMPONENT_SHA and
         rpc['validated'] is rpc['rpcScopeOnly'] is rpc['freeOnly'] is True and rpc['paidAuthority'] is False and
         all(rpc[k] is False for k in ['historicalWholeValidatorPassed', 'sourceActorQualified', 'temporaryYpalSourceAndApiQualified',
             'sourceReadinessQualified', 'readerRoleGraphQualified', 'financialWriteAuthorityQualified']), 'exact_independent_current_nine_RPC_scope_required')
    return {'source': actor, 'nativeTableIdentities': native['tables'], 'syncCacheIdentity': native['cache'], 'currentRPC': rpc,
            'sourceEpoch': 'acknowledged-de4-original-pool5-restore',
            'operationalRestore': {'producerFile': str(RESTORE), 'producerSha256': RESTORE_SHA, 'receiptFile': str(RESULT), 'receiptSha256': RESULT_SHA,
                'startIntentSha256': receipt['startIntentSha256'], 'configurationSha256': CONFIG_SHA, 'poolMaximum': 5,
                'originalBoot': receipt['originalBoot'], 'activePool8Overlay': False, 'allSixOriginalMountsQualified': True},
            'historicalAncestry': {'sourceReceiptSha256': C96, 'registeredReceiptSha256': REGISTERED_SHA, 'registeredBaseSourceInventory': BASE_INVENTORY,
                'baseInventoryFullyIdentifiesCurrentRuntime': False, 'partialRecoveryOperatorSha256': ANCESTOR_OPERATOR,
                'partialRecoveryOperationSha256': ANCESTOR_OPERATION, 'prior47abInverseSuccessClaimed': False}}


def observe_runtime():
    s = restore(); receipt = document(RESULT, RESULT_SHA)
    first = s.validate_source_current(RESULT_SHA); fixed = stable_source(first, receipt)
    registered = document(REGISTERED, REGISTERED_SHA); profile = document(PROFILE, PROFILE_SHA)
    need(registered['registered'] is True and registered['releaseId'] == RELEASE and registered['manifestHash'] == MANIFEST and
         registered['sourceReceiptSha256'] == C96 and registered['activeReleaseChanged'] is False, 'actual_unchanged_registered_base_ancestry_required')
    r, m, h, op = s.load()
    boot = m.link_record(r.BOOT); need(boot == op['boot'] == receipt['originalBoot'], 'same_original_source_boot_inode_required')
    h.raw.old_terminal(h.source_op); h.raw.preserved_old_native(h.source_op)
    current = h.query("SELECT jsonb_build_object('id',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash,'manifest',manifest) FROM yunipals_indexer_control.release WHERE id='" + RELEASE + "'")
    need(current == {'id': RELEASE, 'schema': SCHEMA, 'build': BUILD, 'manifestHash': MANIFEST, 'manifest': profile['manifest']}, 'same_actual_registered_data_identity_and_full_manifest_required')
    second = s.validate_source_current(RESULT_SHA)
    need(stable_source(second, receipt) == fixed and m.link_record(r.BOOT) == boot, 'restored_source_epoch_boot_or_native_identity_changed')
    binding = {'format': FORMAT + '-runtime', 'validated': True, 'bootId': receipt['bootId'], 'sourceRelease': RELEASE, 'manifestHash': MANIFEST,
               'schema': SCHEMA, 'schemaOid': '75963410', 'buildId': BUILD, 'poolMaximum': 5, **fixed,
               'originalLegacySourceTerminalQualified': True, 'originalWholeValidatorPassed': False, 'temporaryYpalSourceAndApiQualified': False,
               'frameworkReadinessQualified': False, 'currentCanonicalCoverageQualified': False, 'readerRoleGraphQualified': False,
               'ArenaAuthorityQualified': False, 'READ143AuthorityQualified': False, 'sourceReadinessQualified': False,
               'financialAuthorityQualified': False, 'financialWriteAuthorityQualified': False, 'currentWriterBackendRequalified': False,
               'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    return {'binding': binding, 'observation': {'native': second['native'], 'frameworkReadinessClaimed': False, 'currentCanonicalCoverageClaimed': False}}


def validate_runtime(): return observe_runtime()['binding']


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--runtime', action='store_true'); args = p.parse_args()
    if not args.runtime:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'actualRestoreACKBound': True, 'runtimeQualified': False,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_source_context_host_required')
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_source_context_review_expired')); signal.alarm(300)
    value = observe_runtime()
    print(json.dumps({'format': FORMAT, 'validated': True, 'bindingSha256': sha(encoded(value['binding'])), 'sourceReadinessQualified': False,
                      'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'qualified': False, 'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else type(error).__name__,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); raise SystemExit(1)
