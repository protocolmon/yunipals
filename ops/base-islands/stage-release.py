"""Stage source and perform one bounded historical qualification, without changing live readers."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import time
from urllib.request import urlopen

work=Path('/srv/yunipals-islands/base-integration-v1')
archive=work/'backend-source.tar.gz'
old=Path('/opt/yunipals-islands/releases/staked-filter-20261008-af66261')
manifest=json.loads((work/'source-manifest.json').read_text())
release=old.parent/manifest['releaseId']
assert not release.exists(), 'Release already exists; inspect it before resuming'
actual=subprocess.check_output(['systemctl','show','yunipals-islands-api','--property=WorkingDirectory','--value'],text=True).strip()
assert actual==str(old),'Production API baseline changed'
subprocess.run(['cp','-a','--reflink=auto',str(old),str(release)],check=True)
with tarfile.open(archive) as bundle:
    assert all(not Path(member.name).is_absolute() and '..' not in Path(member.name).parts and not member.issym() and not member.islnk()
               for member in bundle.getmembers())
    bundle.extractall(release,filter='data')
for name,expected in manifest['files'].items():
    assert hashlib.sha256((release/name).read_bytes()).hexdigest()==expected,name
if '--stage-only' in __import__('sys').argv:
    print(json.dumps({'release':str(release),'sourceFilesVerified':len(manifest['files']),'liveReadersChanged':False}))
    raise SystemExit(0)
with urlopen('http://127.0.0.1:19202/metrics',timeout=10) as response:
    before=json.load(response)
(work/'rpc-before-qualification.json').write_text(json.dumps(before,indent=2)+'\n')
result=subprocess.run(['/opt/node-v24.18.1/bin/node','--import','tsx','scripts/qualify-base-islands.ts'],
    cwd=release,env={**__import__('os').environ,'BASE_ISLANDS_RPC_URL':'http://127.0.0.1:19202'},
    capture_output=True,text=True,timeout=120)
if result.returncode:
    print(result.stderr[-3000:])
    raise RuntimeError('RPC qualification failed; production readers are unchanged')
qualified=json.loads(result.stdout)
assert qualified['runtimeAndProvenanceVerified'] and qualified['logCount']>=898
(work/'rpc-qualification.json').write_text(json.dumps(qualified,indent=2)+'\n')
report={'stagedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'release':str(release),
        'sourceFilesVerified':len(manifest['files']),'rpcQualification':qualified,'liveReadersChanged':False}
(work/'staging.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
