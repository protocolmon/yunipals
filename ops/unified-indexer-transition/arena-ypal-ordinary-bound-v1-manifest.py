#!/usr/bin/env python3
"""Render actual Arena code references without evaluating a runtime owner."""
import ast
import hashlib
import json
from pathlib import Path
import re

FORMAT = 'yunipals-arena-ypal-ordinary-bound-v1'
OWNER = 'arena-ypal-ordinary-bound-v1.py'
FROZEN = 'arena-ypal-ordinary-v1.py'
FROZEN_SHA = '60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0'
ARTIFACT = 'e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234'


def sha(raw):return hashlib.sha256(raw).hexdigest()
def need(value, code):
    if not value:raise RuntimeError(code)


def literal(raw, name):
    nodes = [node for node in ast.parse(raw).body if isinstance(node, ast.Assign) and len(node.targets) == 1 and
             isinstance(node.targets[0], ast.Name) and node.targets[0].id == name]
    need(len(nodes) == 1, 'one_literal_Arena_source_assignment_required')
    return ast.literal_eval(nodes[0].value)


def build(folder):
    folder = Path(folder); raw = (folder/OWNER).read_bytes(); pins = literal(raw, 'PINS')
    need(type(pins) is dict and len(pins) == 13 and pins.get(FROZEN) == FROZEN_SHA and
         all(type(name) is str and re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json)', name) and
             type(digest) is str and re.fullmatch('[a-f0-9]{64}', digest) for name, digest in pins.items()),
         'exact_finite_bound_Arena_source_map_required')
    for name, digest in pins.items():
        content = (folder/name).read_bytes()
        need(0 < len(content) <= 4000000 and sha(content) == digest, 'actual_existing_Arena_source_bytes_required')
    source = literal((folder/FROZEN).read_bytes(), 'SOURCE_VALUE')
    return {'format': FORMAT+'-code', 'files': {**pins, OWNER: sha(raw)}, 'source': source,
            'authority': {'migrationsPerformed': 0, 'oldWholeValidationClaimed': False,
                'rolesRequireSeparateAdmission': True, 'configurationSecretsReused': True,
                'readinessArtifactDigest': ARTIFACT, 'sourceKind': 'typed-current-epoch'}}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--build', action='store_true'); args = parser.parse_args()
    value = build(Path(__file__).resolve().parent) if args.build else {
        'format': FORMAT+'-code', 'staticOnly': True, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    print(json.dumps(value, sort_keys=True, indent=2))
