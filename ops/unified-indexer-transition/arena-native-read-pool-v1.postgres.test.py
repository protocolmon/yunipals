#!/usr/bin/env python3
"""Own only the disposable root0600 listener used by the local PG test."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

if __name__=='__main__':
    if os.environ.get('ARENA_DERIVED_FIXTURE_URL')!='postgresql://postgres@127.0.0.1:56983/fixture':raise SystemExit('fixed_disposable_local_fixture_only')
    with tempfile.TemporaryDirectory(prefix='arena-native-pool-fixture-')as directory:
        os.chmod(directory,0o755)
        path=Path(directory)/'native.sock';listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        try:
            listener.bind(str(path));os.chmod(path,0o600);listener.listen(8)
            denied=subprocess.run(['/usr/bin/setpriv','--reuid=65534','--regid=65534','--clear-groups','--inh-caps=-all',
                '--ambient-caps=-all','--bounding-set=-all','--no-new-privs','/usr/bin/python3','-I','-B','-c',
                'import socket,sys\ns=socket.socket(socket.AF_UNIX)\ntry:s.connect(sys.argv[1])\nexcept PermissionError:raise SystemExit(0)\nraise SystemExit(1)',str(path)],
                env={'PATH':'/usr/bin:/bin'},capture_output=True,timeout=5)
            if denied.returncode or denied.stdout or denied.stderr:raise SystemExit('actual_nonroot_socket_permission_test_failed')
            env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','ARENA_DERIVED_FIXTURE_URL':os.environ['ARENA_DERIVED_FIXTURE_URL'],
                 'NATIVE_POOL_FIXTURE_FD':str(listener.fileno()),'NATIVE_POOL_FIXTURE_PATH':str(path),'INVOCATION_ID':'a'*32}
            result=subprocess.run(['/root/.nvm/versions/node/v24.18.1/bin/node',str(Path(__file__).with_suffix('.mjs'))],
                env=env,pass_fds=(listener.fileno(),),capture_output=True,timeout=60)
            print(result.stdout.decode(),end='')
            if result.returncode:print(result.stderr.decode(),end='');raise SystemExit(result.returncode)
            print(json.dumps({'rootMode0600SocketCrossUIDDenied':True}))
        finally:listener.close()
