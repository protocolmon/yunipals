#!/usr/bin/env python3
"""Ordinary/V5 fresh YPAL API, artwork queue and temporary-source handover.

The original transaction and lifecycle bodies run in an explicitly new evidence
domain. A genuine post-switch event remains required before scanner retirement.
"""
import ast
import copy
import contextlib
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import time
import types

FORMAT = 'yunipals-ypal-ordinary-feature-handover-v5'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-ordinary-feature-handover-v5-20261025')
INPUT = Path('/var/backups/yunipals-ypal-ordinary-feature-input-v5-20261025/config.json')
MANIFEST = OPS / 'ypal-ordinary-feature-handover-v5.manifest.json'
CONTEXT = OPS / 'ypal-ordinary-feature-context-v5.py'
ASSEMBLER = OPS / 'ypal-restored-feature-handover-v1.py'
ASSEMBLER_SHA = '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035'
TEMPLATE = OPS / 'ypal-feature-handover-v1.py'
TEMPLATE_SHA = 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e'
REPLACED = {'__init__', 'baseline', 'combined', 'source_actor', 'restart_temporary_source',
            'inverse_source', 'sessions', 'peers', 'queue_proof'}


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) and value != '0'*64


def rename_no_replace(source, target):
    call = ctypes.CDLL(None, use_errno=True).renameat2
    call.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    call.restype = ctypes.c_int
    if call(-100, os.fsencode(source), -100, os.fsencode(target), 1):
        raise OSError(ctypes.get_errno(), 'owned_feature_boot_noreplace_rename_refused')


def protected(path, digest=None):
    path = Path(path)
    for p in [*path.parents, path]:
        s = p.lstat()
        need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022,
             'protected_ordinary_feature_source_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 200000,
         'bounded_single_ordinary_feature_source_required')
    raw = path.read_bytes(); after = path.lstat()
    need(len(raw) == before.st_size and all(getattr(before, k) == getattr(after, k) for k in
         ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns']) and
         (digest is None or pin(digest) and sha(raw) == digest), 'exact_ordinary_feature_source_required')
    return raw


def assemble(raw, context, assembler_raw):
    """Retain 11b's finite assembler and e506 bodies in new function globals."""
    need(sha(assembler_raw) == ASSEMBLER_SHA and sha(raw) == TEMPLATE_SHA, 'exact_reviewed_feature_business_sources_required')
    tree = ast.parse(assembler_raw)
    fn = next(v for v in tree.body if isinstance(v, ast.FunctionDef) and v.name == 'assemble')
    changed = {'selector': 0, 'drop': 0}
    replacements = {
        "Path('/etc/yunipals-unified/booster-ypal-restored-combined.public.env')":
            "Path('/etc/yunipals-unified/booster-ypal-ordinary-v5.public.env')",
        "{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-restored-combined.conf') for u in (API, QUEUE)}":
            "{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-ordinary-v5.conf') for u in (API, QUEUE)}"}
    for node in ast.walk(fn):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in replacements:
            changed['selector' if node.value.startswith('Path(') else 'drop'] += 1
            node.value = replacements[node.value]
    need(changed == {'selector': 1, 'drop': 1}, 'exact_two_new_feature_public_path_seams_required')
    scope = dict(globals())
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), str(Path(__file__).absolute()), 'exec'), scope)
    value = scope['assemble'](raw, context)
    # The only retained session SQL cast with a TCP address is inverse_api.
    source = ast.parse(raw); host = next(v for v in source.body if isinstance(v, ast.ClassDef) and v.name == 'Host')
    inverse = copy.deepcopy(next(v for v in host.body if isinstance(v, ast.FunctionDef) and v.name == 'inverse_api'))
    casts = 0
    for node in ast.walk(inverse):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and 'client_addr::text' in node.value:
            need(node.value.count('client_addr::text') == 1, 'one_inverse_API_address_cast_required')
            node.value = node.value.replace('client_addr::text', 'host(client_addr)'); casts += 1
    need(casts == 1, 'actual_TCP_mapper_compatible_inverse_API_required')
    exec(compile(ast.fix_missing_locations(ast.Module(body=[inverse], type_ignores=[])), value.__file__, 'exec'), value.__dict__)
    value.HistoricalHost.inverse_api = value.inverse_api
    owner = next(v for v in source.body if isinstance(v, ast.ClassDef) and v.name == 'Owner')
    moves = 0; value.rename_no_replace = rename_no_replace
    for name in ['retire', 'inverse']:
        method = copy.deepcopy(next(v for v in owner.body if isinstance(v, ast.FunctionDef) and v.name == name))
        for node in ast.walk(method):
            if isinstance(node, ast.Call) and ast.unparse(node.func) == 'os.rename':
                node.func = ast.Name(id='rename_no_replace', ctx=ast.Load()); moves += 1
        exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), value.__file__, 'exec'), value.__dict__)
        setattr(value.Owner, name, value.__dict__[name])
    need(moves == 2, 'exact_two_atomic_owned_feature_boot_moves_required')
    return value


