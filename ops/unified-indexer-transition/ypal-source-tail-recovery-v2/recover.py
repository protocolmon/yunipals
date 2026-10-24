#!/usr/bin/env python3
"""One owned same-build pool8 source recovery; no SQL writes/providers/profile edits.

The current nine-RPC acknowledgement is an explicit protected input. It cannot be
replaced by the original stale actor records. Existing live packs stay selected.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import types
import urllib.request

FORMAT = 'yunipals-source-tail-recovery-v2'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
STAGE = OPS / 'ypal-source-tail-recovery-v2'
BASE = Path('/var/backups/yunipals-source-tail-recovery-v2-20261024')
INPUT = Path('/var/backups/yunipals-source-tail-recovery-input-v2-20261024/input.json')
MANIFEST = STAGE / 'code.json'
HOST_BUILD = Path('/var/backups/yunipals-source-tail-pool8-host-build-v2-20261024/result.json')
SDK = OPS / 'ypal-managed-handover-v1.py'
SDK_SHA = 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea'
SOURCE = 'yunipals-ypal-combined-source.service'
FRESH = 'yunipals-booster-ypal-source.service'
API = 'yunipals-booster-api.service'
SYSTEM = Path('/etc/systemd/system')
DROP = SYSTEM / (SOURCE + '.d/99-source-tail-pool8-v2.conf')
BOOT = SYSTEM / 'multi-user.target.wants' / SOURCE
HOLD = SYSTEM / '.ypal-source-tail-recovery-v2'
CFG_SHA = '35a6ba332f858790d3f476ef0e3aaa7c04c0e4284ec015ffe48a5dfbf82d81fb'
OLD_CFG_SHA = 'c4ff1ec83c766aa90286b5d73fd22b457135baa6e5880b4b52c4f8d06eca53a4'
SCHEMA = 'unified_ypal_20261023_v1'
BUILD = '71e2a7f3b7'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
PROJECT = '/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer'
SOURCE_ACK = 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
RPC_FILE = 'ypal-retained-proxy-current-v3.py'
RPC_SHA = '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf'
RPC_ACK = '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'
EXPECTED_HASHES = ('0f394941a10f8ad3407029be841ea82a20633b3323f03d95dcfff613c063377d',
                   'f4522b6a4b90a56ed63468a70b9a03941d184d3f22f592afdb672952d22957f6',
                   '8fdfce8c688a96a995023887e62ae028128c0db59d78f93025d2de63938e5af3')


def need(ok, code):
    if not ok: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(v): return (json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode()


def load_sdk():
    for p in [*SDK.parents, SDK]:
        s = p.lstat(); need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, 'protected_frozen_SDK_required')
    raw = SDK.read_bytes(); need(len(raw) < 200000 and sha(raw) == SDK_SHA, 'exact_source_only_SDK_required')
    m = types.ModuleType('fixed_managed_primitives'); m.__file__ = str(SDK)
    exec(compile(raw, str(SDK), 'exec'), m.__dict__)
    need(sha(m.protected(SDK)) == SDK_SHA, 'same_protected_SDK_bytes_required')
    return m


def validate_build(value):
    need(value['format'] == 'yunipals-source-tail-pool8-offline-v1' and value['buildId'] == BUILD and
         tuple(value[k] for k in ['configHash', 'schemaHash', 'indexingHash']) == EXPECTED_HASHES and
         value['poolMax'] == value['effectivePoolMax'] == 8 and value['namespace'] == SCHEMA and
         value['interceptedFixtureRequests'] == 12 and value['realProviderRequests'] == value['socketAttempts'] == value['databaseCalls'] == 0,
         'actual_isolated_same_build_pool8_evaluation_required')
    return value


def recovery_floor(before, after):
    need(before['schemaOid'] == after['schemaOid'] == '75963410' and before['tables'] == after['tables'] and
         len(after['tables']) == 44 and before['cache'] == after['cache'] and
         before['app']['build_id'] == after['app']['build_id'] == BUILD,
         'same_native44_and_shared_sync_cache_catalog_required')
    b, a = before['checkpoints'], after['checkpoints']
    need(set(b) == set(a) == {'1', '56', '137', '8453'}, 'all_four_actual_checkpoint_rows_required')
    for chain in b:
        need(all(re.fullmatch('[0-9]{75}', a[chain][key] or '') for key in ['latest', 'safe', 'finalized']) and
             a[chain]['safe'] >= b[chain]['safe'] and a[chain]['finalized'] >= b[chain]['finalized'] and
             a[chain]['latest'] >= b[chain]['safe'], 'recorded_official_safe_and_finalized_recovery_floor_must_not_rewind')
    # Latest may legitimately return to safe during official crash recovery.
    # This never labels the old latest point as fresh canonical coverage.
    return {'safeRecoveryFloorPreserved': True, 'latestMonotonicityClaimed': False}


def capacity(row):
    need(row['roleOid'] == '73004621' and row['roleLimit'] == 32 and row['otherUnattributedWriterSessions'] == 0 and
         0 <= row['freshSessions'] <= 5 and row['sourceSessions'] >= 0,
         'exact_existing_writer_role_and_positive_retained_ownership_required')
    role_peak = 8 + 5
    global_peak = row['clients'] - row['sourceSessions'] + 8 + max(0, 5 - row['freshSessions'])
    need(role_peak <= row['roleLimit'] and global_peak <= row['maximum'] - row['reserved'],
         'pool8_plus_retained_pool5_must_fit_unchanged_role_and_global_capacity')
    return {'sourceMaximum': 8, 'retainedFreshMaximum': 5, 'writerWorstCase': role_peak,
            'existingWriterLimit': 32, 'observedGlobalWithSourceAndFreshReserve': global_peak,
            'globalUsableMaximum': row['maximum'] - row['reserved'], 'observedSourceSessions': row['sourceSessions']}


def heartbeat(native):
    app = native['app']
    need(app['build_id'] == BUILD and str(app['is_locked']) == '1' and str(app.get('is_dev', '0')) == '0' and
         0 <= native['clock'] - int(app['heartbeat_at']) <= 180000, 'actual_same_build_live_Ponder_heartbeat_required')


def epoch_heartbeat(native, intent):
    heartbeat(native)
    need(int(native['app']['heartbeat_at']) >= intent['preStartDatabaseClock'] and
         int(native['app']['heartbeat_at']) > intent['predecessorHeartbeat'], 'heartbeat_must_belong_to_actual_new_source_epoch_not_compiling_predecessor')


def retained_fresh_privileges(value, original):
    # This packet is authenticated by the immutable c96 operation and the strict
    # current v3 source qualifier. It grants no exception to the combined source.
    priv = original['privileges']
    need(set(priv['Uid'].split()) == {'970'} and set(priv['Gid'].split()) == {'964'} and
         priv['Groups'].split() == ['964'] and priv['NoNewPrivs'] == '1' and
         all(int(priv[k], 16) == 0 for k in ['CapPrm', 'CapEff', 'CapAmb']), 'authenticated_original_restricted_fresh_scanner_required')
    caps = {k: priv[k].strip() for k in ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']}
    expected = sha(json.dumps(caps, sort_keys=True).encode())
    need(value['pid'] == original['pid'] and value['startTicks'] == original['startTicks'] and
         value['uid'] == 970 and value['gid'] == 964 and value['groups'] == [964] and value['noNewPrivileges'] is True and
         value['capabilitySetSha256'] == expected, 'same_authenticated_fresh_scanner_epoch_and_exact_privileges_required')


def publish_no_replace(source, target):
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(target), 1):
        error = ctypes.get_errno(); raise OSError(error, os.strerror(error))


def drop_bytes():
    return ('[Service]\n# Exact database-pool-only overlay; source/build/native identity unchanged.\n'
            'BindReadOnlyPaths=\nBindReadOnlyPaths=' + str(STAGE / 'pool8.ponder.config.ts') + ':' + PROJECT + '/ponder.config.ts ' +
            str(OPS / 'ypal-combined-source-v1-stage/booster-config.ts') + ':' + PROJECT + '/lib/boosters/config.ts ' +
            str(OPS / 'ypal-combined-source-v1-stage/rpc-preflight.ts') + ':' + PROJECT + '/lib/unified/rpc-preflight.ts\n').encode()


class Host:
    def __init__(self, m, manifest_sha, input_sha):
        self.m = m; self.manifest_sha, self.input_sha = manifest_sha, input_sha
        self.code = m.document(MANIFEST, manifest_sha); self.config = m.document(INPUT, input_sha)
        need(self.code['format'] == FORMAT + '-code' and self.config['format'] == FORMAT + '-input' and
             self.code['operatorSha256'] == sha(m.protected(Path(__file__).absolute())) and
             self.code['rpc'] == {'file': RPC_FILE, 'sha256': RPC_SHA} and self.config['rpcReceiptSha256'] == RPC_ACK and
             m.pin(self.config['offlineBuildSha256']) and m.pin(self.config['hostBuildReceiptSha256']) and m.pin(self.config['preflightReceiptSha256']),
             'actual_frozen_nine_RPC_producer_and_receipt_required')
        self.rpc = m.module(OPS / self.code['rpc']['file'], self.code['rpc']['sha256'])
        register = m.module(OPS / 'ypal-combined-release-register-v1.py', m.REGISTER_SHA)
        self.s, self.raw, self.source_op, self.source_ack = register.load()
        self.sdk = m.Host.__new__(m.Host); self.sdk.raw = self.raw

    def query(self, sql): return self.sdk.query(sql)

    def state(self, unit):
        need(unit in {SOURCE, FRESH, API}, 'only_source_and_preserved_pack_units_required')
        raw = self.m.command(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in self.m.KEYS]])
        value = dict(line.split('=', 1) for line in raw.decode().splitlines())
        need(set(value) == set(self.m.KEYS) and value['Id'] == unit and value['Job'] in {'', '0'}, 'complete_idle_fixed_source_state_required')
        return value

    def actor(self, unit, terminal=False):
        state = self.state(unit); cg = Path('/sys/fs/cgroup/system.slice') / unit / 'cgroup.procs'
        pids = sorted(int(p) for p in cg.read_text().split()) if cg.exists() else []
        if state['MainPID'] == '0':
            need(terminal and state['ControlPID'] == '0' and state['ActiveState'] in {'inactive', 'failed'} and not pids,
                 'source_group_must_be_terminal_or_exactly_owned')
            return None
        need(state['ActiveState'] == 'active' and state['SubState'] == 'running' and state['ControlGroup'] == '/system.slice/' + unit and
             int(state['MainPID']) in pids and 1 <= len(pids) <= 2, 'one_Node_and_optional_compiler_required')
        rows = []
        for pid in pids:
            uid, gid = (967, 961) if unit == API else (970, 964)
            value = json.loads(self.m.command(['/usr/bin/setpriv', '--reuid=' + str(uid), '--regid=' + str(gid), '--clear-groups',
                '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-B', '-c', self.m.PEER],
                encoded({'pid': pid, 'uid': uid, 'gid': gid, 'public': {}, 'requirePublic': False})))
            if unit == FRESH:
                original = next(p for p in self.source_op['retained'][FRESH]['actor']['processes'] if p['pid'] == pid)
                retained_fresh_privileges(value, original)
            else:
                need(value['capabilitiesZero'] is value['noNewPrivileges'] is True and set(value['groups']) <= {gid},
                     'same_zero_capability_source_or_pack_API_kernel_identity_required')
            need(value['cgroup'] == '0::/system.slice/' + unit, 'same_fixed_source_or_pack_API_cgroup_required')
            rows.append(value)
        need(self.state(unit) == state and sorted(int(p) for p in cg.read_text().split()) == pids, 'actor_changed_during_capture')
        return {'unit': state, 'parent': next(p for p in rows if p['pid'] == int(state['MainPID'])), 'processes': rows}

    def definitions(self):
        value = self.state(SOURCE)
        return {p: {'sha256': self.m.sha(self.m.protected(p)), 'identity': self.m.identity(Path(p))}
                for p in [value['FragmentPath'], *value['DropInPaths'].split()] if p}

    def inputs(self):
        self.s.static_inputs(self.raw); self.s.old_private_inputs(self.source_op)
        need(self.s.base_code() == self.source_op['sourceCode'] and self.raw.role() == self.source_op['sourceRole'] and
             self.raw.role()['limit'] == 32, 'unchanged_source_code_original_private_files_and_role32_required')
        need(self.m.sha(self.m.protected(STAGE / 'pool8.ponder.config.ts')) == CFG_SHA and
             self.m.sha(self.m.protected(self.s.STAGE / 'ponder.config.ts')) == OLD_CFG_SHA,
             'new_pool8_and_original_pool5_both_immutable_required')
        proof = self.m.document(STAGE / 'local-build.json', self.config['offlineBuildSha256'])
        validate_build(proof)
        host = self.m.document(HOST_BUILD, self.config['hostBuildReceiptSha256'])
        need(host['format'] == 'yunipals-source-tail-pool8-host-build-v2' and host['completed'] is True and
             host['actorsAndInputsUnchanged'] is True and host['nativeAndCacheIdentityPreserved'] is True and
             host['planSha256'] == self.code['inactiveBuildPlanSha256'] and host['localBuildSha256'] == self.config['offlineBuildSha256'] and
             host['operatorSha256'] == self.code['probeSha256'] and host['manifestSha256'] == self.manifest_sha and
             host['actual']['uid'] == 970 and host['actual']['gid'] == 964, 'actual_inactive_host_pool8_evaluation_required_before_stop')
        validate_build(host['actual'])
        preflight = self.m.document(HOST_BUILD.parent / 'preflight-result.json', self.config['preflightReceiptSha256'])
        need(preflight['format'] == 'yunipals-source-tail-pool8-preflight-result-v2' and preflight['completed'] is True and
             preflight['manifestSha256'] == self.manifest_sha and preflight['hostBuildReceiptSha256'] == self.config['hostBuildReceiptSha256'] and
             preflight['operatorSha256'] == self.code['probeSha256'] and preflight['preflightSha256'] == self.code['preflightSha256'] and
             preflight['actorsAndInputsUnchanged'] is True and preflight['actual']['passed'] is True and
             preflight['actual']['manifestHash'] == '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112' and
             preflight['actual']['chainIds'] == [1, 8453, 137, 56] and preflight['actual']['cachedPolicyReads'] == 8 and
             preflight['actual']['chainIdRpcReads'] == 4, 'separate_actual_official_readonly_preflight_required_before_stop')
        need(self.m.sha(self.m.protected(STAGE / 'offline-build.mjs')) == self.code['offlineRunnerSha256'], 'same_reviewed_offline_runner_required')
        return {'baseSourceCode': self.source_op['sourceCode'], 'sourceRole': self.raw.role(),
                'oldPrivateInputs': next(p for p in self.source_op['oldActor']['processes'] if p['pid'] == self.source_op['oldActor']['pid'])['environmentFileHashes'],
                'candidateConfigSha256': CFG_SHA, 'offlineBuildSha256': self.config['offlineBuildSha256'],
                'hostBuildReceiptSha256': self.config['hostBuildReceiptSha256'], 'preflightReceiptSha256': self.config['preflightReceiptSha256']}

    def rpc_current(self):
        v = self.rpc.validate_rpc_current(self.config['rpcReceiptSha256'])
        need(v['validated'] is v['rpcScopeOnly'] is v['freeOnly'] is True and v['paidAuthority'] is False and
             v['operatorSha256'] == self.code['rpc']['sha256'] and v['receiptSha256'] == self.config['rpcReceiptSha256'] and
             v['historicalWholeValidatorPassed'] is v['sourceActorQualified'] is False,
             'actual_current_nine_RPC_only_acknowledgement_required')
        return v

    def native(self):
        return self.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + SCHEMA +
            "'),'clock',floor(extract(epoch FROM statement_timestamp())*1000)::bigint,'app',(SELECT value FROM " + SCHEMA +
            "._ponder_meta WHERE key='app'),'tables',(SELECT jsonb_object_agg(c.relname,jsonb_build_object('oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='" + SCHEMA +
            "'AND c.relkind='r'),'checkpoints',(SELECT jsonb_object_agg(chain_id::text,jsonb_build_object('latest',latest_checkpoint,'safe',safe_checkpoint,'finalized',finalized_checkpoint))FROM " + SCHEMA +
            "._ponder_checkpoint),'cache',jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='ponder_sync'),'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind)ORDER BY c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ponder_sync'AND c.relkind IN('r','p','v','m','S'))))")

    def sessions(self, source=None):
        actors = {FRESH: self.actor(FRESH)}
        if source is not None: actors[SOURCE] = source
        return self.raw.sessions(actors)

    def capacity(self, source):
        mapped = self.sessions(source)
        value = self.query("SELECT jsonb_build_object('roleOid','73004621','roleLimit',(SELECT rolconnlimit FROM pg_roles WHERE oid=73004621),'clients',(SELECT count(*)FROM pg_stat_activity WHERE backend_type='client backend'),'maximum',current_setting('max_connections')::int,'reserved',current_setting('superuser_reserved_connections')::int+coalesce(nullif(current_setting('reserved_connections',true),''),'0')::int)")
        value.update({'sourceSessions': len(mapped.get(SOURCE, [])), 'freshSessions': len(mapped[FRESH]), 'otherUnattributedWriterSessions': 0})
        return capacity(value)

    def pack_ready(self):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_): raise RuntimeError('pack_probe_redirect_refused')
        output = []
        for url in ['http://127.0.0.1:9030/readyz', 'https://api.yunipals.com/yunipals-indexer/v1/boosters/types']:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Origin': 'https://www.yunipals.com'})
            with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=8) as response:
                raw = response.read(1000001); need(response.status == 200 and len(raw) <= 1000000, 'actual_local_and_public_packs_must_stay_available')
                body = json.loads(raw)
            need(body['collection'] == '0x7d62628806e7eef76a354c7c48787879e3440b16' and
                 body['engine'] == '0xdf4aaa47fe0e8208b5a33c74898f834b2952189e', 'same_actual_fresh_YPAL_stack_required')
            if url.endswith('/readyz'): need(body['ready'] is True and body['buildId'] == '8e88ea2e00', 'temporary_source_API_must_remain_ready')
            else: need(body['enabled'] is True and len(body['items']) == 1 and body['items'][0]['packTypeId'] == '1', 'same_one_public_pack_type_required')
            output.append({'status': 200, 'bodySha256': sha(raw)})
        return {'localAndPublic200': True, 'freshSourceBuild': '8e88ea2e00'}

    def preserved(self, op):
        need(self.inputs() == op['inputs'] and self.rpc_current() == op['rpc'] and
             self.actor(FRESH) == op['fresh'] and self.actor(API) == op['api'] and self.pack_packets() == op['packPackets'] and
             self.pack_boots() == op['packBoots'],
             'source_inputs_current_RPC_or_live_pack_actors_changed')
        self.pack_ready()

    def pack_packets(self):
        # Primitive file/kernel inspection only: no obsolete whole-source validator.
        m, a = self.raw.m, self.raw.m.route_owner
        return {name: self.rpc.packet(m, a, name) for name in [FRESH, API]}

    def pack_boots(self): return {name: self.m.link_record(SYSTEM / 'multi-user.target.wants' / name) for name in [FRESH, API]}

    def manager(self, verb):
        need(verb in {'stop', 'start', 'daemon-reload'}, 'one_source_manager_actions_only')
        need(not self.m.command(['/usr/bin/systemctl', verb, *([] if verb == 'daemon-reload' else [SOURCE])], timeout=90), 'quiet_owned_source_ACK_required')

    def loaded(self, op, pool8):
        wanted = dict(op['definitions'])
        if pool8:
            created = self.m.document(BASE / 'overlay-prepared.json')
            need(self.m.identity(DROP) == created['identity'] and self.m.sha(self.m.protected(DROP)) == sha(drop_bytes()), 'owned_pool8_drop_inode_required')
            wanted[str(DROP)] = {'identity': created['identity'], 'sha256': created['sha256']}
        need(self.definitions() == wanted, 'same_original_unit_plus_only_owned_pool_overlay_required')
        need(self.runtime_properties() == op['runtimeProperties'], 'same_loaded_hardening_resources_and_writable_cache_required')
        s = self.state(SOURCE)
        need(s['User'] == s['Group'] == 'yunipals_unified_shadow' and s['WorkingDirectory'] == PROJECT and
             re.findall(r'argv\[\]=(.*?)\s+;', s['ExecStart']) == re.findall(r'argv\[\]=(.*?)\s+;', op['source']['unit']['ExecStart']),
             'same_loaded_program_identity_and_ordered_private_arguments_required')
        obj = '/org/freedesktop/systemd1/unit/' + ''.join(c if c.isalnum() else '_' + format(ord(c), '02x') for c in SOURCE)
        value = json.loads(self.m.command(['/usr/bin/busctl', '--json=short', 'get-property', 'org.freedesktop.systemd1', obj,
            'org.freedesktop.systemd1.Service', 'BindReadOnlyPaths']))
        config = str(STAGE / 'pool8.ponder.config.ts') if pool8 else str(self.s.STAGE / 'ponder.config.ts')
        pairs = [(config, PROJECT + '/ponder.config.ts'), (str(self.s.STAGE / 'booster-config.ts'), PROJECT + '/lib/boosters/config.ts'),
                 (str(self.s.STAGE / 'rpc-preflight.ts'), PROJECT + '/lib/unified/rpc-preflight.ts')]
        need(value['type'] == 'a(ssbt)' and len(value['data']) == 3 and all(len(r) == 4 and r[:3] == [a, b, False] and
             type(r[3]) is int and r[3] in {0, 16384} for r, (a, b) in zip(value['data'], pairs)), 'actual_exact_three_readonly_source_mounts_required')
        return config

    def runtime_properties(self):
        keys = ['MemoryMax', 'MemorySwapMax', 'TasksMax', 'RuntimeMaxUSec', 'Restart', 'RestartUSec', 'KillMode',
                'NoNewPrivileges', 'CapabilityBoundingSet', 'AmbientCapabilities', 'ProtectSystem', 'ProtectHome',
                'PrivateTmp', 'RestrictSUIDSGID', 'BindPaths', 'ReadWritePaths', 'RestrictAddressFamilies', 'IPAddressDeny', 'IPAddressAllow']
        value = dict(x.split('=', 1) for x in self.m.command(['/usr/bin/systemctl', 'show', '--all', SOURCE,
                     *['--property=' + k for k in keys]]).decode().splitlines())
        need(set(value) == set(keys) and value['MemoryMax'] == '6442450944' and value['MemorySwapMax'] == '0' and
             value['RuntimeMaxUSec'] == 'infinity' and value['KillMode'] == 'control-group' and value['NoNewPrivileges'] == 'yes' and
             value['CapabilityBoundingSet'] == value['AmbientCapabilities'] == '', 'original_6GiB_zero_capability_hardening_required')
        return value

    def owned(self, op, prefix='', pool8=True):
        config = self.loaded(op, pool8); actor = self.actor(SOURCE); intent = self.m.document(BASE / (prefix + 'start-intent.json'))
        need(actor['unit']['InvocationID'] != op['source']['unit']['InvocationID'] and
             intent['notBeforeUs'] <= int(actor['unit']['ExecMainStartTimestampMonotonic']) <= intent['notBeforeUs'] + 130000000 and
             actor['parent']['argv'] == op['source']['parent']['argv'] and actor['parent']['cwd'] == PROJECT,
             'new_real_owned_source_epoch_not_old_c96_actor_required')
        compilers = {(tuple(p['argv']), p['executable']) for p in op['source']['processes'] if p['pid'] != op['source']['parent']['pid']}
        need(all(p['pid'] == actor['parent']['pid'] or (p['parentPid'] == actor['parent']['pid'] and
             (tuple(p['argv']), p['executable']) in compilers) for p in actor['processes']), 'only_one_Node_and_direct_retained_compiler_child_allowed')
        paths = dict(self.m.NAMESPACE); paths[PROJECT + '/ponder.config.ts'] = config
        actual = json.loads(self.m.command(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--no-new-privs',
            '/usr/bin/python3', '-I', '-B', '-c', self.m.NAMESPACE_PEER], encoded({'pid': actor['parent']['pid'], 'paths': paths})))
        expected = {}
        for inside, backing in paths.items():
            st = Path(backing).stat(); expected[inside] = {'device': st.st_dev, 'inode': st.st_ino, 'uid': st.st_uid, 'gid': st.st_gid, 'kind': stat.S_IFMT(st.st_mode)}
        public = json.loads(self.m.command(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all',
            '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-B', '-c', self.s.PUBLIC_ENV_PEER,
            str(actor['parent']['pid']), json.dumps(self.s.expected_env())]))
        need(public['environmentSha256'] == actor['parent']['environmentSha256'] and public['presentKeysMatch'] is True and
             actual == expected and self.actor(SOURCE) == actor, 'actual_process_namespace_uses_all_six_exact_binds_and_public_context')
        return actor


class Owner:
    def __init__(self, h): self.h = h; self.m = h.m
    def get(self, name): return self.m.document(BASE / name)
    def put(self, name, value): return self.m.save(BASE / name, value)
    def operation(self):
        op = self.get('operation.json')
        need(op['operatorSha256'] == sha(self.m.protected(Path(__file__).absolute())) and op['bootId'] == self.m.boot() and
             op['manifestSha256'] == self.h.manifest_sha and op['inputSha256'] == self.h.input_sha, 'same_owned_source_recovery_operation_required')
        return op

    def review(self):
        h = self.h; inputs = h.inputs(); rpc = h.rpc_current()
        # Actual original actor proof is used ONLY before this transition.
        need(h.s.new_owned(h.raw, h.source_op, True) == h.source_ack['source'], 'actual_c96_predecessor_required_before_first_effect')
        source, fresh, api = h.actor(SOURCE), h.actor(FRESH), h.actor(API)
        _, components = h.rpc.qualified_source_components(h.config['rpcReceiptSha256'])
        need(components['sourcePreservation']['combinedSourceActor'] == h.source_ack['source'], 'actual_initial_source_and_temporary_pack_ancestry_required')
        native = h.native(); recovery_floor(native, native)
        need(str(native['app']['is_locked']) == '1' and str(native['app']['is_dev']) == '0' and
             0 <= native['clock'] - int(native['app']['heartbeat_at']) <= 180000, 'live_same_build_heartbeat_required_not_framework_ready')
        boot = self.m.link_record(BOOT); need(boot == {k: h.source_ack['newBoot'][k] for k in ['identity', 'target']}, 'original_acknowledged_boot_inode_required')
        state = h.state(SOURCE)
        need(state['UnitFileState'] == 'enabled' and state['WantedBy'] == 'multi-user.target' and
             not any(state[k] for k in ['RequiredBy', 'UpheldBy', 'TriggeredBy', 'Triggers', 'PartOf', 'BindsTo']),
             'only_owned_original_boot_activation_required')
        need(sha(self.m.protected(h.s.UNIT)) == h.s.TEMPLATE_SHA and not h.state(SOURCE)['DropInPaths'] and
             not os.path.lexists(DROP), 'original_unmodified_source_without_any_new_dropin_required')
        available = h.pack_ready(); resource = h.s.resources(); cap = h.capacity(source)
        binding = {'format': FORMAT, 'operatorSha256': sha(self.m.protected(Path(__file__).absolute())), 'bootId': self.m.boot(),
                   'manifestSha256': h.manifest_sha, 'inputSha256': h.input_sha, 'inputs': inputs, 'rpc': rpc,
                   'source': source, 'fresh': fresh, 'api': api, 'packPackets': h.pack_packets(), 'packBoots': h.pack_boots(), 'boot': boot,
                   'definitions': h.definitions(), 'runtimeProperties': h.runtime_properties(),
                   'nativeIdentity': {k: native[k] for k in ['schemaOid', 'tables', 'cache']}}
        return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'native': native, 'capacity': cap,
                'resources': resource, 'availability': available, 'frameworkReadinessClaimed': False}

    def stop(self, op, name, actor):
        sessions = self.h.sessions(actor); self.put(name + '-sessions.json', sessions)
        self.put(name + '-intent.json', {'operationSha256': sha(self.m.protected(BASE / 'operation.json')), 'actor': actor, 'notBeforeUs': self.m.mono()})
        need(self.h.actor(SOURCE) == actor, 'post_intent_exact_source_stop_CAS_required')
        self.h.manager('stop')
        return self.stop_ack(op, name)

    def stop_ack(self, op, name):
        need(self.h.actor(SOURCE, True) is None, 'owned_source_group_must_be_terminal')
        actors = [op['source']]
        for file in [name + '-intent.json', 'result.json']:
            if (BASE / file).exists():
                record = self.get(file)
                if 'actor' in record: actors.append(record['actor'])
                if 'source' in record: actors.append(record['source'])
        for actor in actors:
            for process in actor['processes']:
                path = Path('/proc') / str(process['pid']) / 'stat'
                try: raw = path.read_text()
                except FileNotFoundError: continue
                ticks = int(raw[raw.rfind(')') + 2:].split()[19])
                need(ticks != process['startTicks'], 'known_stopped_source_process_must_be_gone_not_escaped')
        # This joins every remaining writer backend to the preserved fresh actor.
        self.h.sessions()
        if not (BASE / (name + '-result.json')).exists(): self.put(name + '-result.json', {'terminal': True})
        return {'terminal': True}

    def move_boot(self, op, restore=False):
        original, held = (HOLD / 'boot', BOOT) if restore else (BOOT, HOLD / 'boot')
        name = 'boot-restore' if restore else 'boot-hold'; record = op['boot']
        if not (BASE / (name + '-intent.json')).exists(): self.put(name + '-intent.json', record)
        else: need(self.get(name + '-intent.json') == record, 'same_owned_boot_move_intent_required')
        if os.path.lexists(held): need(not os.path.lexists(original) and self.m.link_record(held) == record, 'only_same_original_boot_inode_can_reconcile')
        else:
            need(self.m.link_record(original) == record, 'exact_original_boot_inode_required')
            publish_no_replace(original, held); self.m.sync(original.parent); self.m.sync(held.parent)

    def drain(self, expected):
        need(not os.path.lexists(BASE) and not os.path.lexists(HOLD), 'fresh_exclusive_recovery_operation_required')
        value = self.review(); need(value['reviewHash'] == expected, 'exact_actual_source_recovery_review_required')
        BASE.mkdir(mode=0o700); self.m.sync(BASE.parent); HOLD.mkdir(mode=0o700); self.m.sync(HOLD.parent)
        self.put('operation.json', value['binding']); self.put('review-observation.json', value)
        self.stop(value['binding'], 'stop-original', value['binding']['source'])
        return self.drained()

    def drained(self):
        op = self.operation(); need((BASE / 'stop-original-intent.json').exists(), 'owned_original_stop_intent_required')
        self.stop_ack(op, 'stop-original'); self.h.preserved(op); self.move_boot(op)
        native = self.h.native(); recovery_floor(self.get('review-observation.json')['native'], native)
        value = {'native': native, 'safeRecoveryFloors': {c: v['safe'] for c, v in native['checkpoints'].items()}, 'bootHeld': True}
        if not (BASE / 'drained.json').exists(): self.put('drained.json', value)
        return value

    def install(self):
        op = self.operation(); self.h.preserved(op); self.stop_ack(op, 'stop-original'); self.get('drained.json')
        need(not os.path.lexists(BOOT) and self.m.link_record(HOLD / 'boot') == op['boot'], 'same_original_boot_held_during_install_required')
        need(not os.path.lexists(DROP), 'fresh_pool8_drop_path_required')
        if not DROP.parent.exists(): DROP.parent.mkdir(mode=0o755); self.m.sync(DROP.parent.parent)
        temporary = HOLD / 'overlay'; self.m.save(temporary, drop_bytes(), 0o644)
        self.put('overlay-prepared.json', {'identity': self.m.identity(temporary), 'sha256': sha(drop_bytes())})
        publish_no_replace(temporary, DROP); self.m.sync(HOLD); self.m.sync(DROP.parent)
        self.put('reload-intent.json', {'operationSha256': sha(self.m.protected(BASE / 'operation.json'))})
        self.h.manager('daemon-reload'); self.h.loaded(op, True)
        self.put('installed.json', {'drop': str(DROP), 'identity': self.m.identity(DROP)})
        return {'installedInactive': True}

    def lock_released(self):
        native = self.h.native(); app = native['app']
        need(str(app['is_locked']) == '0' or native['clock'] >= int(app['heartbeat_at']) + 25000,
             'official_Ponder_25s_heartbeat_lock_wait_required_no_flag_edit')
        return native

    def start(self):
        op = self.operation(); self.h.preserved(op); self.stop_ack(op, 'stop-original'); self.h.loaded(op, True)
        native = self.lock_released(); self.h.capacity(None); self.h.s.resources(); self.move_boot(op, True)
        self.put('start-intent.json', {'notBeforeUs': self.m.mono(), 'preStartDatabaseClock': native['clock'],
            'predecessorHeartbeat': int(native['app']['heartbeat_at']), 'operationSha256': sha(self.m.protected(BASE / 'operation.json'))})
        need(self.h.actor(SOURCE, True) is None, 'post_intent_source_must_still_be_terminal')
        self.h.manager('start')
        return self.accept()

    def accept(self):
        op = self.operation(); self.h.preserved(op); actor = self.h.owned(op); native = self.h.native()
        recovery_floor(self.get('drained.json')['native'], native)
        epoch_heartbeat(native, self.get('start-intent.json'))
        need(self.h.capacity(actor)['observedSourceSessions'] >= 1, 'actual_new_source_backend_positive_kernel_ownership_required')
        need(self.h.owned(op) == actor and self.m.link_record(BOOT) == op['boot'], 'same_new_actor_and_original_boot_before_ack')
        value = {'format': FORMAT, 'completed': True, 'operatorSha256': op['operatorSha256'], 'bootId': self.m.boot(),
                 'operationSha256': sha(self.m.protected(BASE / 'operation.json')), 'source': actor, 'native': native,
                 'sourceRelease': RELEASE, 'schema': SCHEMA, 'schemaOid': '75963410', 'buildId': BUILD, 'poolMaximum': 8,
                 'rpcReceiptSha256': self.h.config['rpcReceiptSha256'], 'originalC96ReceiptSha256': SOURCE_ACK,
                 'registeredBaseInventoryIsAncestryOnly': True, 'operationalOverlaySha256': sha(drop_bytes()),
                 'operationalConfigSha256': CFG_SHA, 'originalConfigSha256': OLD_CFG_SHA,
                 'oldWholeSourceValidatorPassed': False, 'nativeLatestMonotonicityClaimed': False,
                 'safeRecoveryFloorPreserved': True, 'sourceReadinessQualified': False, 'frameworkReadyObserved': str(native['app']['is_ready']) == '1',
                 'livePackAPIUnchangedAndReady': True, 'BaseRpcFailuresResolvedClaimed': False, 'performanceImprovementClaimed': False,
                 'checkpointEdits': 0, 'databaseWritesByOwner': 0, 'providerCallsByOwner': 0, 'paidAuthorityAdded': False}
        self.put('result.json', value); return value

    def restored_ack(self, op):
        actor = self.h.owned(op, 'inverse-', False); native = self.h.native()
        self.inverse_floor(native); recovery_floor(self.get('inverse-drained.json')['native'], native)
        epoch_heartbeat(native, self.get('inverse-start-intent.json'))
        need(self.h.capacity(actor)['observedSourceSessions'] >= 1, 'actual_restored_source_backend_positive_kernel_ownership_required')
        self.h.preserved(op)
        need(self.h.owned(op, 'inverse-', False) == actor and self.m.link_record(BOOT) == op['boot'], 'restored_actor_and_boot_CAS_before_ack')
        value = {'format': FORMAT, 'restored': True, 'operatorSha256': op['operatorSha256'], 'operationSha256': sha(self.m.protected(BASE / 'operation.json')),
                 'source': actor, 'native': native, 'poolMaximum': 5, 'originalBootInodePreserved': True, 'oldC96ActorRelabelled': False,
                 'latestMonotonicityClaimed': False, 'legitimateNewWorkRetained': True, 'sourceReadinessQualified': False}
        self.put('inverse-result.json', value); return value

    def inverse_floor(self, native):
        # Never adopt a newly observed rewind as the inverse's recovery baseline.
        for name in ['review-observation.json', 'drained.json', 'result.json']:
            if (BASE / name).exists(): recovery_floor(self.get(name)['native'], native)

    def inverse(self, finish=False):
        op = self.operation(); need(self.h.inputs() == op['inputs'], 'original_private_and_source_inputs_required')
        if not (BASE / 'inverse-intent.json').exists(): self.put('inverse-intent.json', {'operationSha256': sha(self.m.protected(BASE / 'operation.json'))})
        else: need(finish, 'explicit_finish_inverse_required')
        # A lost restored-start ACK is read-only reconciliation, even if official
        # indexing has advanced. Never route the restored process through pool8.
        if (BASE / 'inverse-start-intent.json').exists():
            need(finish, 'unknown_inverse_start_requires_readonly_finish')
            return self.restored_ack(op)
        if not (BASE / 'start-intent.json').exists() and self.h.actor(SOURCE, True) is not None:
            need(not (BASE / 'overlay-prepared.json').exists() and self.h.actor(SOURCE) == op['source'] and
                 self.m.link_record(BOOT) == op['boot'], 'only_exact_untouched_original_actor_can_reconcile_failed_stop')
            self.h.loaded(op, False); self.h.preserved(op)
            value = {'format': FORMAT, 'restored': True, 'originalActorPreserved': True, 'source': op['source'], 'native': self.h.native(),
                     'operatorSha256': op['operatorSha256'], 'operationSha256': sha(self.m.protected(BASE / 'operation.json')),
                     'poolMaximum': 5, 'sourceReadinessQualified': False}
            need(self.h.actor(SOURCE) == op['source'], 'original_actor_changed_before_no_effect_inverse_ack')
            self.put('inverse-result.json', value); return value
        if (BASE / 'start-intent.json').exists():
            state = self.h.state(SOURCE)
            if state['MainPID'] != '0':
                actor = self.h.owned(op)
                if (BASE / 'stop-new-intent.json').exists(): raise RuntimeError('unknown_new_stop_ACK_inspect_no_retry')
                self.stop(op, 'stop-new', actor)
            elif state['ActiveState'] == 'activating' and state['SubState'] == 'auto-restart':
                self.h.loaded(op, True)
                need(state['ControlPID'] == '0' and int(state['ExecMainStartTimestampMonotonic']) >= self.get('start-intent.json')['notBeforeUs'], 'owned_new_restart_timer_only')
                need(not (BASE / 'cancel-restart-intent.json').exists(), 'unknown_restart_cancel_ACK_inspect_no_retry')
                self.put('cancel-restart-intent.json', {'state': state})
                need(self.h.state(SOURCE) == state, 'post_intent_restart_timer_CAS_required')
                self.h.manager('stop')
            self.stop_ack(op, 'stop-new' if (BASE / 'stop-new-intent.json').exists() else 'stop-original')
        else: self.stop_ack(op, 'stop-original')
        native = self.h.native(); self.inverse_floor(native)
        if not (BASE / 'inverse-drained.json').exists(): self.put('inverse-drained.json', {'native': native})
        if (BASE / 'overlay-prepared.json').exists():
            record = self.get('overlay-prepared.json'); held = HOLD / 'removed-overlay'
            if os.path.lexists(DROP):
                need(self.m.identity(DROP) == record['identity'] and sha(self.m.protected(DROP)) == record['sha256'], 'exact_owned_overlay_only_may_be_removed')
                if not (BASE / 'remove-overlay-intent.json').exists(): self.put('remove-overlay-intent.json', record)
                publish_no_replace(DROP, held); self.m.sync(DROP.parent); self.m.sync(HOLD)
            else: need(self.m.identity(held if held.exists() else HOLD / 'overlay') == record['identity'], 'same_owned_overlay_publication_prefix_required')
        if not (BASE / 'inverse-reload-intent.json').exists():
            self.put('inverse-reload-intent.json', {'operationSha256': sha(self.m.protected(BASE / 'operation.json'))}); self.h.manager('daemon-reload')
        self.h.loaded(op, False); self.move_boot(op, True)
        intent = BASE / 'inverse-start-intent.json'
        if not intent.exists():
            self.h.preserved(op); native = self.lock_released(); self.h.capacity(None); self.h.s.resources()
            self.put('inverse-start-intent.json', {'notBeforeUs': self.m.mono(), 'preStartDatabaseClock': native['clock'],
                'predecessorHeartbeat': int(native['app']['heartbeat_at']), 'operationSha256': sha(self.m.protected(BASE / 'operation.json'))})
            need(self.h.actor(SOURCE, True) is None, 'post_intent_original_program_must_be_terminal')
            self.h.manager('start')
        return self.restored_ack(op)

    def complete_inverse_reload(self):
        # Explicit configuration-only completion for the durable intent ->
        # daemon-reload gap. It never resends a stop/start or any SQL action.
        op = self.operation(); self.get('inverse-intent.json'); self.get('inverse-reload-intent.json')
        need(not (BASE / 'inverse-start-intent.json').exists() and self.h.inputs() == op['inputs'], 'inverse_reload_before_any_restored_start_only')
        self.stop_ack(op, 'stop-new' if (BASE / 'stop-new-intent.json').exists() else 'stop-original')
        need(not os.path.lexists(DROP), 'owned_pool8_overlay_must_already_be_removed')
        if (BASE / 'overlay-prepared.json').exists():
            record = self.get('overlay-prepared.json')
            path = HOLD / 'removed-overlay' if (HOLD / 'removed-overlay').exists() else HOLD / 'overlay'
            need(self.m.identity(path) == record['identity'] and sha(self.m.protected(path)) == record['sha256'], 'exact_retained_overlay_inode_required')
        state = self.h.state(SOURCE)
        need(state['FragmentPath'] in op['definitions'] and set(state['DropInPaths'].split()) <= {str(DROP)}, 'only_original_and_owned_stale_manager_paths_allowed')
        need(all(self.m.identity(p) == v['identity'] and sha(self.m.protected(p)) == v['sha256'] for p, v in op['definitions'].items()),
             'original_definition_bytes_and_inodes_required_for_explicit_reload')
        self.put('inverse-reload-completion-intent.json', {'operationSha256': sha(self.m.protected(BASE / 'operation.json'))})
        need(self.h.actor(SOURCE, True) is None, 'source_must_still_be_terminal_immediately_before_reload')
        self.h.manager('daemon-reload'); self.h.loaded(op, False)
        value = {'configurationOnlyCompleted': True, 'sourceStarts': 0, 'sourceStops': 0, 'databaseWrites': 0}
        self.put('inverse-reload-completion-result.json', value); return value

    def inspect(self):
        return {'format': FORMAT, 'units': {u: self.h.state(u) for u in [SOURCE, FRESH, API]}, 'native': self.h.native(),
                'automaticRetryAllowed': False, 'databaseWrites': 0, 'providerCalls': 0}


def validate_source_current(result_sha, manifest_sha, input_sha, restored=False):
    m = load_sdk(); h = Host(m, manifest_sha, input_sha); owner = Owner(h); op = owner.operation()
    receipt = m.document(BASE / ('inverse-result.json' if restored else 'result.json'), result_sha)
    need(receipt['operatorSha256'] == op['operatorSha256'] and receipt['operationSha256'] == sha(m.protected(BASE / 'operation.json')) and
         receipt.get('restored' if restored else 'completed') is True and (restored or not (BASE / 'inverse-intent.json').exists()), 'actual_current_recovery_epoch_ack_required')
    need(h.inputs() == op['inputs'], 'same_source_private_and_program_context_required')
    rpc = h.rpc_current()
    if restored and receipt.get('originalActorPreserved'):
        h.loaded(op, False); actor = h.actor(SOURCE); need(actor == op['source'], 'same_untouched_original_actor_required')
    else: actor = h.owned(op, 'inverse-' if restored else '', not restored)
    need(actor == receipt['source'], 'same_acknowledged_recovery_epoch_required_not_arbitrary_later_restart')
    native = h.native()
    recovery_floor(receipt['native'], native)
    if not receipt.get('originalActorPreserved'): epoch_heartbeat(native, owner.get(('inverse-' if restored else '') + 'start-intent.json'))
    else: heartbeat(native)
    return {'format': FORMAT + '-source-current', 'validated': True, 'receiptSha256': result_sha, 'operatorSha256': op['operatorSha256'],
            'currentSource': actor, 'native': native, 'sourceRelease': RELEASE, 'poolMaximum': 5 if restored else 8,
            'currentRpc': rpc, 'temporaryPackActorsQualified': False, 'oldWholeSourceValidatorPassed': False,
            'sourceReadinessQualified': False, 'currentWriterBackendRequalified': False,
            'nativeLatestAsCanonicalCoverageClaimed': False, 'databaseWrites': 0, 'providerCalls': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--manifest-sha'); p.add_argument('--input-sha')
    g = p.add_mutually_exclusive_group(); g.add_argument('--drain'); g.add_argument('--reconcile-drain', action='store_true')
    g.add_argument('--install', action='store_true'); g.add_argument('--start', action='store_true'); g.add_argument('--reconcile-start', action='store_true')
    g.add_argument('--inverse', action='store_true'); g.add_argument('--finish-inverse', action='store_true'); g.add_argument('--inspect', action='store_true')
    g.add_argument('--complete-inverse-reload', action='store_true')
    args = p.parse_args()
    if not args.manifest_sha and not args.input_sha:
        need(not any([args.drain, args.reconcile_drain, args.install, args.start, args.reconcile_start, args.inverse, args.finish_inverse, args.inspect, args.complete_inverse_reload]), 'actual_references_required_for_runtime_phase')
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'qualified': False, 'declaredPoolMaximum': 8, 'databaseWrites': 0, 'providerCalls': 0})); return
    m = load_sdk(); need(os.geteuid() == 0 and m.pin(args.manifest_sha) and m.pin(args.input_sha), 'root_and_exact_actual_input_pins_required')
    with m.lock():
        owner = Owner(Host(m, args.manifest_sha, args.input_sha))
        if args.drain: value = owner.drain(args.drain)
        elif args.reconcile_drain: value = owner.drained()
        elif args.install: value = owner.install()
        elif args.start: value = owner.start()
        elif args.reconcile_start: value = owner.accept()
        elif args.inverse or args.finish_inverse: value = owner.inverse(args.finish_inverse)
        elif args.complete_inverse_reload: value = owner.complete_inverse_reload()
        elif args.inspect: value = owner.inspect()
        else: value = owner.review()
        print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'format': FORMAT, 'failed': True, 'code': str(e) if re.fullmatch('[a-zA-Z0-9_]+', str(e)) else type(e).__name__,
                          'automaticRetryAllowed': False, 'privateValuesExported': False})); raise SystemExit(1)
