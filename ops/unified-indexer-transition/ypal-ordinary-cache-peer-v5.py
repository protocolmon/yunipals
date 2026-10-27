#!/usr/bin/env python3
"""Only three sealed public cache modules; no filesystem/credential access grant."""
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
TEMPLATE = OPS / 'ypal-reader-peer-runtime-v1.mjs'
TEMPLATE_SHA = '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1'
HELPER = OPS / 'ypal-reader-peer-runtime-v1.py'
HELPER_SHA = 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa'
ENTRY = 'ypal-ordinary-cache-sql-v5.mjs'
PINS = {ENTRY: 'de3d4e597b45781b98c2874c74630effe4787cb35822bb73e8bc1076d11a658f',
        'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a',
        'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2'}
NODE = '/opt/node-v24.18.1/bin/node'


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def loader_bytes(template):
    need(sha(template) == TEMPLATE_SHA, 'exact_frozen_reader_hook_template_required')
    text = template.decode(); pattern = r'const PINS = Object\.freeze\(\{.*?\}\);'
    matches = list(re.finditer(pattern, text, re.S)); need(len(matches) == 1, 'one_finite_hook_pin_table_required')
    match = matches[0]
    replacement = 'const PINS = Object.freeze(' + json.dumps(PINS, sort_keys=True) + ');'
    return (text[:match.start()] + replacement + text[match.end():]).encode()


def primitives():
    import stat
    for p in [*HELPER.parents, HELPER]:
        info = p.lstat(); need(info.st_uid == 0 and not stat.S_ISLNK(info.st_mode) and not info.st_mode & 0o022, 'protected_transport_helper_required')
    raw = HELPER.read_bytes(); need(sha(raw) == HELPER_SHA, 'exact_original_sealed_transport_primitives_required')
    value = types.ModuleType('unchanged_public_fd_primitives'); value.__file__ = str(HELPER)
    exec(compile(raw, str(HELPER), 'exec'), value.__dict__); return value


class Transport:
    def __init__(self, loader, descriptor, descriptors):
        self.preload = 'data:text/javascript;base64,' + base64.b64encode(loader).decode()
        self.environment = {'YUNIPALS_READER_PUBLIC_FD': str(descriptor)}
        self.pass_fds = tuple(descriptors)
    def node_arguments(self): return [NODE, '--import', self.preload, str(OPS / ENTRY)]


@contextmanager
def public_transport():
    need(os.geteuid() == 0, 'root_public_transport_parent_required')
    old = primitives(); loader = loader_bytes(old.public_bytes(TEMPLATE, TEMPLATE_SHA))
    files = {name: old.public_bytes(OPS / name, digest) for name, digest in PINS.items()}
    descriptors = []
    try:
        rows = []
        for name, raw in files.items():
            fd = old.sealed('yunipals-cache-public', raw); descriptors.append(fd)
            rows.append({'name': name, 'fd': fd, 'bytes': len(raw), 'sha256': PINS[name]})
        descriptor = old.sealed('yunipals-cache-public-map', encoded({'format': 'yunipals-reader-sealed-public-v1', 'files': rows}))
        descriptors.append(descriptor)
        yield Transport(loader, descriptor, descriptors)
    finally:
        for fd in reversed(descriptors): os.close(fd)
