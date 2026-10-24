# Historical one-time public-file staging and source-leaf preflight.
# Completed operation: its exclusive audit path prevents replay.
import json,shlex,subprocess
from pathlib import Path
remote=r'''
import datetime,hashlib,json,os,signal,socket,stat,types,urllib.request
from pathlib import Path
signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(RuntimeError('bounded_Arena_source_preparation_expired')));signal.alarm(300)
assert os.geteuid()==0 and socket.gethostname()=='yunipals-main'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020');AUDIT=Path('/var/backups/yunipals-arena-restored-host-preparation-v1-20261024')
COMMIT='5303f65171a8df6f78328120813371480e15be59';MANIFEST_SHA='0ded970fe47ea506e855e1e37a6c4dec84526dafb32f88a32299bbb8d763e190'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
encoded=lambda v:(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def protected(p,expected=None):
 p=Path(p)
 for q in [p,*p.parents]:
  row=q.lstat();assert row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022
 raw=p.read_bytes();assert expected is None or sha(raw)==expected;return raw
def module(p,expected):
 raw=protected(p,expected);v=types.ModuleType(p.stem);v.__file__=str(p);exec(compile(raw,str(p),'exec'),v.__dict__);return v
def save(name,value):
 raw=encoded(value);fd=os.open(AUDIT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 return sha(raw)
restore=module(OPS/'ypal-source-tail-restore-v1.py','de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34')
r,sdk,h,op=restore.load();restorer=restore.Owner(r,sdk,h,op)
receipt=json.loads(protected(restore.BASE/'result.json','0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'))
def snapshot():
 actor=restore.canonical_actor(restorer.owned());assert actor==receipt['source']
 native=h.native();assert native['tables']==receipt['native']['tables']and native['cache']==receipt['native']['cache'];restorer.floors(native)
 return {'source':actor,'peers':restorer.preserved(),'inputs':h.inputs(),'nativeTables':native['tables'],'syncCache':native['cache']}
def fetch(name,digest):
 assert '/'not in name and name not in {'.','..'}
 p=OPS/name
 if p.exists():protected(p,digest);return {'file':name,'sha256':digest,'new':False,'mode':stat.S_IMODE(p.stat().st_mode)}
 raw=urllib.request.urlopen('https://raw.githubusercontent.com/protocolmon/yunipals/'+COMMIT+'/ops/unified-indexer-transition/'+name,timeout=15).read(1000000)
 assert sha(raw)==digest
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 protected(p,digest);return {'file':name,'sha256':digest,'new':True,'mode':0o600}
with sdk.lock():
 assert not AUDIT.exists();first=snapshot();AUDIT.mkdir(mode=0o700);save('before.json',first)
 repo=json.loads(urllib.request.urlopen('https://api.github.com/repos/protocolmon/yunipals',timeout=10).read(1000000))
 assert repo['private']is False and repo['full_name']=='protocolmon/yunipals'
 name='arena-ypal-restored-v1.manifest.json';staged=[fetch(name,MANIFEST_SHA)];manifest=json.loads(protected(OPS/name,MANIFEST_SHA))
 assert manifest['format']=='yunipals-arena-ypal-restored-code-v1'and len(manifest['files'])==12
 for name,digest in manifest['files'].items():staged.append(fetch(name,digest))
 stage=save('staged.json',{'publicCommit':COMMIT,'files':staged,'existingPermissionsChanged':False})
 owner=module(OPS/'arena-ypal-restored-v1.py',manifest['files']['arena-ypal-restored-v1.py']);owner.validate_manifest(manifest)
 context=module(owner.SOURCE_CONTEXT,manifest['files'][owner.SOURCE_CONTEXT.name])
 forward=context.validate_current();inverse=context.validate_current(terminal_ok=True)
 assert forward['validated']is forward['sourceActorQualified']is True and forward['source']==receipt['source']
 assert forward['sourceTerminal']is forward['inverseOnly']is forward['nativeReadinessQualified']is forward['paidAuthority']is False
 assert inverse['validated']is inverse['sourceActorQualified']is inverse['inverseOnly']is True and inverse['source']==receipt['source']
 assert inverse['sourceTerminal']is inverse['nativeReadinessQualified']is inverse['currentCanonicalCoverageQualified']is False
 assert forward['dataIdentity']==inverse['dataIdentity']and len(forward['tables'])==9
 assert not owner.BASE.exists()and snapshot()==first
 result={'format':'yunipals-arena-restored-host-preparation-v1','completed':True,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'publicCommit':COMMIT,'manifestSha256':MANIFEST_SHA,'publicFiles':len(staged),'newPublicFiles':sum(v['new']for v in staged),'stageReceiptSha256':stage,
 'operatorSha256':manifest['files']['arena-ypal-restored-v1.py'],'sourceHelperSha256':manifest['files'][owner.SOURCE_CONTEXT.name],
 'activeRestoredSourceLeafQualified':True,'inverseModeQualifiedOnSameActiveSource':True,'terminalSourceObserved':False,
 'dataIdentity':forward['dataIdentity'],'arenaSourceRelationsQualified':len(forward['tables']),
 'currentRPCReceiptSha256':forward['currentRPCQualification']['sha256'],'forwardProofSha256':sha(encoded(forward)),'inverseOnlyProofSha256':sha(encoded(inverse)),
 'fullArenaHostConstructorQualified':False,'actualRoleAuthenticationQualified':False,'canonicalArenaCoverageQualified':False,'nativeWorkersStarted':False,
 'sourceAndServingPeersUnchanged':True,'nativeAndCacheIdentityPreserved':True,'migrationOperationAbsent':True,
 'existingPermissionsChanged':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'privateRawReportsExported':False,'sourceBytesTransferredOverSSH':0}
 result_sha=save('result.json',result)
 print(json.dumps({**result,'actualResultFile':str(AUDIT/'result.json'),'actualResultSha256':result_sha},sort_keys=True))
'''
cp=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes','-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -c '+shlex.quote(remote)],capture_output=True,text=True,timeout=320)
if cp.returncode:
 print(json.dumps({'completed':False,'exitCode':cp.returncode,'privateDiagnosticBytes':len(cp.stderr)}));raise SystemExit(cp.returncode)
assert not cp.stderr
value=json.loads(cp.stdout);p=Path('/tmp/yunipals-arena-restored-host-preparation-production-20261024.json')
with p.open('x')as f:json.dump(value,f,sort_keys=True);f.write('\n')
p.chmod(0o600);print(json.dumps(value,sort_keys=True))
