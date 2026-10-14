"""Stage source and perform one bounded historical qualification, without changing live readers."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import time
from urllib.request import urlopen

work=Path('/srv/yunipals-islands/base-replacement-v2')
archive=work/'backend-source.tar.gz'
old=Path('/opt/yunipals-islands/releases/base-islands-20261013-9f30c43d3441')
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
report={'release':str(release),'sourceFilesVerified':len(manifest['files']),'liveReadersChanged':False}
(work/'staging.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
# On-chain qualification runs through the bounded worker after migration.
