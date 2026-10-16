"""Prepare private arena service identities. No deploy, broadcast or service start.

Run as root on yunipals-main. Existing identities are retained; a missing manifest
with existing keys aborts rather than replacing keys. stdout contains public
addresses and filenames only. No private key appears in process arguments.
"""
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import subprocess

assert os.geteuid() == 0
assert os.uname().nodename == 'yunipals-main'
private = Path('/etc/yunipals-arena')
private.mkdir(mode=0o700, exist_ok=True)
assert private.stat().st_mode & 0o077 == 0
manifest = private / 'service-identities.json'
keys = ['admission', 'referee', 'operator']
if manifest.exists():
    identities = json.loads(manifest.read_text())
    assert all((private / (name + '.key')).is_file() for name in keys)
else:
    assert not any((private / (name + '.key')).exists() for name in keys), 'Existing key without manifest; reconcile manually'
    identities = {'version': 'arena-service-identities-v1', 'addresses': {}}
    for name in keys:
        result = subprocess.run(['cast', 'wallet', 'new', '--json'], capture_output=True, check=True)
        value = json.loads(result.stdout)
        def wallets(value):
            if isinstance(value, dict):
                fields = {k.replace('_', '').lower(): v for k, v in value.items()}
                if 'address' in fields and 'privatekey' in fields:
                    yield fields
                else:
                    for child in value.values(): yield from wallets(child)
            elif isinstance(value, list):
                for child in value: yield from wallets(child)
        found = list(wallets(value))
        assert len(found) == 1, 'Unexpected Foundry response shape; no key printed'
        wallet = found[0]
        secret = wallet['privatekey']
        assert isinstance(secret, str) and re.fullmatch(r'(0x)?[0-9a-fA-F]{64}', secret)
        secret = secret if secret.startswith('0x') else '0x' + secret
        assert re.fullmatch(r'0x[0-9a-fA-F]{40}', wallet['address'])
        fd = os.open(private / (name + '.key'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as out:
            out.write(secret + '\n')
        identities['addresses'][name] = wallet['address']
    fd = os.open(manifest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(identities, out, indent=2); out.write('\n')
key = private / 'strategy-encryption.key'
if not key.exists():
    fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(secrets.token_hex(32) + '\n')
for name in [*(name + '.key' for name in keys), 'strategy-encryption.key', 'service-identities.json']:
    assert (private / name).stat().st_mode & 0o077 == 0
try:
    user = pwd.getpwnam('yunipals-arena')
except KeyError:
    subprocess.run(['useradd', '--system', '--home-dir', '/var/lib/yunipals-arena', '--shell', '/usr/sbin/nologin', 'yunipals-arena'], check=True)
    user = pwd.getpwnam('yunipals-arena')
parent = Path('/var/lib/yunipals-arena')
parent.mkdir(mode=0o750, exist_ok=True)
os.chown(parent, 0, user.pw_gid); parent.chmod(0o750)
for name in ['media', 'backups']:
    folder = parent / name
    folder.mkdir(mode=0o700, exist_ok=True)
    os.chown(folder, user.pw_uid, user.pw_gid); folder.chmod(0o700)
Path('/srv/yunipals-arena/releases').mkdir(mode=0o755, parents=True, exist_ok=True)
print(json.dumps({**identities, 'serviceUser': user.pw_name, 'privatePermissionsVerified': True, 'servicesStarted': False, 'transactionsBroadcast': 0}))
