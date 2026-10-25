#!/usr/bin/env python3
"""Produce the finite public code manifest from real reviewed source files.

No host, runtime constructor, config, service or database access. Missing reader
or provider files refuse instead of creating a future producer placeholder.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = ('ypal-ordinary-feature-handover-continue-v2.py', 'ypal-ordinary-feature-context-continue-v2.py')


def sha(raw): return hashlib.sha256(raw).hexdigest()


def context():
    spec = importlib.util.spec_from_file_location('ordinary_feature_manifest_context', HERE/FILES[1])
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


def build(folder=HERE):
    c = context(); dependencies = dict(c.PINNED)
    def need(value, code):
        if not value: raise RuntimeError(code)
    for name in sorted(c.EXTERNAL): dependencies[name] = sha((folder/name).read_bytes())
    c.exact_dependencies(dependencies)
    for name, digest in dependencies.items():
        need(sha((folder/name).read_bytes()) == digest, 'exact_real_public_feature_dependency_before_manifest_required')
    reader = json.loads((folder/c.READER_MANIFEST).read_bytes())
    need(reader['acknowledgementRoute'] == {'file':c.READER,'sha256':dependencies[c.READER],'method':'acknowledgement'} and
           reader['files'][c.READER] == dependencies[c.READER] and
           reader['contexts']['phase'] == {'file':c.PROVIDER,'sha256':dependencies[c.PROVIDER]},
           'actual_final_reader_manifest_ACK_route_and_provider_bytes_required_before_feature_manifest')
    return {'format':c.FORMAT+'-code','files':{name:sha((folder/name).read_bytes()) for name in FILES},'dependencies':dependencies}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--out', type=Path); args = parser.parse_args()
    value = build()
    raw = (json.dumps(value, sort_keys=True, indent=2)+'\n').encode()
    if args.out is None: print(raw.decode(), end=''); return
    if not args.out.is_absolute() or args.out.name != 'ypal-ordinary-feature-handover-continue-v2.manifest.json':
        raise RuntimeError('absolute_exact_fresh_public_feature_manifest_destination_required')
    fd = os.open(args.out, os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd,'wb') as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    print(json.dumps({'manifestSha256':sha(raw),'publicFiles':len(value['files']),'publicDependencies':len(value['dependencies']),
                      'databaseWrites':0,'serviceActions':0,'providerCalls':0}))


if __name__=='__main__': main()
