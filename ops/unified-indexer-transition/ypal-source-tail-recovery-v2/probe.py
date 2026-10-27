#!/usr/bin/env python3
"""One inactive host evaluation, separate private cache, no source/DB/RPC writes."""
import argparse
import json
import os
from pathlib import Path
import stat
import types

HERE = Path(__file__).absolute().parent
BASE = Path('/var/backups/yunipals-source-tail-pool8-host-build-v2-20261024')
AREA = Path('/var/lib/yunipals-unified-ypal/source-tail-pool8-inactive-probe-v2')
UNIT = 'yunipals-source-tail-pool8-inactive-build-v2.service'


def core(manifest_sha):
    # The caller supplies the root-reviewed code manifest, not an application URL.
    sdk_path = Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-managed-handover-v1.py')
    import hashlib
    raw = sdk_path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea'
    m = types.ModuleType('fixed_probe_primitives'); m.__file__ = str(sdk_path)
    exec(compile(raw, str(sdk_path), 'exec'), m.__dict__)
    m.need(m.sha(m.protected(sdk_path)) == hashlib.sha256(raw).hexdigest(), 'same_protected_SDK_required')
    code = m.document(HERE / 'code.json', manifest_sha)
    m.need(m.sha(m.protected(Path(__file__).absolute())) == code['probeSha256'], 'exact_frozen_probe_required')
    r = m.module(HERE / 'recover.py', code['operatorSha256'])
    h = r.Host.__new__(r.Host); h.m = m; h.code = code; h.config = {'rpcReceiptSha256': r.RPC_ACK}
    h.rpc = m.module(r.OPS / r.RPC_FILE, r.RPC_SHA)
    reg = m.module(r.OPS / 'ypal-combined-release-register-v1.py', m.REGISTER_SHA)
    h.s, h.raw, h.source_op, h.source_ack = reg.load()
    h.sdk = m.Host.__new__(m.Host); h.sdk.raw = h.raw
    return m, r, h, code


