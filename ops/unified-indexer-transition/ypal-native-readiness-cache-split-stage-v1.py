import ast
import base64
import hashlib
import json
import os
import subprocess
from pathlib import Path

os.umask(0o077)
ROOT = Path('/root/yunipals')
OPS = ROOT / 'ops/unified-indexer-transition'
NAMES = ['ypal-native-readiness-cache-split-v1.py', 'ypal-native-readiness-cache-split-v1.manifest.json']

def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + chr(10)).encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

record = json.loads(Path('/tmp/yunipals-cache-split-stage-record-20261026.json').read_bytes())
assert record['format'] == 'yunipals-cache-split-frozen-source-stage-v1' and set(record['files']) == set(NAMES)
sources = record['files']
payload = {}
dependencies = {}
for name, digest in sources.items():
    raw = (OPS / name).read_bytes()
    assert sha(raw) == digest
    payload[name] = base64.b64encode(raw).decode()
    if name.endswith('.manifest.json'):
        dependencies.update(json.loads(raw)['files'])
    else:
        tree = ast.parse(raw)
        constants = {node.targets[0].id: ast.literal_eval(node.value) for node in tree.body
                     if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
                     and node.targets[0].id in {'SQL_SOURCE_REVIEWED', 'SQL_REFS', 'CLASSIFIER_REFS', 'FORMAT'}}
assert constants['SQL_SOURCE_REVIEWED'] is True
dependencies = {name: digest for name, digest in dependencies.items() if name not in sources}
envelope = json.loads(Path('/tmp/yunipals-cont6-failed-cache-reconciliation-production-20261026-2.json').read_bytes())
recon_sha = envelope['resultSha256']
recon = {key: value for key, value in envelope.items() if key != 'resultSha256'}
assert sha(encoded(recon)) == recon_sha and recon['completed'] is True
assert recon['format'] == 'yunipals-root-cont6-failed-cache-reconciliation-v2'
assert recon['rootSourceSha256'] == 'caea00d91f690822b5f042ec4fbf9547b74961060354f68c931e4f61538b497b'
config = {
    'format': constants['FORMAT'] + '-input',
    'nativePolicyRefs': {
        'producerSha256': '33c6cae5ffe0980376a3ce5a6baa76096e2a619a7869b1b57c5f82de7e941210',
        'manifestSha256': '89b2d78177b5e7356fb65a21ae87f8eac7e6a6c0a59184b68dd202858e99ea53',
        'resultSha256': '90ad380f190bf43ab21ccaea15df940cfeeb121d85b96db85eaef35bec9f81f6'
    },
    'forwardAuthorityInputSha256': 'a468a1ebbb4bf3fe40b5506dfdc7959602b38b91ad051a4dd0674af2fc45cb6c',
    'forwardBaselineCapture': {
        'captureId': 'cont6-baseline-20261026-4',
        'resultSha256': 'ba84b39a37cb060c587f2bc8ffacd91933e7ed311cd9ce9d8c6816f1aaa75377'
    },
    'failedCommitRootSha256': 'ed7a7e0fc22fd509675f76f1ff6daed79b2841779a83a713bbe3411abd1f9a3b',
    'reconciliationRootSha256': recon_sha,
    'captureClassifierRefs': constants['CLASSIFIER_REFS'],
    'sqlRefs': constants['SQL_REFS']
}

