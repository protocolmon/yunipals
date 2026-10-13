"""Package reviewed backend source only; credentials and dependencies stay on the server."""
import hashlib
import json
from pathlib import Path
import tarfile

root=Path(__file__).resolve().parents[2]
app=root/'apps/yunipals-indexer'
output=root/'docs/audit/base-islands'
output.mkdir(parents=True,exist_ok=True)
files={}
for directory in ['lib','scripts','data/islands']:
    for path in (app/directory).rglob('*'):
        if path.is_file() and not path.is_symlink() and path.suffix in {'.ts','.mjs','.json','.sql'}:
            files[str(path.relative_to(app))]=path
for name in ['package.json','tsconfig.json']:
    files[name]=app/name
manifest={'version':'base-islands-integration-v1','sourceBaseline':'4e0d7533e2e8a74ce85055573e03fb9d8648f8e4',
          'productionBackendBaseline':'staked-filter-20261008-af66261',
          'files':{name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in sorted(files.items())}}
identity=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
manifest['releaseId']='base-islands-20261013-'+identity[:12]
(output/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
with tarfile.open(output/'backend-source.tar.gz','w:gz') as archive:
    for name,path in sorted(files.items()): archive.add(path,arcname=name)
    archive.add(output/'source-manifest.json',arcname='base-islands-source-manifest.json')
print(json.dumps({'releaseId':manifest['releaseId'],'sourceFiles':len(files),
                 'archiveBytes':(output/'backend-source.tar.gz').stat().st_size},indent=2))