def runtime(manifest_pin):
    need(pin(manifest_pin), 'actual_exact_feature_manifest_required')
    manifest = json.loads(protected(MANIFEST, manifest_pin))
    need(set(manifest) == {'format', 'files', 'dependencies'} and manifest['format'] == FORMAT + '-code' and
         set(manifest['files']) == {Path(__file__).name, CONTEXT.name} and
         manifest['files'][Path(__file__).name] == sha(protected(Path(__file__).absolute())) and
         all(pin(v) for v in manifest['files'].values()), 'exact_new_feature_manifest_and_public_sources_required')
    raw = protected(CONTEXT, manifest['files'][CONTEXT.name])
    context = types.ModuleType('ordinary_feature_V5_context'); context.__file__ = str(CONTEXT)
    exec(compile(raw, str(CONTEXT), 'exec'), context.__dict__)
    value = assemble(protected(TEMPLATE, TEMPLATE_SHA), context, protected(ASSEMBLER, ASSEMBLER_SHA))
    return value


def validate_feature_leaf(result_sha, manifest_sha, input_sha):
    return runtime(manifest_sha).validate_feature_leaf(result_sha, manifest_sha, input_sha)


def validate_inverse_leaf(result_sha, manifest_sha, input_sha, reader_inverse_refs=None):
    return runtime(manifest_sha).validate_inverse_leaf(result_sha, manifest_sha, input_sha, reader_inverse_refs)


def main():
    import sys
    if len(sys.argv) == 1:
        print(json.dumps({'format': FORMAT, 'sourceOnly': True, 'eventRequiredBeforeRetirement': True,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need('--manifest-sha' in sys.argv and sys.argv.index('--manifest-sha') + 1 < len(sys.argv), 'actual_feature_manifest_before_any_phase_required')
    out = io.StringIO()
    with contextlib.redirect_stdout(out): runtime(sys.argv[sys.argv.index('--manifest-sha') + 1]).main()
    value = json.loads(out.getvalue())
    folder = INPUT.parent/'observations'
    try: folder.mkdir(mode=0o700)
    except FileExistsError: pass
    row = folder.lstat()
    need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and stat.S_IMODE(row.st_mode) == 0o700,
         'private_feature_observation_directory_required')
    path = folder/('phase-'+str(time.time_ns())+'-'+str(os.getpid())+'.json')
    raw = out.getvalue().encode(); fd = os.open(path, os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    allowed = {'format', 'reviewHash', 'operationSha256', 'rehearsed', 'admitted', 'switched', 'retired', 'inverse', 'validated',
               'temporarySourceRetired', 'databaseWrites', 'serviceActions', 'providerCalls'}
    print(json.dumps({**{k:v for k,v in value.items() if k in allowed}, 'privateObservationSha256':sha(raw)}, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False})); raise SystemExit(1)
