#!/usr/bin/env python3
"""Run only the approved disposable SQL and root-socket fixture."""
import os
from pathlib import Path
import socket
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent
NODE='/root/.nvm/versions/node/v24.18.1/bin/node'

if __name__=='__main__':
    expected='postgresql://postgres@127.0.0.1:56983/fixture'
    if os.environ.get('ARENA_INVERSE_FIXTURE_URL')!=expected:raise SystemExit('fixed_disposable_local_fixture_only')
    env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','ARENA_INVERSE_FIXTURE_URL':expected,'ARENA_DERIVED_FIXTURE_URL':expected}
    args=[NODE,str(HERE/'arena-ypal-native-return-v2.postgres.test.mjs')]
    first=subprocess.run([*args,'--transactions'],env=env,capture_output=True,timeout=60)
    print(first.stdout.decode(),end='')
    if first.returncode:print(first.stderr.decode(),end='');raise SystemExit(first.returncode)
    with tempfile.TemporaryDirectory(prefix='arena-native-pool-fixture-')as directory:
        path=Path(directory)/'native.sock';listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);probe=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        try:
            listener.bind(str(path));os.chmod(path,0o600);listener.listen(8);probe.connect(str(path))
            child_env={**env,'NATIVE_POOL_FIXTURE_FD':str(listener.fileno()),'NATIVE_POOL_FIXTURE_PATH':str(path),
                'NATIVE_RETURN_PROBE_FD':str(probe.fileno()),'INVOCATION_ID':'a'*32}
            second=subprocess.run([*args,'--shared-native'],env=child_env,pass_fds=(listener.fileno(),probe.fileno()),capture_output=True,timeout=60)
            print(second.stdout.decode(),end='')
            if second.returncode:print(second.stderr.decode(),end='');raise SystemExit(second.returncode)
        finally:probe.close();listener.close()
