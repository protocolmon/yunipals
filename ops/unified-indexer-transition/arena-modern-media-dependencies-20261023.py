"""Read-only public media-code/dependency check in the retained media context."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import types

PACKAGE = Path('/opt/yunipals-unified/operations/arena-modern-package-20261022')
path = PACKAGE / 'arena-modern-runtime-preflight-v1.py'
raw = path.read_bytes()
assert hashlib.sha256(raw).hexdigest() == '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631'
p = types.ModuleType('retained_media_preflight')
p.__file__ = str(path)
exec(compile(raw, str(path), 'exec'), p.__dict__)
r = p.load(p.RESTORE, p.RESTORE_SHA, 'retained_media_restore')
m = r.load_owner()
o = m.observer()
binding, base, restored, proof = p.retained(r, m, o)
row = next(x for x in base['services'] if x['unit'] == 'yunipals-arena-media.service')
actor = p.actor(r, m, row, restored)
environment, _ = p.process_environment(actor['process']['pid'], row['unit'])
selected = Path(environment['ARENA_REPOSITORY_ROOT']).resolve(strict=True)
assert selected == Path(base['resolvedRelease'])
candidate = Path('/opt/yunipals-unified/releases/264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24')
names = ['scripts/arena/media_tools.py', 'scripts/arena/produce.py',
         'scripts/arena/referee.py', 'scripts/arena/render.py']
checks = []
for name in names:
    expected = hashlib.sha256(p.protected(candidate / name, 200000)).hexdigest()
    actual = hashlib.sha256(o.read(selected / name, 200000)[0]).hexdigest()
    checks.append({'path': name, 'candidateSha256': expected,
                   'retainedSha256': actual, 'matches': expected == actual})
if not all(x['matches'] for x in checks):
    print(json.dumps({'format': 'yunipals-arena-modern-media-dependencies-v1',
                      'passed': False, 'code': checks, 'serviceJobs': 0,
                      'providerCalls': 0, 'databaseWrites': 0}, sort_keys=True))
    raise SystemExit(1)
script = r'''
from pathlib import Path
import hashlib,json,os,runpy,subprocess,sys
assert os.getuid()==971 and os.getgid()==965 and not os.getgroups()
root=Path(sys.argv[1]); expected=json.loads(sys.argv[2])
for row in expected:
 assert hashlib.sha256((root/row['path']).read_bytes()).hexdigest()==row['candidateSha256']
sys.path.insert(0,str(root/'scripts/arena'))
runpy.run_path(str(root/'scripts/arena/media_tools.py'),run_name='qualified_offline_module')
font=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
assert font.is_file() and len(font.read_bytes())>0
tools={}
for name in ['ffmpeg','ffprobe']:
 v=subprocess.run([name,'-version'],stdin=subprocess.DEVNULL,capture_output=True,timeout=5)
 assert v.returncode==0 and len(v.stdout)<20000 and not v.stderr
 tools[name]={'available':True,'versionOutputSha256':hashlib.sha256(v.stdout).hexdigest()}
print(json.dumps({'passed':True,'uid':971,'gid':965,'offlineModuleImported':True,'fontReadable':True,'tools':tools,'providerCalls':0,'mediaRenderingPerformed':False,'privateInputsLoaded':False},sort_keys=True))
'''
command = ['/usr/bin/nsenter', '--target=' + str(actor['process']['pid']), '--mount', '--',
           '/usr/bin/setpriv', '--reuid=971', '--regid=965', '--clear-groups',
           '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs',
           '/usr/bin/python3', '-I', '-B', '-c', script, str(selected), json.dumps(checks)]
result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=30,
                        env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'})
assert result.returncode == 0 and not result.stderr and len(result.stdout) < 10000
child = json.loads(result.stdout)
assert child['passed'] is True
assert p.actor(r, m, row, restored) == actor
m.verify_inputs(o, binding['privateInputHashes'])
print(json.dumps({'format': 'yunipals-arena-modern-media-dependencies-v1',
                  'passed': True, 'code': checks, 'context': child,
                  'originalActorUnchanged': True, 'privateInputsUnchanged': True,
                  'serviceJobs': 0, 'databaseWrites': 0, 'sourceSelectionsChanged': 0,
                  'qualification': 'Public offline media code and host dependencies only; no film assembly or provider execution.'}, sort_keys=True))
