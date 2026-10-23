from pathlib import Path
import hashlib
import json
import os
import socket
import subprocess

assert os.geteuid() == 0 and socket.gethostname() == 'yunipals-main'
os.umask(0o077)
work = Path('/mnt/HC_Volume_107222036/arena-modern-package-20261022')
ops = Path('/opt/yunipals-unified/operations/arena-modern-package-20261022')
raw = (work / 'arena-consumer-package-proof.json').read_bytes()
assert hashlib.sha256(raw).hexdigest() == 'a2b353f788d5d6a15408c3ee9cc3e46d100a9fd6a0c4b90230fd9f53091bc01e'
proof = json.loads(raw)
pins = proof['nativeUnits']['files']
assert len(pins) == 8 and proof['nativeUnits']['unitsInstalledOrStarted'] is False
paths = []
for name, pin in pins.items():
    assert '/' not in name and name.startswith('yunipals-arena-native-') and name.endswith('.service')
    path = work / 'native-units' / name
    assert not path.is_symlink() and path.stat().st_uid == 0
    assert hashlib.sha256(path.read_bytes()).hexdigest() == pin
    paths.append(str(path))
result = subprocess.run(['/usr/bin/systemd-analyze', '--no-pager', 'verify', '--man=no', *sorted(paths)],
                        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'},
                        stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
assert len(result.stdout) < 200000 and len(result.stderr) < 200000
for suffix, value in [('stdout', result.stdout), ('stderr', result.stderr)]:
    with (ops / ('native-unit-verify-20261023.' + suffix)).open('xb') as handle:
        handle.write(value)
        handle.flush()
        os.fsync(handle.fileno())
print(json.dumps({'format': 'yunipals-arena-modern-native-unit-verification-v1',
                  'unitsVerified': len(paths), 'exitCode': result.returncode,
                  'stdoutBytes': len(result.stdout), 'stderrBytes': len(result.stderr),
                  'stderrSha256': hashlib.sha256(result.stderr).hexdigest(),
                  'buildProofSha256': hashlib.sha256(raw).hexdigest(),
                  'unitsInstalled': False, 'unitsStarted': False, 'serviceJobs': 0,
                  'providerCalls': 0}, sort_keys=True))
raise SystemExit(0 if result.returncode == 0 else 1)
