#!/usr/bin/env python3
"""Acknowledge only new proxy PIDs/invocations for the unchanged normal source.

Default review is read-only. A separate acknowledgement writes one protected
receipt; no source/proxy service, SQL, selector or financial policy is changed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-normal-proxy-requalification-v1-20261023')
RESULT = BASE / 'result.json'
NORMAL = OPS / 'source6-normal-replay-successor-v2.py'
NORMAL_SHA = 'c8c06c03d4bb929f0171876939bb0887254a08f135e4c25a31fbaa238ae166fb'
ORIGINAL = Path('/var/backups/yunipals-source6-normal-replay-successor-20261022/runtime.json')
ORIGINAL_SHA = 'e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f'
EXPECTED_RUNTIME = {'pid': 716994, 'startTicks': 6611794751,
                    'invocation': 'c3463c9a2e1240e8890e318ba1360cf4',
                    'startMonotonicMicroseconds': 66117947533239}
FORMAT = 'yunipals-source6-normal-proxy-requalification-v1'
CHAINS = {'ethereum', 'base', 'polygon', 'bnb'}


def fail(code): raise RuntimeError(code)
def need(value, code):
    if not value: fail(code)
def encode(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()


def protected(path, maximum=300000):
    path = Path(path)
    need(path.is_absolute(), 'protected_absolute_qualification_input_required')
    for item in [*path.parents, path]:
        s = item.lstat()
        need(not stat.S_ISLNK(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
             'root_protected_qualification_input_required')
    before = path.stat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,
         'bounded_regular_qualification_input_required')
    raw = path.read_bytes()
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_gid, s.st_mtime_ns, s.st_ctime_ns)
    need(identity(before) == identity(path.stat()), 'qualification_input_changed_during_read')
    return raw


def modules():
    raw = protected(NORMAL)
    need(sha(raw) == NORMAL_SHA, 'exact_frozen_normal_source_validator_required')
    n = types.ModuleType('retained_normal_source'); n.__file__ = str(NORMAL)
    exec(compile(raw, str(NORMAL), 'exec'), n.__dict__)
    r, b, s = n.modules()
    return n, r, b, s


def original(n, s):
    raw = s.protected(ORIGINAL)
    need(sha(raw) == ORIGINAL_SHA, 'exact_original_source_runtime_receipt_required')
    value = json.loads(raw)
    need(value.get('format') == n.FORMAT and value.get('started') is True and
         value.get('runtime') == EXPECTED_RUNTIME and value.get('normalOperationalRuntime') == 'infinity' and
         value.get('freeOnly') is True and value.get('paidAuthority') is False and
         value.get('financialWindowRenewed') is False,
         'unchanged_original_normal_free_source_required')
    before_raw = s.protected(n.BASE / 'before.json')
    before = json.loads(before_raw)
    # Authenticate the historical static review with its original review hash.
    # The old operator deliberately excluded counters/checkpoints/resources.
    binding = {k: v for k, v in before.items() if k not in {'resources', 'reviewHash'}}
    binding['native'] = {k: v for k, v in before['native'].items()
                         if k not in {'sourceSessions', 'checkpoints'}}
    need(before.get('operatorSha256') == NORMAL_SHA and
         sha(encode(binding)) == before.get('reviewHash') == value.get('reviewHash'),
         'authenticated_original_normal_static_review_required')
    return value, before, sha(before_raw)


def proxy_differences(prior, current):
    need(set(prior) == set(current) == CHAINS, 'exact_four_original_and_current_proxies_required')
    differences = {}
    keys = {'invocation', 'pid', 'commandSha256', 'definitionHashes'}
    for chain in sorted(CHAINS):
        old, new = prior[chain], current[chain]
        need(isinstance(old, dict) and isinstance(new, dict) and set(old) == set(new) == keys,
             'exact_proxy_observation_shape_required')
        for row in (old, new):
            need(re.fullmatch('[0-9a-f]{32}', str(row['invocation'])) and
                 re.fullmatch('[1-9][0-9]*', str(row['pid'])) and int(row['pid']) > 1 and
                 re.fullmatch('[0-9a-f]{64}', str(row['commandSha256'])) and
                 isinstance(row['definitionHashes'], dict) and row['definitionHashes'] and
                 all(isinstance(path, str) and path.startswith('/etc/systemd/system/') and
                     re.fullmatch('[0-9a-f]{64}', str(pin))
                     for path, pin in row['definitionHashes'].items()),
                 'exact_proxy_identity_and_definition_hashes_required')
        need(old['commandSha256'] == new['commandSha256'] and
             old['definitionHashes'] == new['definitionHashes'],
             'proxy_argv_or_any_unit_definition_changed')
        differences[chain] = [k for k in ('pid', 'invocation') if old[k] != new[k]]
    return differences


def capture(n, r, b, s):
    need(Path('/proc/sys/kernel/random/boot_id').read_text().strip() == s.BOOT,
         'same_original_source_boot_required')
    saved, before, before_sha = original(n, s)
    n.normal_configuration(s, before['prior'])
    identity = n.current_identity(s, saved['runtime'])
    need(identity == EXPECTED_RUNTIME, 'same_original_source_process_required')
    inputs = n.fixed_inputs(r, b, s)
    state = n.native(s)
    n.preserved(saved['beforeNative'], state)
    finances = n.financial(s)
    need(finances == saved['financial'], 'exact_original_financial_policy_required')
    proxies = s.proxies()  # Frozen strict free profile, all four routes and paid0 checks.
    changes = proxy_differences(saved['proxies'], proxies)
    boot = n.link_identity(s)
    need(boot == saved['bootLink'], 'exact_original_owned_boot_link_required')
    # Fence all preceding reads with a second exact runtime/configuration check.
    n.normal_configuration(s, before['prior'])
    need(n.current_identity(s, identity) == identity, 'source_changed_during_qualification')
    need(s.proxies() == proxies, 'proxy_identity_changed_during_qualification')
    binding = {
        'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())),
        'normalHelperSha256': NORMAL_SHA,
        'originalRuntime': {'file': str(ORIGINAL), 'sha256': ORIGINAL_SHA},
        'originalStaticReviewSha256': before_sha, 'bootId': s.BOOT,
        'runtime': identity, 'inputs': inputs, 'financial': finances,
        'proxies': proxies, 'proxyTupleChanges': changes, 'bootLink': boot,
        'nativeIdentity': {k: state[k] for k in ('catalogSha256', 'schemaOid', 'schema', 'buildId')},
        'normalOperationalRuntime': 'infinity', 'financialExpiresAt': n.PROFILE_EXPIRY,
        'freeOnly': True, 'paidAuthority': False, 'financialWindowRenewed': False,
        'sourceRestarted': False, 'nativeCaughtUpClaimed': False,
        'originalWholeValidationPassed': False
    }
    return {'format': FORMAT, 'reviewHash': sha(encode(binding)), 'binding': binding,
            'observedNative': state, 'serviceChanges': 0, 'databaseWrites': 0, 'providerRpcRequests': 0}


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save(path, value):
    raw = encode(value) + b'\n'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    sync(path.parent)
    return sha(raw)


def acknowledge(n, r, b, s, expected):
    need(re.fullmatch('[0-9a-f]{64}', str(expected)), 'exact_qualification_review_hash_required')
    with s.lease(s.SOURCE_LEASE):
        need(not os.path.lexists(BASE), 'fresh_separate_proxy_qualification_required')
        checked = capture(n, r, b, s)
        need(checked['reviewHash'] == expected, 'exact_fresh_proxy_qualification_review_required')
        BASE.mkdir(mode=0o700); sync(BASE.parent)
        review_sha = save(BASE / 'review.json', checked)
        current = capture(n, r, b, s)
        need(current['binding'] == checked['binding'], 'source_or_proxy_changed_before_acknowledgement')
        n.preserved(checked['observedNative'], current['observedNative'])
        result = {
            **current['binding'], 'acknowledged': True, 'reviewHash': expected,
            'reviewFileSha256': review_sha,
            'beforeNative': current['observedNative'],
            'originalRuntimeReceiptSha256': ORIGINAL_SHA,
            'sourceSelectionsChanged': 0, 'serviceChanges': 0,
            'databaseWrites': 0, 'providerRpcRequests': 0,
            'automaticRetryAllowed': False, 'at': s.now()
        }
        pin = save(RESULT, result)
        return {**result, 'qualificationReceiptSha256': pin}


def validate_current(pin):
    need(re.fullmatch('[0-9a-f]{64}', str(pin)), 'exact_qualification_receipt_hash_required')
    raw = protected(RESULT)
    need(sha(raw) == pin, 'actual_acknowledged_proxy_qualification_required')
    saved = json.loads(raw)
    n, r, b, s = modules()
    current = capture(n, r, b, s)
    reviewed_raw = protected(BASE / 'review.json')
    reviewed = json.loads(reviewed_raw)
    need(saved.get('format') == FORMAT and saved.get('acknowledged') is True and
         saved.get('operatorSha256') == current['binding']['operatorSha256'] and
         saved.get('originalRuntimeReceiptSha256') == ORIGINAL_SHA and
         saved.get('reviewFileSha256') == sha(reviewed_raw) and
         reviewed.get('reviewHash') == sha(encode(reviewed.get('binding'))) == saved.get('reviewHash') and
         reviewed.get('binding') == current['binding'] and
         all(saved.get(k) == v for k, v in current['binding'].items()),
         'acknowledged_proxy_source_or_static_binding_changed')
    n.preserved(saved['beforeNative'], current['observedNative'])
    return {'format': FORMAT, 'validated': True,
            'operatorSha256': current['binding']['operatorSha256'],
            'qualificationReceiptSha256': pin, 'originalRuntimeReceiptSha256': ORIGINAL_SHA,
            'runtime': current['binding']['runtime'], 'proxies': current['binding']['proxies'],
            'bootLink': current['binding']['bootLink'],
            'normalOperationalRuntime': 'infinity', 'financialExpiresAt': n.PROFILE_EXPIRY,
            'financialWindowRenewed': False, 'freeOnly': True, 'paidAuthority': False,
            'sourceRestarted': False, 'nativeCaughtUpClaimed': False,
            'originalWholeValidationPassed': False,
            'serviceChanges': 0, 'databaseWrites': 0, 'providerRpcRequests': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--acknowledge'); modes.add_argument('--validate')
    args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_host_required')
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: fail('bounded_proxy_requalification_expired'))
    signal.alarm(180)
    if args.validate:
        result = validate_current(args.validate)
    else:
        n, r, b, s = modules()
        result = acknowledge(n, r, b, s, args.acknowledge) if args.acknowledge else capture(n, r, b, s)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z_]+', str(error)) else 'private_diagnostics_withheld'
        print(json.dumps({'format': FORMAT, 'qualified': False, 'fixedCode': code,
                          'errorClass': type(error).__name__, 'automaticRetryAllowed': False}))
        raise SystemExit(1)
