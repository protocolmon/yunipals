#!/usr/bin/env python3
"""Read-only renderer for one synthetic systemd identity/import qualification.

It never writes a unit, starts a service, calls a provider or opens a credential.
A root operator must independently inspect and install the returned definition.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
UNIT = 'yunipals-qualified-receipt-v3-identity-probe.service'
FRAGMENT = Path('/run/systemd/system/yunipals-unified-support-source6-v2.service')
FRAGMENT_SHA = '5afdb87ded1b7beb3c2d60abd8825fe311032a403977b537266ebe706d6cd214'
SOURCE = '008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'
SCRIPT = OPS / 'source6-qualified-receipt-probe-v3.mjs'
SCRIPT_SHA = 'f014900df11adb76f7c8e4f9f900cb45879189170c8f6fb6acb94ad2d2eabbec'

def protected(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_nlink != 1:
        raise RuntimeError('exact_protected_public_probe_input_required')
    return path.read_bytes()

def render():
    original = protected(FRAGMENT)
    if hashlib.sha256(original).hexdigest() != FRAGMENT_SHA or hashlib.sha256(protected(SCRIPT)).hexdigest() != SCRIPT_SHA:
        raise RuntimeError('exact_retained_fragment_and_synthetic_probe_required')
    # The reviewed original has no credential/environment-file loader. Never
    # silently inherit a newly introduced private file into this synthetic test.
    if re.search(rb'(?m)^\s*(?:EnvironmentFile|LoadCredential(?:Encrypted)?|SetCredential(?:Encrypted)?)\s*=', original):
        raise RuntimeError('synthetic_probe_must_not_load_credentials')
    command = ['/usr/bin/env', '-i', 'PATH=/opt/node-v24.18.1/bin:/usr/bin:/bin',
               'LANG=C.UTF-8', 'TZ=UTC', 'NODE_OPTIONS=--max-old-space-size=384',
               'YUNIPALS_SUPPORT_UID=969', 'YUNIPALS_SUPPORT_GID=963',
               '/opt/node-v24.18.1/bin/node', '--import', 'tsx', str(SCRIPT)]
    # Preserve all original security/network/filesystem directives verbatim.
    # Only executable/cwd and the smaller synthetic runtime differ.
    return original.rstrip() + ('\n\n[Service]\nWorkingDirectory=/opt/yunipals-unified/releases/' + SOURCE +
        '/apps/yunipals-indexer\nExecStart=\nExecStart=' + ' '.join(command) + '\nRuntimeMaxSec=30\n').encode()

if __name__ == '__main__':
    if os.geteuid() != 0: raise RuntimeError('root_readonly_render_required')
    value = render()
    print(json.dumps({'format': 'yunipals-qualified-receipt-v3-probe-definition-v1', 'unit': UNIT,
        'originalFragmentSha256': FRAGMENT_SHA, 'definitionSha256': hashlib.sha256(value).hexdigest(),
        'definitionBytes': len(value), 'serviceActions': 0, 'providerCalls': 0,
        'databaseCalls': 0, 'credentialReads': 0}, sort_keys=True))