def snapshot(m, r, h):
    h.s.static_inputs(h.raw); h.s.old_private_inputs(h.source_op)
    m.need(h.s.base_code() == h.source_op['sourceCode'] and h.raw.role() == h.source_op['sourceRole'], 'original_source_private_role_and_code_required')
    h.rpc.qualified_source_components(r.RPC_ACK)
    native = h.native(); r.recovery_floor(native, native)
    packets = {u: h.actor(u) for u in [r.SOURCE, r.FRESH, r.API]}
    m.need(h.s.new_owned(h.raw, h.source_op, True) == h.source_ack['source'], 'exact_c96_source_must_remain_running')
    return {'actors': packets, 'rpcComponent': h.rpc_current(), 'packFiles': h.pack_packets(),
            'nativeIdentity': {k: native[k] for k in ['schemaOid', 'tables', 'cache']},
            'baseCode': h.s.base_code(), 'sourceRole': h.raw.role(), 'privatePins': next(p for p in h.source_op['oldActor']['processes']
                if p['pid'] == h.source_op['oldActor']['pid'])['environmentFileHashes'],
            'originalConfig': m.sha(m.protected(h.s.STAGE / 'ponder.config.ts'))}


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--manifest-sha', required=True); p.add_argument('--apply', action='store_true')
    p.add_argument('--preflight', action='store_true'); p.add_argument('--host-build-sha')
    args = p.parse_args(); m, r, h, code = core(args.manifest_sha)
    plan = m.document(HERE / 'inactive-build.plan.json', code['inactiveBuildPlanSha256'])
    m.need(plan['area'] == str(AREA) and plan['unit'] == UNIT and plan['publicStage'] == str(HERE), 'fixed_isolated_probe_plan_required')
    local = m.document(HERE / 'local-build.json', plan['sourceFiles']['local-build.json']); r.validate_build(local)
    for name, pin in plan['sourceFiles'].items(): m.need(m.sha(m.protected(HERE / name)) == pin, 'exact_inactive_inputs_required')
    # Retain precisely the already-reviewed one package-symlink exception.
    release = Path('/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6')
    link = release / 'apps/yunipals-market-api/node_modules/tsx'
    for parent in link.parents:
        st = parent.lstat(); m.need(st.st_uid == 0 and stat.S_ISDIR(st.st_mode) and not st.st_mode & 0o022, 'protected_dependency_parent_required')
    st = link.lstat(); m.need(st.st_uid == 0 and stat.S_ISLNK(st.st_mode) and os.readlink(link) == '../../../node_modules/.pnpm/tsx@4.23.15/node_modules/tsx',
        'exact_accepted_tsx_package_link_required')
    loader = release / 'node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/loader.mjs'
    for path, pin in plan['requiredProtectedDependencies'].items():
        actual = loader if path == str(link / 'dist/loader.mjs') else Path(path)
        m.need(m.sha(m.protected(actual)) == pin, 'exact_existing_profile_and_loader_required')
    if args.preflight:
        m.need(not args.apply and m.pin(args.host_build_sha) and m.sha(m.protected(HERE / 'preflight.mjs')) == code['preflightSha256'], 'explicit_frozen_real_preflight_after_actual_host_build_required')
        host = m.document(BASE / 'result.json', args.host_build_sha)
        m.need(host['completed'] is True and host['manifestSha256'] == args.manifest_sha, 'same_actual_host_build_required')
        r.validate_build(host['actual'])
        with m.lock():
            before = snapshot(m, r, h); h.rpc_current()
            state = m.command(['/usr/bin/systemctl', 'show', '--all', 'yunipals-source-tail-pool8-preflight-v2.service',
                '--property=LoadState', '--property=ActiveState', '--property=MainPID', '--property=Job'])
            m.need(dict(v.split('=', 1) for v in state.decode().splitlines()) ==
                {'LoadState': 'not-found', 'ActiveState': 'inactive', 'MainPID': '0', 'Job': ''}, 'fresh_absent_real_preflight_unit_required')
            m.need(not (BASE / 'preflight-intent.json').exists(), 'real_preflight_is_one_explicit_bounded_attempt')
            m.save(BASE / 'preflight-intent.json', {'manifestSha256': args.manifest_sha, 'hostBuildReceiptSha256': args.host_build_sha})
            argv = [v.replace('--unit=' + UNIT, '--unit=yunipals-source-tail-pool8-preflight-v2.service')
                .replace('--property=PrivateNetwork=yes', '--property=PrivateNetwork=no')
                .replace('--property=RestrictAddressFamilies=AF_UNIX', '--property=RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX')
                .replace(str(HERE / 'offline-build.mjs'), str(HERE / 'preflight.mjs')) for v in plan['argv']]
            argv.insert(argv.index('/usr/bin/env'), '--property=IPAddressAllow=localhost')
            actual = json.loads(m.command(argv, timeout=150))
            m.need(actual['format'] == 'yunipals-source-tail-pool8-preflight-v1' and actual['passed'] is True and
                   actual['chainIds'] == [1, 8453, 137, 56] and actual['cachedPolicyReads'] == 8 and actual['chainIdRpcReads'] == 4,
                   'actual_official_twelve_read_preflight_required')
            m.need(snapshot(m, r, h) == before, 'live_source_and_RPC_unchanged_during_real_preflight')
            value = {'format': 'yunipals-source-tail-pool8-preflight-result-v2', 'completed': True, 'actual': actual,
                     'manifestSha256': args.manifest_sha, 'hostBuildReceiptSha256': args.host_build_sha,
                     'operatorSha256': m.sha(m.protected(Path(__file__).absolute())), 'preflightSha256': code['preflightSha256'],
                     'actorsAndInputsUnchanged': True, 'databaseWrites': 0, 'sourceActions': 0, 'paidAuthorityAdded': False}
            m.save(BASE / 'preflight-result.json', value); print(json.dumps(value, sort_keys=True)); return
    before = snapshot(m, r, h)
    state = m.command(['/usr/bin/systemctl', 'show', '--all', UNIT, '--property=LoadState', '--property=ActiveState', '--property=MainPID', '--property=Job'])
    absent = dict(x.split('=', 1) for x in state.decode().splitlines())
    m.need(absent == {'LoadState': 'not-found', 'ActiveState': 'inactive', 'MainPID': '0', 'Job': ''} and
           not os.path.lexists(BASE) and not os.path.lexists(AREA), 'fresh_absent_probe_and_exclusive_output_required')
    review = {'format': 'yunipals-source-tail-pool8-host-build-review-v2', 'manifestSha256': args.manifest_sha,
              'planSha256': code['inactiveBuildPlanSha256'], 'before': before, 'databaseWrites': 0, 'sourceActions': 0}
    if not args.apply: print(json.dumps(review, sort_keys=True)); return
    m.need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_host_required')
    with m.lock():
        m.need(snapshot(m, r, h) == before, 'same_before_state_immediately_before_probe_intent')
        parent = AREA.parent.lstat(); m.need(parent.st_uid == parent.st_gid == 0 and stat.S_ISDIR(parent.st_mode) and stat.S_IMODE(parent.st_mode) == 0o755,
            'protected_existing_probe_parent_required')
        h.s.resources(); BASE.mkdir(mode=0o700); m.sync(BASE.parent); m.save(BASE / 'intent.json', review)
        AREA.mkdir(mode=0o755); AREA.chmod(0o755); m.sync(AREA.parent)
        for name in ['cache', 'cache/.ponder', 'cache/.vite-temp']:
            path = AREA / name; path.mkdir(mode=0o750); path.chmod(0o750); os.chown(path, 970, 964)
        path = AREA / 'cache/ponder-env.d.ts'; m.save(path, b''); os.chown(path, 970, 964)
        raw = m.command(plan['argv'], timeout=150)
        m.save(BASE / 'command-result.json', {'stdout': raw.decode()})
        actual = json.loads(raw); r.validate_build(actual)
        m.need(actual['uid'] == 970 and actual['gid'] == 964 and actual['contracts'] == local['contracts'], 'actual_unprivileged_host_evaluation_must_match_local_contracts')
        after = snapshot(m, r, h); m.need(after == before, 'live_source_pack_RPC_files_roles_and_native_identity_must_stay_unchanged')
        value = {'format': 'yunipals-source-tail-pool8-host-build-v2', 'completed': True, 'planSha256': code['inactiveBuildPlanSha256'],
                 'localBuildSha256': plan['sourceFiles']['local-build.json'], 'actual': actual, 'actorsAndInputsUnchanged': True,
                 'nativeAndCacheIdentityPreserved': True, 'sourceActions': 0, 'providerCalls': 0, 'databaseWrites': 0,
                 'operatorSha256': m.sha(m.protected(Path(__file__).absolute())), 'manifestSha256': args.manifest_sha}
        m.save(BASE / 'result.json', value); print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'failed': True, 'fixedCode': str(e) if isinstance(e, RuntimeError) else type(e).__name__, 'automaticRetryAllowed': False})); raise SystemExit(1)