REMOTE = r'''
import ast,base64,hashlib,json,os,pathlib,socket,stat
os.umask(0o077)
SOURCES=__SOURCES__
PAYLOAD=__PAYLOAD__
DEPENDENCIES=__DEPENDENCIES__
CONFIG=__CONFIG__
RECONCILIATION_SHA=__RECON_SHA__
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cache-split-stage-20261026')
INPUT_DIR=pathlib.Path('/var/backups/yunipals-native-readiness-cache-split-input-v1-20261026')
RECON_DIR=pathlib.Path('/var/backups/yunipals-root-cont6-failed-cache-reconciliation-20261026-2')
FRAME=('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
def enc(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+chr(10)).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def protected(path,digest=None):
 for parent in[*path.parents,path]:
  row=parent.lstat();assert row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 assert stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=8000000
 assert all(getattr(before,key)==getattr(after,key)for key in FRAME)
 assert digest is None or sha(raw)==digest
 return raw,{key:getattr(before,key)for key in FRAME}
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def write(path,raw,mode):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb')as stream:os.fchmod(stream.fileno(),mode);stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(path.parent)
assert os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main'
assert set(SOURCES)==set(PAYLOAD)and len(SOURCES)==2 and not set(SOURCES)&set(DEPENDENCIES)
assert len(DEPENDENCIES)<=512 and all(pathlib.Path(name).name==name for name in[*SOURCES,*DEPENDENCIES])
recon=json.loads(protected(RECON_DIR/'result.json',RECONCILIATION_SHA)[0])
assert recon['format']=='yunipals-root-cont6-failed-cache-reconciliation-v2'and recon['rootSourceSha256']=='caea00d91f690822b5f042ec4fbf9547b74961060354f68c931e4f61538b497b'
assert all(recon[key]is True for key in['completed','completeBaselineCatalogQualified','allColumnACLsQualified','fullSourcePostflightPassed','allOriginalFileBytesAndInodesUnchanged'])
assert recon['transactionId']=='17621037'and recon['transactionStatus']=='aborted'and recon['ownedChildGone']is True and recon['ownedBackendCount']==0
for name,digest in recon['privateHashes'].items():
 assert pathlib.Path(name).name==name
 protected(RECON_DIR/name,digest)
assert CONFIG['reconciliationRootSha256']==RECONCILIATION_SHA and not os.path.lexists(INPUT_DIR)
retained={}
for name,digest in DEPENDENCIES.items():retained[name]=protected(OPS/name,digest)[1]
decoded={}
for name,digest in SOURCES.items():
 raw=base64.b64decode(PAYLOAD[name],validate=True);assert sha(raw)==digest
 if name.endswith('.py'):ast.parse(raw)
 else:assert type(json.loads(raw))is dict
 decoded[name]=raw
 if os.path.lexists(OPS/name):
  old,frame=protected(OPS/name,digest);assert old==raw;retained[name]=frame
assert not os.path.lexists(AUDIT)
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
write(AUDIT/'intent.json',enc({'sources':SOURCES,'reconciliationRootSha256':RECONCILIATION_SHA,'sourceImported':False,'databaseWrites':0,'automaticRetryAllowed':False}),0o600)
new=[]
for name,raw in decoded.items():
 if name not in retained:write(OPS/name,raw,0o644);new.append(name)
for name,digest in{**DEPENDENCIES,**SOURCES}.items():
 raw,frame=protected(OPS/name,digest)
 if name in retained:assert frame==retained[name]
INPUT_DIR.mkdir(mode=0o700);sync(INPUT_DIR.parent);write(INPUT_DIR/'input.json',enc(CONFIG),0o600)
input_sha=sha(protected(INPUT_DIR/'input.json',sha(enc(CONFIG)))[0])
result={'format':'yunipals-root-cache-split-public-source-and-sidecar-stage-v1','completed':True,'inputSha256':input_sha,'reconciliationRootSha256':RECONCILIATION_SHA,'sourceHashes':SOURCES,'verifiedExistingPrerequisites':len(DEPENDENCIES),'newRuntimeFiles':len(new),'retainedBytesAndInodesUnchanged':True,'existingFilesOverwritten':0,'sourceImported':False,'operatorInvoked':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'automaticRetryAllowed':False}
write(AUDIT/'result.json',enc(result),0o600);print(json.dumps({**result,'resultSha256':sha(enc(result))},sort_keys=True))
'''

for token, value in [('__SOURCES__', sources), ('__PAYLOAD__', payload), ('__DEPENDENCIES__', dependencies), ('__CONFIG__', config), ('__RECON_SHA__', recon_sha)]:
    REMOTE = REMOTE.replace(token, repr(value))
compile(REMOTE, '<cache-split-source-and-sidecar-stage>', 'exec')
peer = subprocess.run(['ssh', '-oBatchMode=yes', '-oConnectTimeout=10', '-oStrictHostKeyChecking=yes',
                       '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts', 'root@168.119.172.10', 'python3 -I -B -'],
                      input=REMOTE, capture_output=True, text=True, timeout=110)
if peer.returncode:
    Path('/tmp/yunipals-root-cache-split-stage-error-private-20261026.txt').write_text(peer.stdout + peer.stderr)
    print(json.dumps({'completed': False, 'returncode': peer.returncode, 'diagnosticBytes': len(peer.stdout + peer.stderr)}))
    raise SystemExit(peer.returncode)
value = json.loads(peer.stdout)
with Path('/tmp/yunipals-cache-split-stage-production-20261026.json').open('x') as stream:
    json.dump(value, stream, sort_keys=True)
    stream.write(chr(10))
print(json.dumps(value, sort_keys=True))
