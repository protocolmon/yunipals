"""Back up the latest consistent Islands dump and public deployment files; verify downloaded bytes."""
import hashlib,json,os,re,shlex,subprocess,tempfile,time,zipfile
from pathlib import Path
work=Path('/srv/yunipals-islands/base-replacement-v2')
root=Path(os.environ.get('ISLANDS_BACKUP_DIR','/var/backups/yunipals-islands-indexer'))
backup=max((p.parent for p in root.glob('*/manifest.json')),key=lambda p:p.name)
manifest=json.loads((backup/'manifest.json').read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
for name,expected in manifest['files'].items():assert sha(backup/name)==expected,name
files={'database/'+p.name:p for p in backup.iterdir() if p.is_file() and p.name not in {'recovery.zip','storage-box-verification.json'}}
for name in ['backup-islands.ts','backup-storage.py','health-islands.py']:
 p=Path('/opt/yunipals-islands/operations')/name
 files['operations/'+name]=p
files['operations/restore-check.py']=work/'restore-check.py'
for name in ['source-manifest.json','backend-source.tar.gz','worker-preparation.json','rpc-qualification.json','api-deployment.json','budget-restored.json','free-log-route.json','public-api-verification.json']:
 p=work/name
 if p.is_file():files['deployment/'+name]=p
for p in [Path('/etc/systemd/system/yunipals-base-islands-v2.service'),Path('/etc/systemd/system/yunipals-base-islands.service'),Path('/etc/systemd/system/yunipals-islands-api.service.d/zzzz-base-islands.conf'),Path('/etc/nginx/snippets/yunipals-islands-indexer-location.conf'),Path('/etc/systemd/system/yunipals-market-production-rpc@base.service.d/zz-base-islands-free-logs.conf'),Path('/etc/yunipals-marketplace/production/rpc/base-islands-free-logs.env')]:
 if p.is_file():files['config/'+p.name]=p
for p in (work/'contract-release').rglob('*'):
 if p.is_file():files['contract-release/'+str(p.relative_to(work/'contract-release'))]=p
for p in (work/'public').rglob('*'):
 if p.is_file():files['replacement-metadata/'+str(p.relative_to(work/'public'))]=p
for name in ['snapshot.json','reconciliation.json','source-verification.json']:
 p=work/name
 if p.is_file():files['replacement/'+name]=p
files['config/replacement-metadata-nginx.conf']=Path('/etc/nginx/snippets/yunipals-island-metadata-v2.conf')
archive=backup/'recovery.zip'
if not archive.exists():
 with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
  for name,p in sorted(files.items()):z.write(p,name)
  z.writestr('recovery-manifest.json',json.dumps({'createdAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'files':{name:sha(p) for name,p in files.items()},'credentialsIncluded':False,'restore':'Create metadata and metadata_source schemas; restore foundation.dump; import sources.json; restore publication.dump, islands.dump, base-islands.dump and base-islands-v2.dump; import readiness.json. Retain protected credentials separately.'},indent=2)+'\n')
 archive.chmod(0o600)
expected=sha(archive)
target=os.environ.get('STORAGE_URI','');password=os.environ.get('STORAGE_PW','')
assert re.fullmatch(r'[A-Za-z0-9._-]+@[A-Za-z0-9.-]+',target) and password
environment={**os.environ,'SSHPASS':password}
options=['-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/etc/yunipals-marketplace/backup-known-hosts','-o','ConnectTimeout=15']
def execute(args):
 r=subprocess.run(['sshpass','-e',*args],env=environment,capture_output=True,timeout=240)
 assert r.returncode==0,f'Storage Box operation failed ({r.returncode}); output suppressed'
 return r.stdout.decode().strip()
def ssh(cmd):return execute(['ssh','-p','23',*options,target,cmd])
remote='yunipals-islands/base-replacement-v2/'+expected
ssh('mkdir -p '+shlex.quote(remote));final=remote+'/recovery.zip'
if 'recovery.zip' not in ssh('ls -1 '+shlex.quote(remote)).splitlines():
 partial=final+'.partial';execute(['scp','-P','23',*options,str(archive),target+':'+partial])
 assert ssh('sha256sum '+shlex.quote(partial)).split()[0]==expected
 ssh('mv '+shlex.quote(partial)+' '+shlex.quote(final))
else:assert ssh('sha256sum '+shlex.quote(final)).split()[0]==expected
with tempfile.TemporaryDirectory(prefix='islands-backup-verify-') as temporary:
 downloaded=Path(temporary)/'recovery.zip'
 execute(['scp','-P','23',*options,target+':'+final,str(downloaded)])
 assert sha(downloaded)==expected
 with zipfile.ZipFile(downloaded) as z:
  assert z.testzip() is None
  for name,p in files.items():assert hashlib.sha256(z.read(name)).hexdigest()==sha(p)
report={'verifiedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'backupDirectory':str(backup),'storageBoxVerified':True,'downloadedArchiveVerified':True,'archiveSha256':expected,'archiveBytes':archive.stat().st_size,'remoteDirectory':remote,'files':len(files),'credentialsIncluded':False}
(backup/'storage-box-verification.json').write_text(json.dumps(report,indent=2)+'\n');(work/'storage-box-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
