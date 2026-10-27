#!/usr/bin/env python3
"""Finish an authenticated inactive original-config restoration; start once."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-source-tail-restore-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
RECOVERY = OPS / 'ypal-source-tail-recovery-v2/recover.py'
RECOVERY_SHA = '47ab74673e33c624d368d9e549989d091e1538cfe15565ab56c161917afaa8d7'
CODE_SHA = '268483aee747f1245b601a83e6a4e331cb9ea02a79d73aa6644b9a7d199356cd'
INPUT_SHA = 'd823129992f13a6c3d8de1ad17e120f5d4c0a8d5e5ec0b69ca6ffb4ac01a4258'
OP_SHA = 'c4f0e96876e29f0319a61e9241aed84a326fd8e7014b8078e560a6071074ecdc'
BASE = Path('/var/backups/yunipals-source-tail-restore-v1-20261024')


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(v): return (json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode()


def canonical_actor(actor):
    value = copy.deepcopy(actor); text = value['unit']['After']; tokens = text.split()
    need(text == ' '.join(tokens) and len(tokens) == len(set(tokens)), 'literal_unique_After_dependency_tokens_required')
    value['unit']['After'] = ' '.join(sorted(tokens)); return value


def load():
    for path in [*RECOVERY.parents, RECOVERY]:
        st = path.lstat(); need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_frozen_recovery_required')
    raw = RECOVERY.read_bytes(); need(len(raw) < 200000 and sha(raw) == RECOVERY_SHA, 'exact47ab_recovery_required')
    r = types.ModuleType('frozen_partial_source_recovery'); r.__file__ = str(RECOVERY)
    exec(compile(raw, str(RECOVERY), 'exec'), r.__dict__)
    m = r.load_sdk(); need(sha(m.protected(RECOVERY)) == RECOVERY_SHA, 'same_protected_recovery_required')
    h = r.Host(m, CODE_SHA, INPUT_SHA); op = m.document(r.BASE / 'operation.json', OP_SHA)
    need(r.Owner(h).operation() == op, 'actual_unmodified47ab_operation_required')
    return r, m, h, op


class Owner:
    def __init__(self, r, m, h, op): self.r, self.m, self.h, self.op = r, m, h, op
    def get(self, name): return self.m.document(BASE / name)
    def put(self, name, value): return self.m.save(BASE / name, value)
    def producer(self): return sha(self.m.protected(Path(__file__).absolute()))

    def preserved(self):
        r, h, op = self.r, self.h, self.op
        need(h.inputs() == op['inputs'] and h.rpc_current() == op['rpc'] and h.pack_packets() == op['packPackets'] and
             h.pack_boots() == op['packBoots'], 'exact_original_inputs_RPC_and_pack_packets_required')
        peers = {}
        for name, key in [(r.FRESH, 'fresh'), (r.API, 'api')]:
            value = canonical_actor(h.actor(name)); need(value == canonical_actor(op[key]), 'only_peer_After_token_order_may_differ')
            peers[name] = value
        h.pack_ready(); return peers

    def prefix(self):
        r, m, h, op = self.r, self.m, self.h, self.op
        need(not any(os.path.lexists(r.BASE / n) for n in ['start-intent.json', 'inverse-start-intent.json', 'result.json', 'inverse-result.json']),
             'original_forward_and_inverse_start_must_not_have_occurred')
        need(m.document(r.BASE / 'inverse-intent.json')['operationSha256'] == OP_SHA and
             m.document(r.BASE / 'inverse-reload-intent.json')['operationSha256'] == OP_SHA and
             m.document(r.BASE / 'boot-restore-intent.json') == op['boot'], 'exact_actual_inverse_prefix_required')
        record = m.document(r.BASE / 'overlay-prepared.json'); removed = r.HOLD / 'removed-overlay'
        need(not os.path.lexists(r.DROP) and not os.path.lexists(r.HOLD / 'boot') and m.link_record(r.BOOT) == op['boot'] and
             m.identity(removed) == record['identity'] and sha(m.protected(removed)) == record['sha256'] == sha(r.drop_bytes()) and
             m.document(r.BASE / 'remove-overlay-intent.json') == record, 'original_boot_inode_and_owned_removed_overlay_required')
        h.loaded(op, False)
        obj = '/org/freedesktop/systemd1/unit/' + ''.join(c if c.isalnum() else '_' + format(ord(c), '02x') for c in r.SOURCE)
        value = json.loads(m.command(['/usr/bin/busctl', '--json=short', 'get-property', 'org.freedesktop.systemd1', obj,
                       'org.freedesktop.systemd1.Service', 'BindPaths']))
        pairs = list(m.NAMESPACE.items())[:3]
        need(value['type'] == 'a(ssbt)' and len(value['data']) == 3 and all(len(row) == 4 and row[:3] == [backing, inside, False] and
             type(row[3]) is int and row[3] in {0, 16384} for row, (inside, backing) in zip(value['data'], pairs)), 'actual_three_original_writable_bindings_required')

    def floors(self, native):
        self.r.Owner(self.h).inverse_floor(native)
        self.r.recovery_floor(self.m.document(self.r.BASE / 'inverse-drained.json')['native'], native)

    def terminal(self):
        need(self.h.actor(self.r.SOURCE, True) is None, 'restored_source_must_still_be_terminal')
        for row in self.op['source']['processes']:
            try: raw = (Path('/proc') / str(row['pid']) / 'stat').read_text()
            except FileNotFoundError: continue
            need(int(raw[raw.rfind(')') + 2:].split()[19]) != row['startTicks'], 'original_source_PID_epoch_must_be_gone')
        self.h.sessions()  # Every remaining writer backend must map to FRESH.

    def review(self):
        self.prefix(); self.terminal(); peers = self.preserved(); native = self.h.native(); self.floors(native)
        self.h.capacity(None); self.h.s.resources()
        binding = {'format': FORMAT, 'operatorSha256': self.producer(), 'bootId': self.m.boot(), 'ancestorOperationSha256': OP_SHA,
                   'ancestorOperatorSha256': RECOVERY_SHA, 'ancestorCodeSha256': CODE_SHA, 'ancestorInputSha256': INPUT_SHA,
                   'peers': peers, 'originalBoot': self.op['boot'], 'inputs': self.op['inputs'], 'rpc': self.op['rpc'],
                   'nativeIdentity': {k: native[k] for k in ['schemaOid', 'tables', 'cache']}}
        return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'nativeObservation': native,
                'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}

    def start(self, expected):
        need(not os.path.lexists(BASE), 'fresh_exclusive_restore_operation_required')
        value = self.review(); need(value['reviewHash'] == expected, 'exact_current_restore_review_required')
        native = self.r.Owner(self.h).lock_released()
        BASE.mkdir(mode=0o700); self.m.sync(BASE.parent); self.put('before.json', value)
        self.put('start-intent.json', {'operatorSha256': self.producer(), 'ancestorOperationSha256': OP_SHA, 'bootId': self.m.boot(),
                 'notBeforeUs': self.m.mono(), 'preStartDatabaseClock': native['clock'], 'predecessorHeartbeat': int(native['app']['heartbeat_at'])})
        self.prefix(); self.terminal(); need(self.preserved() == value['binding']['peers'], 'post_intent_preserved_peer_CAS_required')
        need(self.h.actor(self.r.SOURCE, True) is None, 'final_terminal_CAS_immediately_before_owned_start')
        self.h.manager('start')
        return {'format': FORMAT, 'sourceStartIssuedOnce': True, 'acknowledged': False, 'finishRequired': True,
                'databaseWrites': 0, 'providerCalls': 0}

    def owned(self):
        self.prefix(); actor = self.h.actor(self.r.SOURCE); intent = self.get('start-intent.json')
        need(intent['operatorSha256'] == self.producer() and intent['ancestorOperationSha256'] == OP_SHA and intent['bootId'] == self.m.boot() and
             actor['unit']['InvocationID'] != self.op['source']['unit']['InvocationID'] and
             intent['notBeforeUs'] <= int(actor['unit']['ExecMainStartTimestampMonotonic']) <= intent['notBeforeUs'] + 130000000 and
             actor['parent']['argv'] == self.op['source']['parent']['argv'] and actor['parent']['cwd'] == self.r.PROJECT and
             actor['parent']['executable'] == self.op['source']['parent']['executable'] and actor['parent']['startupInjectionAbsent'] is True,
             'genuine_new_original_program_epoch_after_own_start_intent_required')
        compilers = {(tuple(p['argv']), p['executable']) for p in self.op['source']['processes'] if p['pid'] != self.op['source']['parent']['pid']}
        need(all(p['pid'] == actor['parent']['pid'] or (p['parentPid'] == actor['parent']['pid'] and (tuple(p['argv']), p['executable']) in compilers)
                 for p in actor['processes']), 'one_Node_and_only_direct_original_compiler_child_required')
        actual = json.loads(self.m.command(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--no-new-privs',
            '/usr/bin/python3', '-I', '-B', '-c', self.m.NAMESPACE_PEER], encoded({'pid': actor['parent']['pid'], 'paths': self.m.NAMESPACE})))
        wanted = {}
        for inside, backing in self.m.NAMESPACE.items():
            st = Path(backing).stat(); wanted[inside] = {'device': st.st_dev, 'inode': st.st_ino, 'uid': st.st_uid, 'gid': st.st_gid, 'kind': stat.S_IFMT(st.st_mode)}
        # The retained source module is h.s, not a module-global replacement.
        public = json.loads(self.m.command(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all',
            '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-B', '-c', self.h.s.PUBLIC_ENV_PEER,
            str(actor['parent']['pid']), json.dumps(self.h.s.expected_env())]))
        need(actual == wanted and public['presentKeysMatch'] is True and public['environmentSha256'] == actor['parent']['environmentSha256'] and
             self.h.actor(self.r.SOURCE) == actor, 'same_actual_six_mounts_private_arguments_and_public_context_required')
        return actor

    def finish(self):
        before = self.get('before.json'); need(before['binding']['operatorSha256'] == self.producer(), 'own_restore_review_required')
        actor = self.owned(); native = self.h.native(); self.floors(native); self.r.epoch_heartbeat(native, self.get('start-intent.json'))
        need(self.h.capacity(actor)['observedSourceSessions'] >= 1, 'positive_kernel_owned_restored_source_backend_required')
        need(self.preserved() == before['binding']['peers'] and canonical_actor(self.owned()) == canonical_actor(actor), 'same_source_and_peers_before_restore_ACK')
        value = {'format': FORMAT, 'restored': True, 'operatorSha256': self.producer(), 'bootId': self.m.boot(),
                 'startIntentSha256': sha(self.m.protected(BASE / 'start-intent.json')), 'ancestorOperatorSha256': RECOVERY_SHA,
                 'ancestorOperationSha256': OP_SHA, 'source': canonical_actor(actor), 'native': native, 'poolMaximum': 5,
                 'originalConfigSha256': self.r.OLD_CFG_SHA, 'originalBoot': self.op['boot'], 'allSixOriginalMountsQualified': True,
                 'prior47abInverseResultClaimed': False, 'oldC96ActorRelabelled': False, 'safeRecoveryFloorsPreserved': True,
                 'sourceReadinessQualified': False, 'databaseWrites': 0, 'providerCalls': 0, 'paidAuthorityAdded': False}
        self.put('result.json', value); return value


def validate_source_current(result_sha):
    r, m, h, op = load(); owner = Owner(r, m, h, op); receipt = m.document(BASE / 'result.json', result_sha)
    need(receipt['format'] == FORMAT and receipt['restored'] is True and receipt['operatorSha256'] == owner.producer() and
         receipt['ancestorOperationSha256'] == OP_SHA and receipt['poolMaximum'] == 5 and receipt['startIntentSha256'] == sha(m.protected(BASE / 'start-intent.json')),
         'actual_new_restore_producer_and_epoch_ACK_required')
    need(h.inputs() == op['inputs'], 'unchanged_original_source_inputs_required')
    rpc = h.rpc_current(); actor = owner.owned(); native = h.native(); owner.floors(native); r.recovery_floor(receipt['native'], native)
    r.epoch_heartbeat(native, owner.get('start-intent.json'))
    need(canonical_actor(actor) == receipt['source'], 'same_acknowledged_restore_epoch_required')
    return {'format': FORMAT + '-source-current', 'validated': True, 'receiptSha256': result_sha, 'operatorSha256': owner.producer(),
            'source': canonical_actor(actor), 'native': native, 'sourceRelease': r.RELEASE, 'buildId': r.BUILD, 'schema': r.SCHEMA,
            'poolMaximum': 5, 'configurationSha256': r.OLD_CFG_SHA, 'currentRPC': rpc, 'oldWholeSourceValidatorPassed': False,
            'prior47abInverseResultClaimed': False, 'sourceReadinessQualified': False, 'currentCanonicalCoverageQualified': False,
            'currentWriterBackendRequalified': False, 'temporaryPackActorsQualified': False, 'financialAuthorityQualified': False,
            'readerRoleGraphQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__); g = p.add_mutually_exclusive_group()
    g.add_argument('--start'); g.add_argument('--finish', action='store_true'); g.add_argument('--validate'); args = p.parse_args()
    r, m, h, op = load()
    with m.lock():
        owner = Owner(r, m, h, op)
        value = validate_source_current(args.validate) if args.validate else owner.start(args.start) if args.start else owner.finish() if args.finish else owner.review()
        print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'qualified': False, 'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else type(error).__name__,
                          'automaticRetryAllowed': False})); raise SystemExit(1)
