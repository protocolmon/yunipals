#!/usr/bin/env python3
"""Materialize the reviewed Arena v9 normal/free patch; launch only by explicit exact hash.

Default: root-only, read-only normal/free source and retained terminal-proof review under the existing lease.
Materialization never runs migration/adoption. Each later child retains FD3/4/5.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import resource
import socket
import stat
import types

FORMAT = 'yunipals-arena-normal-adoption-launch-v7'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
PUBLIC = OPS / 'arena-normal-adoption-v7'
PRIVATE = Path('/var/backups/yunipals-arena-normal-adoption-v7-20261022')
NODE = Path('/opt/node-v24.18.1/bin/node')
NODE_SHA = 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
NO_PASSWORD = Path('/run/yunipals-arena-adoption-no-password')
PATCH = 'arena-renewal-terminal-v9.pending.patch'
INPUTS = {
    PATCH: '0caa01ab85e98cf019f51322ac2e6810bb98549c5eb6822217823c36901a309c',
    'arena-owner-migration-v2.py': '70ca16836b8df7f71683ae7999be83bb97186c063133a15b2f6b8d58f074ef65',
    'arena-legacy-origin-adopt-v2.mjs': '26deb0262b61d1c3e937b5968a8cd489a60a82fd28d22d32200bc6e444f70c8b',
    'arena-owner-migration-v2.plan.json': '255e51a3b70eb871b1f5d5799d9f44f39811e72631540fb110bef71bf4058243'
}
OWNER = 'arena-owner-migration-v9.py'
ADOPTER = 'arena-legacy-origin-adopt-v9.mjs'
PLAN = 'arena-owner-migration-v9.plan.json'
RUNTIME_SHA = 'e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f'  # Actual validated normal/free successor.
ZERO = '0' * 64
ENV = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'USER': 'postgres',
       'LOGNAME': 'postgres', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8',
       'TSX_DISABLE_CACHE': '1', 'PGPASSFILE': str(NO_PASSWORD)}


class LaunchFailure(RuntimeError):
    pass


def need(value, code):
    if not value:
        raise LaunchFailure(code)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def actual_hash(value):
    need(isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) and value != ZERO,
         'actual_nonzero_sha256_required')
    return value


def metadata(s):
    return (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def read(path, maximum=250000, private=False):
    path = Path(path)
    for parent in path.parents:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
             'protected_input_ancestry_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1 and
         not before.st_mode & (0o077 if private else 0o022) and before.st_size <= maximum,
         'protected_bounded_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        need(metadata(os.fstat(fd)) == metadata(before), 'input_open_identity_changed')
        with os.fdopen(os.dup(fd), 'rb') as f:
            raw = f.read(maximum + 1)
        need(len(raw) == before.st_size and metadata(os.fstat(fd)) == metadata(before) and
             metadata(path.lstat()) == metadata(before), 'input_changed_during_read')
        return raw
    finally:
        os.close(fd)


def save(path, raw, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(os.dup(fd), 'wb') as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
    finally:
        os.close(fd)
    directory = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def fresh_directory(path, mode):
    for parent in path.parents:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
             'protected_output_ancestry_required')
    path.mkdir(mode=mode)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchmod(fd, mode)
        os.fsync(fd)
    finally:
        os.close(fd)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def apply_reviewed_patch(inputs):
    # Exact old lines/positions only: no external patch tool, temp tree or fuzz.
    sections = inputs[PATCH].decode().split('--- a/')[1:]
    need(len(sections) == 2, 'exact_two_file_pending_patch_required')
    result = {}
    for section in sections:
        lines = section.splitlines(keepends=True)
        target = lines[0].strip().split('/')[-1]
        need(target in {OWNER, ADOPTER} and target not in result and
             lines[1] == '+++ b/ops/unified-indexer-transition/' + target + '\n',
             'exact_pending_patch_target_required')
        old = inputs[target.replace('-v9.', '-v2.')].decode().splitlines(keepends=True)
        output, cursor, i = [], 0, 2
        while i < len(lines):
            match = re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n', lines[i])
            need(match is not None, 'exact_pending_patch_hunk_required')
            position = int(match[1]) - 1
            need(position >= cursor, 'ordered_pending_patch_hunks_required')
            output.extend(old[cursor:position])
            cursor = position
            removed = added = 0
            i += 1
            while i < len(lines) and not lines[i].startswith('@@ '):
                marker, body = lines[i][:1], lines[i][1:]
                need(marker in {' ', '+', '-'}, 'unsupported_pending_patch_line')
                if marker in {' ', '-'}:
                    need(cursor < len(old) and old[cursor] == body, 'pending_patch_preimage_changed')
                    cursor += 1
                    removed += 1
                if marker in {' ', '+'}:
                    output.append(body)
                    added += 1
                i += 1
            need(removed == int(match[2] or 1) and added == int(match[4] or 1),
                 'pending_patch_hunk_count_changed')
        result[target] = ''.join(output + old[cursor:]).encode()
    return result


def owner_module(raw):
    module = types.ModuleType('arena_materialized_owner')
    module.__file__ = str(PUBLIC / OWNER)
    exec(compile(raw, module.__file__, 'exec'), module.__dict__)
    return module


def compose(normal_sha):
    actual_hash(normal_sha)
    need(normal_sha == RUNTIME_SHA, 'exact_acknowledged_normal_free_runtime_required')
    inputs = {name: read(OPS / name) for name in INPUTS}
    need(all(sha(inputs[name]) == pin for name, pin in INPUTS.items()),
         'reviewed_patch_or_original_input_changed')
    files = apply_reviewed_patch(inputs)
    marker = ("NORMAL_RECEIPT_SHA='" + ZERO + "'").encode()
    need(files[OWNER].count(marker) == 1, 'single_pending_normal_receipt_pin_required')
    files[OWNER] = files[OWNER].replace(marker, ("NORMAL_RECEIPT_SHA='" + normal_sha + "'").encode())
    plan = json.loads(inputs['arena-owner-migration-v2.plan.json'])
    need(plan['format'] == 'yunipals-arena-owner-migration-v2', 'original_owner_plan_required')
    plan['format'] = 'yunipals-arena-owner-migration-v9'
    files[PLAN] = encoded(plan)
    return files, owner_module(files[OWNER])


def bundle(files, owner, lease_fd, normal_sha):
    # This is the actual protected normal API, not a caller-supplied assertion.
    proof = encoded(owner.normal_source_for_arena(lease_fd))
    need(0 < len(proof) <= 16384, 'bounded_actual_root_proof_required')
    marker = ('"' + ZERO + '"').encode()
    need(files[ADOPTER].count(marker) == 1, 'single_pending_adopter_proof_pin_required')
    files = {**files, ADOPTER: files[ADOPTER].replace(marker, ('"' + sha(proof) + '"').encode())}
    binding = {'format': FORMAT, 'normalRuntimeSha256': normal_sha,
               'inputPins': INPUTS, 'rootProofSha256': sha(proof),
               'publicFiles': {name: sha(raw) for name, raw in files.items()},
               'publicDirectory': str(PUBLIC), 'privateDirectory': str(PRIVATE)}
    return files, proof, binding, sha(encoded(binding))


def descriptor_child(argv, audit_fd, lease_fd, proof_fd, stdout_fd, stderr_fd, *, env):
    """Retain the same lease open-file description through exec and UID drop.

    The parent retains its original descriptors until this bounded child exits.
    Copy above FD5 before fork so arbitrary caller FD numbers cannot collide.
    argv must include the existing timeout and explicit setpriv in production.
    """
    sources = [audit_fd, lease_fd, proof_fd, stdout_fd, stderr_fd]
    copies = [fcntl.fcntl(fd, fcntl.F_DUPFD_CLOEXEC, 10) for fd in sources]
    try:
        pid = os.fork()
    except BaseException:
        for fd in copies:
            os.close(fd)
        raise
    if pid == 0:
        try:
            os.setpgid(0, 0)
            resource.setrlimit(resource.RLIMIT_FSIZE, (16000000, 16000000))
            null = os.open('/dev/null', os.O_RDONLY)
            os.dup2(null, 0)
            for source, target in zip(copies, [3, 4, 5, 1, 2]):
                os.dup2(source, target, inheritable=True)
            maximum = resource.getrlimit(resource.RLIMIT_NOFILE)[0]
            os.closerange(6, int(maximum if maximum != resource.RLIM_INFINITY else 1048576))
            os.execve(argv[0], argv, env)
        except BaseException:
            os._exit(126)
    for fd in copies:
        os.close(fd)
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


def adoption_review_hash(raw):
    need(len(raw) <= 16384, 'bounded_adoption_stdout_required')
    matches = []
    for line in raw.splitlines():
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if isinstance(value, dict) and value.get('format') == 'yunipals-arena-legacy-origin-adopt-v9':
            need(set(value) == {'format', 'reviewHash', 'legacyOriginsReviewed', 'adopted',
                 'commitOutcome', 'sourceSelectorChanged', 'providerJobs', 'signingOrBroadcasts'} and
                 value['legacyOriginsReviewed'] == 2 and value['sourceSelectorChanged'] is False and
                 value['providerJobs'] == 0 and value['signingOrBroadcasts'] == 0 and
                 (value['commitOutcome'], value['adopted']) in {('not_attempted', 0), ('commit_confirmed', 2)},
                 'exact_successful_adoption_output_required')
            matches.append(actual_hash(value['reviewHash']))
    need(len(matches) == 1, 'one_actual_adoption_review_hash_required')
    return matches[0]


def launch(files, proof, binding, review_hash, lease_fd, attempt, apply_hash):
    need(re.fullmatch('[a-z][a-z0-9-]{0,31}', attempt), 'fresh_bounded_attempt_name_required')
    need(not os.path.lexists(NO_PASSWORD), 'controlled_password_path_must_be_absent')
    need(sha(read(NODE, 150000000)) == NODE_SHA, 'exact_existing_node_required')
    peer = pwd.getpwnam('postgres')
    need((peer.pw_uid, peer.pw_gid) == (111, 113), 'exact_existing_postgres_peer_required')
    for name, raw in files.items():
        need(read(PUBLIC / name) == raw, 'materialized_public_file_changed')
    need(read(PRIVATE / 'normal-proof.json', 16384, True) == proof,
         'saved_normal_proof_differs_from_current_validation')
    need(read(PRIVATE / 'bundle.json', private=True) == encoded({'binding': binding, 'reviewHash': review_hash}),
        'exact_saved_materialization_required')
    target = PRIVATE / attempt
    fresh_directory(target, 0o700)  # Exclusive attempt; no retry/adoption of partial files.
    save(target / 'intent.json', encoded({'reviewHash': review_hash, 'applyReviewHash': apply_hash,
         'adopterSha256': sha(files[ADOPTER]), 'rootProofSha256': sha(proof)}), 0o600)
    audit = os.open(target / 'audit.jsonl', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    proof_fd = os.open(PRIVATE / 'normal-proof.json', os.O_RDONLY | os.O_NOFOLLOW)
    out = os.open(target / 'stdout.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    err = os.open(target / 'stderr.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        need(metadata(os.fstat(proof_fd)) == metadata((PRIVATE / 'normal-proof.json').lstat()),
             'saved_proof_descriptor_changed')
        argv = ['/usr/bin/timeout', '--signal=TERM', '--kill-after=10s', '210s',
                '/usr/bin/setpriv', '--reuid=111', '--regid=113', '--clear-groups',
                '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', str(NODE), str(PUBLIC / ADOPTER)]
        if apply_hash is not None:
            argv.extend(['--apply', actual_hash(apply_hash)])
        code = descriptor_child(argv, audit, lease_fd, proof_fd, out, err, env=ENV)
        for fd in [audit, out, err]:
            os.fsync(fd)
    finally:
        for fd in [audit, proof_fd, out, err]:
            os.close(fd)
    need(not os.path.lexists(NO_PASSWORD), 'controlled_password_path_appeared')
    result = {'format': FORMAT, 'childExitCode': code, 'attempt': attempt,
              'reviewHash': review_hash, 'auditSha256': sha(read(target / 'audit.jsonl', 1000000, True)),
              'adoptionReviewHash': adoption_review_hash(read(target / 'stdout.json', 16384, True)) if code == 0 else None,
              'automaticRetryAllowed': False, 'rawMessagesExported': False}
    save(target / 'result.json', encoded(result), 0o600)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--normal-runtime-sha', required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--materialize', metavar='REVIEW_HASH')
    mode.add_argument('--launch', metavar='REVIEW_HASH')
    parser.add_argument('--attempt')
    parser.add_argument('--apply', metavar='ADOPTION_REVIEW_HASH')
    args = parser.parse_args()
    os.umask(0o077)
    need(os.geteuid() == 0 and socket.gethostname() == 'yunipals-main' and
         Path(__file__).absolute().parent == OPS, 'exact_root_host_and_launcher_path_required')
    need(args.launch is not None or args.attempt is None and args.apply is None,
         'child_options_require_explicit_launch')
    files, owner = compose(args.normal_runtime_sha)
    with owner.existing_source_lease() as lease_fd:
        files, proof, binding, review_hash = bundle(files, owner, lease_fd, args.normal_runtime_sha)
        selected = args.materialize or args.launch
        if selected is not None:
            need(actual_hash(selected) == review_hash, 'fresh_exact_materialization_review_required')
        if args.materialize:
            need(not os.path.lexists(PUBLIC) and not os.path.lexists(PRIVATE),
                 'fresh_public_and_private_materialization_required')
            fresh_directory(PRIVATE, 0o700)
            save(PRIVATE / 'intent.json', encoded(binding), 0o600)
            fresh_directory(PUBLIC, 0o755)
            for name, raw in files.items():
                save(PUBLIC / name, raw, 0o644)
            save(PRIVATE / 'normal-proof.json', proof, 0o600)
            save(PRIVATE / 'bundle.json', encoded({'binding': binding, 'reviewHash': review_hash}), 0o600)
        if args.launch:
            need(args.attempt is not None, 'fresh_attempt_name_required')
            result = launch(files, proof, binding, review_hash, lease_fd, args.attempt, args.apply)
        else:
            result = {'format': FORMAT, 'reviewHash': review_hash, 'binding': binding,
                      'materialized': bool(args.materialize), 'adoptionExecuted': False,
                      'schemaWrites': 0, 'serviceJobs': 0, 'providerRequests': 0}
    print(json.dumps(result, sort_keys=True))
    if args.launch and result['childExitCode'] != 0:
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        frames = []
        trace = error.__traceback__
        while trace:
            if Path(trace.tb_frame.f_code.co_filename) == Path(__file__):
                frames.append({'function': trace.tb_frame.f_code.co_name, 'line': trace.tb_lineno})
            trace = trace.tb_next
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
              'fixedCode': str(error) if isinstance(error, LaunchFailure) else 'external_launcher_failure',
              'publicFrames': frames[-8:], 'automaticRetryAllowed': False, 'rawMessagesExported': False}))
        raise SystemExit(1)
