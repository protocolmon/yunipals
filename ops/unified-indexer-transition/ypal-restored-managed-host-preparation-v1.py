#!/usr/bin/env python3
"""One inactive public-source staging/preflight. No managed runtime construction."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types
import urllib.request

FORMAT = 'yunipals-restored-managed-host-preparation-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
PLAN = OPS / 'ypal-restored-managed-host-preparation-v1.files.json'
PLAN_SHA = 'e81fa22d0ff9f25cbb4d667b6d537caf710b50fb1e775503a233f95d07bb638a'
COMMIT = '0c4832b5fdbf3e32d1eb402e5ad1c395ef114087'
REPOSITORY = 'protocolmon/yunipals'
BASE = Path('/var/backups/yunipals-restored-managed-host-preparation-v1-20261024')
RUNTIME = OPS / 'ypal-restored-managed-indexer-v1'
MANAGED_BASE = Path('/var/backups/yunipals-ypal-restored-managed-handover-v1-20261024')
MANAGED_HOLD = Path('/etc/systemd/system/.ypal-restored-managed-handover-v1')
RESTORE = 'ypal-source-tail-restore-v1.py'
RESTORE_SHA = 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34'
RESTORE_ACK = '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'
CURRENT = 'ypal-source-restored-current-context-v1.py'
CURRENT_SHA = '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae'
SDK_SHA = 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea'
CONSUMERS_SHA = 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd'
MANAGED_SHA = 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5'
MANAGED_MANIFEST_SHA = '4dcf9b9970afcf0515f0e0e02357ece74a8d706cd5a4fb2430208519677e4ed7'
HOST_BUILD = Path('/var/backups/yunipals-rpc-deadline-host-build-v1-20261024/result.json')
HOST_BUILD_SHA = '551f6a98bb2725444d8a65887912f442967cc5b657cdf082029e007672c769f7'
BUILD_OWNER_SHA = 'e9e84e7450debf66295279c92ffd67d0a5e8a28a2b3afc3599338c11ce271f90'
PREFIX = 'ops/unified-indexer-transition/'
MAXIMUM_FILE = 200000
MAXIMUM_TOTAL = 8000000


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(v): return (json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode()


def identity(path, directory=False):
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'absolute_public_or_audit_path_required')
    for parent in path.parents:
        row = parent.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and not row.st_mode & 0o022,
             'root_owned_nonwritable_real_parent_required')
    row = path.lstat()
    need(row.st_uid == row.st_gid == 0 and not row.st_mode & 0o022 and
         (stat.S_ISDIR(row.st_mode) if directory else stat.S_ISREG(row.st_mode) and row.st_nlink == 1),
         'root_owned_nonwritable_single_public_file_or_directory_required')
    keys = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid')
    if not directory: keys += ('st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    return {key: getattr(row, key) for key in keys}


def protected(path, expected=None, maximum=MAXIMUM_FILE):
    before = identity(path); need(before['st_size'] <= maximum, 'bounded_public_source_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        need(os.fstat(fd).st_ino == before['st_ino'] and os.fstat(fd).st_dev == before['st_dev'], 'same_open_public_inode_required')
        raw = os.read(fd, maximum + 1)
        need(len(raw) == before['st_size'] <= maximum and before == identity(path) and
             (expected is None or sha(raw) == expected), 'exact_unchanged_public_source_bytes_required')
        return raw
    finally: os.close(fd)


def module(name, digest):
    path = OPS / name; raw = protected(path, digest)
    value = types.ModuleType('inactive_' + Path(name).stem); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); protected(path, digest); return value


def sync(path):
    fd = os.open(path, os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def fresh_directory(path, mode):
    identity(path.parent, True); path.mkdir(mode=mode)
    fd = os.open(path, os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY)
    try: os.fchown(fd, 0, 0); os.fchmod(fd, mode); os.fsync(fd)
    finally: os.close(fd)
    sync(path.parent); return identity(path, True)


def exclusive(path, raw, mode=0o600):
    identity(path.parent, True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchown(fd, 0, 0); os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb', closefd=False) as stream: stream.write(raw); stream.flush(); os.fsync(fd)
    finally: os.close(fd)
    sync(path.parent)


def save(name, value):
    raw = encoded(value); exclusive(BASE / name, raw); return sha(raw)


def validate_plan(value):
    need(set(value) == {'format', 'publicRepository', 'publicCommit', 'files'} and
         value['format'] == 'yunipals-restored-managed-host-public-inputs-v1' and
         value['publicRepository'] == REPOSITORY and value['publicCommit'] == COMMIT and
         len(value['files']) == 88 and sum(v['bytes'] for v in value['files']) <= MAXIMUM_TOTAL,
         'exact_finite_public_commit_and_source_closure_required')
    names = set()
    for row in value['files']:
        need(set(row) == {'source', 'target', 'sha256', 'bytes', 'existingOnly', 'mode'} and
             type(row['existingOnly']) is bool and type(row['bytes']) is int and 0 < row['bytes'] <= MAXIMUM_FILE and
             re.fullmatch('[a-f0-9]{64}', row['sha256']) and row['target'] not in names,
             'unique_bounded_pinned_public_file_required')
        source = row['source']; target = row['target']; names.add(target)
        need(not Path(target).is_absolute() and '..' not in Path(target).parts and
             re.fullmatch('[A-Za-z0-9_./-]+', source) and '..' not in Path(source).parts,
             'literal_reviewed_public_source_paths_required')
        expected = source[len(PREFIX):] if source.startswith(PREFIX) else Path(source).name if source.startswith('docs/unified-indexer/') else None
        if source == PREFIX + 'ypal-rpc-deadline-v1/rpc-preflight.ts':
            expected = 'ypal-rpc-deadline-host-build-v1/rpc-preflight.ts'; need(row['existingOnly'], 'actual_tested_deadline_backing_must_already_exist')
        need(target == expected and row['mode'] == (0o644 if target in {
            'ypal-restored-managed-indexer-v1/launcher.mjs', 'ypal-restored-managed-indexer-v1/service.public.env'} else 0o600),
            'only_fixed_operator_or_public_runtime_target_modes_allowed')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_): raise RuntimeError('public_source_redirect_refused')


def public_get(url, maximum):
    allowed = {'https://api.github.com/repos/' + REPOSITORY}
    need(url in allowed or url.startswith('https://raw.githubusercontent.com/' + REPOSITORY + '/' + COMMIT + '/'),
         'only_pinned_public_GitHub_source_requests_allowed')
    opener = urllib.request.build_opener(NoRedirect())  # Retain configured HTTP(S) proxy and default TLS.
    request = urllib.request.Request(url, headers={'User-Agent': 'yunipals-inactive-source-preparation', 'Accept-Encoding': 'identity'})
    with opener.open(request, timeout=12) as response:
        declared = response.headers.get('Content-Length')
        need(response.status == 200 and response.geturl() == url and (declared is None or int(declared) <= maximum),
             'bounded_exact_public_GitHub_response_required')
        raw = response.read(maximum + 1); need(len(raw) <= maximum, 'bounded_public_GitHub_body_required'); return raw


class Host:
    def __init__(self):
        self.restore = module(RESTORE, RESTORE_SHA)
        self.r, self.sdk, self.h, self.op = self.restore.load()
        need(sha(protected(OPS / 'ypal-managed-handover-v1.py')) == SDK_SHA, 'unchanged_source_SDK_required')
        self.owner = self.restore.Owner(self.r, self.sdk, self.h, self.op)
        self.current = module(CURRENT, CURRENT_SHA)
        self.consumer = module('ypal-combined-read-admission-v2.py', CONSUMERS_SHA)

    def capture(self):
        observed = self.current.observe_runtime(); native = self.h.native(); self.owner.floors(native)
        receipt = self.sdk.document(self.restore.BASE / 'result.json', RESTORE_ACK)
        self.r.recovery_floor(receipt['native'], native)
        need(observed['binding']['source'] == self.restore.canonical_actor(self.owner.owned()) and
             native['tables'] == receipt['native']['tables'] and native['cache'] == receipt['native']['cache'],
             'actual_current_restored_source_native44_and_cache_required')
        peers = self.owner.preserved()  # Same temporary source/API, private files, boot and real GETs.
        bridge = types.SimpleNamespace(m=types.SimpleNamespace(run=self.sdk.command, protected=self.sdk.protected))
        consumers = self.consumer.consumer_frame(bridge)  # Pure definition/env-hash/invocation observations, no old constructor.
        inventory = object.__new__(self.sdk.Host)
        activations = {unit: inventory.activation(unit) for unit in self.sdk.WRITERS}
        need(inventory.actor(self.sdk.PARENT, True) is None and not os.path.lexists(MANAGED_BASE) and not os.path.lexists(MANAGED_HOLD),
             'managed_runtime_and_operation_must_stay_inactive')
        private = {p: sha(self.sdk.protected(p)) for p in self.sdk.ENV_FILES}
        binding = {'source': observed['binding'], 'sourceInputs': self.h.inputs(), 'servingPeers': peers,
                   'consumerFilesAndInvocations': consumers, 'writerActivations': activations, 'retainedEnvironmentHashes': private,
                   'nativeIdentity': {k: native[k] for k in ['schemaOid', 'tables', 'cache']}}
        return {'binding': binding, 'native': native}

    def unchanged(self, before, after):
        need(before['binding'] == after['binding'], 'source_serving_private_boot_or_native_identity_changed')
        self.r.recovery_floor(before['native'], after['native'])

    def qualify(self):
        managed = module('ypal-restored-managed-handover-v1.py', MANAGED_SHA)
        namespace = managed.namespace()
        manifest = json.loads(protected(OPS / 'ypal-restored-managed-handover-v1.manifest.json', MANAGED_MANIFEST_SHA))
        managed.validate_producer_manifest(manifest)
        for row in manifest['producers'].values(): protected(OPS / row['file'], row['sha256'])
        need(len(namespace.NAMESPACE) == 6 and namespace.NAMESPACE[namespace.PROJECT + '/lib/unified/rpc-preflight.ts'] ==
             str(OPS / 'ypal-rpc-deadline-host-build-v1/rpc-preflight.ts'), 'exact_inactive_six_bind_managed_namespace_required')
        feature_row = manifest['producers']['feature']; feature = module(feature_row['file'], feature_row['sha256'])
        feature_namespace = feature.runtime()  # Class/function namespace only; no Host instance or future ACK.
        phase_row = manifest['producers']['readerCachePhase']; phase = module(phase_row['file'], phase_row['sha256'])
        root = phase.module(phase.ROOT, phase.ROOT_SHA).core(phase.MANIFEST_SHA); proof = root.load_proof(phase.MANIFEST_SHA)
        finish = phase.module(phase.FINISH, phase.FINISH_SHA).runtime(root, proof)
        inverse_row = manifest['producers']['readerInverse']; inverse = module(inverse_row['file'], inverse_row['sha256'])
        need(feature_namespace.FORMAT == feature.FORMAT and phase.FEATURE_SHA == feature_row['sha256'] and
             inverse.ROOT_SHA == phase.ROOT_SHA and inverse.MANIFEST_SHA == phase.MANIFEST_SHA and
             finish.FORMAT == 'yunipals-ypal-cache-finish-v3', 'exact_new_feature_phase_inverse_and_frozen_reader_namespaces_required')
        probe = module('ypal-rpc-deadline-host-build-v1/probe.py', BUILD_OWNER_SHA)
        built = json.loads(protected(HOST_BUILD, HOST_BUILD_SHA, maximum=8000000)); probe.validate_build(built['actual'])
        need(built['operatorSha256'] == BUILD_OWNER_SHA and built['completed'] is True and
             built['runningTransportChanged'] is False, 'actual_inactive_deadline_host_build_only_required')
        paths = {str(RUNTIME / name): managed.PINS[name] for name in ['launcher.mjs', 'service.public.env']}
        code = "import hashlib,json,os,pathlib,sys;assert os.getuid()==970 and os.getgid()==964 and os.getgroups()==[];s=dict(x.split(':',1)for x in pathlib.Path('/proc/self/status').read_text().splitlines()if ':'in x);assert s['NoNewPrivs'].strip()=='1'and all(int(s[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']);v=json.load(sys.stdin);print(json.dumps({p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()for p in v},sort_keys=True))"
        actual = json.loads(self.sdk.command(['/usr/bin/setpriv','--reuid=970','--regid=964','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs',
            '/usr/bin/env','-i','PATH=/usr/bin:/bin','/usr/bin/python3','-I','-B','-c',code],encoded(paths),timeout=12))
        need(actual == paths, 'actual_UID970_zero_import_public_runtime_readability_required')
        return {'managedNamespaceQualified': True, 'newFeatureNamespaceQualified': True, 'readerProofAndCacheNamespacesQualified': True,
                'inverseLeafSourceQualified': True, 'UID970PublicRuntimeReadable': True, 'actualInactiveDeadlineBuildAuthenticated': True,
                'managedHostConstructed': False, 'featureHostConstructed': False, 'readerContextConstructed': False,
                'completedInverseQualified': False, 'actualREADAdmissionQualified': False, 'nativeAdoptionQualified': False,
                'sourceReadinessQualified': False, 'financialAuthorityQualified': False, 'applicationImports': 0,
                'SQLChildren': 0, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def review(host):
    need(not os.path.lexists(BASE), 'fresh_exclusive_inactive_preparation_audit_required')
    ops = identity(OPS, True); need(stat.S_IMODE(ops['st_mode']) == 0o755, 'existing_OPS0755_must_be_preserved')
    first = host.capture(); plan = validate_plan(json.loads(protected(PLAN, PLAN_SHA)))
    repo = json.loads(public_get('https://api.github.com/repos/' + REPOSITORY, 1000000))
    need(repo['full_name'] == REPOSITORY and repo['private'] is False, 'only_actual_public_repository_source_allowed')
    files, fetched = [], {}
    for row in plan['files']:
        path = OPS / row['target']
        if os.path.lexists(path):
            protected(path, row['sha256']); current = identity(path)
        else:
            need(not row['existingOnly'], 'acknowledged_existing_dependency_must_not_be_reconstructed')
            if path.parent != RUNTIME: identity(path.parent, True)
            raw = public_get('https://raw.githubusercontent.com/' + REPOSITORY + '/' + COMMIT + '/' + row['source'], row['bytes'])
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'exact_pinned_public_source_download_required')
            fetched[row['target']] = raw; current = None
        files.append({**row, 'before': current})
    runtime = identity(RUNTIME, True) if os.path.lexists(RUNTIME) else None
    need(runtime is None or stat.S_IMODE(runtime['st_mode']) == 0o755, 'existing_runtime_mode_must_not_be_changed')
    host.unchanged(first, host.capture()); need(identity(OPS, True) == ops, 'OPS_identity_or_mode_changed_before_staging')
    binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'planSha256': PLAN_SHA,
               'publicCommit': COMMIT, 'ops': ops, 'runtimeBefore': runtime, 'files': files, 'sourceAndServing': first['binding']}
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'nativeObservation': first['native']}, fetched


def no_replace(source, target):
    libc = ctypes.CDLL(None, use_errno=True); call = libc.renameat2
    call.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]; call.restype = ctypes.c_int
    if call(-100, os.fsencode(source), -100, os.fsencode(target), 1):
        error = ctypes.get_errno(); raise OSError(error, os.strerror(error))


def stage(host, expected):
    current, fetched = review(host); need(current['reviewHash'] == expected, 'fresh_exact_inactive_preparation_review_required')
    fresh_directory(BASE, 0o700); save('before.json', current)
    if current['binding']['runtimeBefore'] is None: save('runtime-created.json', fresh_directory(RUNTIME, 0o755))
    for index, row in enumerate(current['binding']['files']):
        path = OPS / row['target']
        if row['before'] is not None:
            need(identity(path) == row['before'], 'existing_public_file_mode_or_inode_changed'); protected(path, row['sha256']); continue
        temporary = path.parent / ('.ypal-restored-managed-public-' + str(index) + '.prepared')
        raw = fetched[row['target']]; exclusive(temporary, raw, row['mode'])
        record = {'target': str(path), 'temporary': str(temporary), 'identity': identity(temporary), 'sha256': row['sha256']}
        save('publication-' + str(index) + '-intent.json', record)
        no_replace(temporary, path); sync(path.parent)
        published=identity(path)
        need({k:v for k,v in published.items()if k!='st_ctime_ns'} ==
             {k:v for k,v in record['identity'].items()if k!='st_ctime_ns'}, 'same_published_public_inode_required')
        protected(path, row['sha256'])
        save('publication-' + str(index) + '-result.json', {**record,'publishedIdentity':published})
    qualification = host.qualify(); before = {'binding': current['binding']['sourceAndServing'], 'native': current['nativeObservation']}
    host.unchanged(before, host.capture())
    for row in current['binding']['files']:
        path = OPS / row['target']; protected(path, row['sha256'])
        if row['before'] is not None: need(identity(path) == row['before'], 'all_existing_public_files_and_modes_must_stay_exact')
        else: need(stat.S_IMODE(path.stat().st_mode) == row['mode'], 'exact_new_public_file_mode_required')
    need(identity(OPS, True) == current['binding']['ops'], 'existing_OPS_identity_and0755_preserved')
    result = {'format': FORMAT, 'completed': True, 'publicCommit': COMMIT, 'reviewHash': expected, 'planSha256': PLAN_SHA,
              'publicFilesVerified': len(current['binding']['files']), 'newPublicFiles': len(fetched), 'publicBytes': sum(v['bytes'] for v in current['binding']['files']),
              'sourceAndServingPeersUnchanged': True, 'native44AndCacheIdentityPreserved': True, 'safeRecoveryFloorsPreserved': True,
              'existingPermissionsChanged': False, 'privateConfigurationTransferred': False, 'privateRawReportsExported': False,
              'GitHubFetches': len(fetched) + 1, 'futureReceiptSupplied': False, **qualification}
    digest = save('result.json', result)
    return {**result, 'actualResultFile': str(BASE / 'result.json'), 'actualResultSha256': digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    group.add_argument('--review', action='store_true'); group.add_argument('--stage'); args = parser.parse_args()
    if not(args.review or args.stage):
        print(json.dumps({'format': FORMAT, 'sourceOnly': True, 'publicCommit': COMMIT, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_production_host_required')
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_inactive_preparation_expired')); signal.alarm(300)
    host = Host()
    with host.sdk.lock():
        if args.stage: result = stage(host, args.stage)
        else:
            value, fetched = review(host)
            result = {'format': FORMAT, 'reviewHash': value['reviewHash'], 'publicCommit': COMMIT, 'planSha256': PLAN_SHA,
                      'publicFiles': len(value['binding']['files']), 'missingPublicFiles': len(fetched), 'actualREADAdmissionQualified': False,
                      'completedInverseQualified': False, 'nativeAdoptionQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else type(error).__name__,
                          'automaticRetryAllowed': False, 'stagingMayBePartial': os.path.lexists(BASE), 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); raise SystemExit(1)
