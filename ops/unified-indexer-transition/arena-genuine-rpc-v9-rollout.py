#!/usr/bin/env python3
"""Root-only fixed isolated Arena-v9 review, then separately exact-hash start."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess

OPS=Path('/opt/yunipals-unified/operations/arena-genuine-rpc-20261021')
VOLUME=Path('/mnt/HC_Volume_107222036')
PARENT=VOLUME/'arena-genuine-rpc'
WORK=PARENT/'20261021-genuine-i'
UNIT='yunipals-arena-genuine-rpc-20261021-i.service'
HELPER=OPS/'arena-genuine-rpc-v9.py'
HELPER_SHA='2be5b2028baec771ec0cd365ccb4ea8b3125ef1cc3cb124e71171eadea0c602b'
PLAN=OPS/'plan-genuine-i.json'
PLAN_SHA='dab3590e0329f2e89d144a9a50cfc1a15e883989f1ee22780b24bf2878f96f6d'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC'}
FORMAT='yunipals-arena-genuine-v9-rollout-v1'

def fail():raise RuntimeError('fixed_arena_v9_rollout_prerequisite_refused')
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def trusted(path,expected=None,maximum=200000):
    for item in [*reversed(path.parents),path]:
        info=item.lstat()
        if info.st_uid!=0 or stat.S_ISLNK(info.st_mode) or info.st_mode&0o022:fail()
    info=path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size>maximum:fail()
    raw=path.read_bytes()
    if expected is not None and sha(raw)!=expected:fail()
    return raw
def save(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def command(argv,timeout=5):
    return subprocess.run(argv,env=ENV,stdin=subprocess.DEVNULL,capture_output=True,timeout=timeout,check=True)
def require_unused():
    state=command(['/usr/bin/systemctl','show',UNIT,'--property=LoadState','--value']).stdout.strip()
    if state!=b'not-found' or os.path.lexists(WORK):fail()
def properties(hidden,phase):
    return {'User':'964','Group':'958','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'',
        'PrivateNetwork':'yes','PrivateTmp':'no','TemporaryFileSystem':'/tmp:size=268435456,mode=1777 /var/tmp:size=268435456,mode=1777',
        'ProtectSystem':'strict','ProtectHome':'yes','ReadWritePaths':str(PARENT),'InaccessiblePaths':' '.join(hidden),
        'MemoryMax':'4294967296','MemorySwapMax':'0','CPUQuota':'100%','RuntimeMaxSec':'1800','Restart':'no',
        'IOWriteBandwidthMax':'/dev/sdb 52428800','KillMode':'control-group','TimeoutStopSec':'30','TasksMax':'256',
        'StandardOutput':'append:'+str(OPS/('actual-'+phase+'-v9.stdout.json')),
        'StandardError':'append:'+str(OPS/('actual-'+phase+'-v9.stderr.txt'))}
def launch_args(hidden):
    props=properties(hidden,'review')
    return ['/usr/bin/systemd-run','--quiet','--wait','--unit='+UNIT,*['--property='+key+'='+value for key,value in props.items()],
        '/usr/bin/env','-i',*['%s=%s'%row for row in ENV.items()],'/usr/bin/python3','-I',str(HELPER),'--plan',str(PLAN)]
def apply_args(review_launch,marker):
    argv=[item for item in review_launch if item!='--wait']
    for old,new in [('actual-review-v9.stdout.json','actual-run-v9.stdout.json'),('actual-review-v9.stderr.txt','actual-run-v9.stderr.txt')]:
        argv=[item.replace(old,new)for item in argv]
    return [*argv,'--run',marker]
def create_logs(phase):
    for suffix in ['stdout.json','stderr.txt']:save(OPS/('actual-'+phase+'-v9.'+suffix),b'')
def review():
    require_unused()
    hidden=sorted(set(['/var/lib/postgresql','/run/postgresql','/var/run/postgresql','/etc/postgresql','/var/backups',
                       *[str(path)for path in VOLUME.iterdir()if path!=PARENT]]))
    create_logs('review');argv=launch_args(hidden);raw=encoded(argv)
    save(OPS/'actual-review-v9.launch.json',raw)
    observed=command(argv,90)
    stdout=trusted(OPS/'actual-review-v9.stdout.json');stderr=trusted(OPS/'actual-review-v9.stderr.txt')
    value=json.loads(stdout)
    if (stderr or observed.stdout or observed.stderr or value.get('format')!='yunipals-arena-genuine-rpc-v9' or
        not re.fullmatch('[0-9a-f]{64}',value.get('reviewHash','')) or value.get('started')is not False or
        value.get('databaseCalls')!=0 or value.get('providerCalls')!=0 or value['binding']['operatorSha256']!=HELPER_SHA or
        value['binding']['plan']!=json.loads(trusted(PLAN,PLAN_SHA))):fail()
    save(OPS/'actual-review-v9.ack.json',encoded({'format':FORMAT,'reviewHash':value['reviewHash'],
        'reviewLaunchSha256':sha(raw),'reviewOutputSha256':sha(stdout),'helperSha256':HELPER_SHA,'planSha256':PLAN_SHA}))
    return {'format':FORMAT,'reviewHash':value['reviewHash'],'reviewLaunchSha256':sha(raw),'reviewOutputSha256':sha(stdout),
            'started':False,'databaseCalls':0,'providerCalls':0,'productionOrProviderAccessAllowed':False}
def apply(marker):
    if not re.fullmatch('[0-9a-f]{64}',marker):fail()
    require_unused()
    ack=json.loads(trusted(OPS/'actual-review-v9.ack.json'))
    raw=trusted(OPS/'actual-review-v9.launch.json',ack['reviewLaunchSha256'])
    review_output=trusted(OPS/'actual-review-v9.stdout.json',ack['reviewOutputSha256'])
    value=json.loads(review_output)
    if (ack!={'format':FORMAT,'reviewHash':marker,'reviewLaunchSha256':sha(raw),'reviewOutputSha256':sha(review_output),
              'helperSha256':HELPER_SHA,'planSha256':PLAN_SHA} or value['reviewHash']!=marker):fail()
    original=json.loads(raw)
    hidden=sorted(set(['/var/lib/postgresql','/run/postgresql','/var/run/postgresql','/etc/postgresql','/var/backups',
                       *[str(path)for path in VOLUME.iterdir()if path!=PARENT]]))
    if original!=launch_args(hidden):fail()
    create_logs('run');argv=apply_args(original,marker)
    save(OPS/'actual-run-v9.launch.json',encoded(argv))
    save(OPS/'actual-run-v9.intent.json',encoded({'format':FORMAT,'reviewHash':marker,'launchSha256':sha(encoded(argv)),
        'automaticRetryAllowed':False,'unit':UNIT,'work':str(WORK)}))
    try:
        command(argv,15)
        keys=['Id','LoadState','ActiveState','SubState','MainPID','InvocationID','MemoryMax','RuntimeMaxUSec']
        observed=command(['/usr/bin/systemctl','show',UNIT,*['--property='+key for key in keys]])
        state=dict(line.split('=',1)for line in observed.stdout.decode().splitlines())
        if (set(state)!=set(keys)or state['Id']!=UNIT or state['LoadState']!='loaded' or state['ActiveState']!='active' or
            state['SubState']!='running' or not re.fullmatch('[1-9][0-9]*',state['MainPID']) or
            not re.fullmatch('[0-9a-f]{32}',state['InvocationID'])or state['MemoryMax']!='4294967296'or state['RuntimeMaxUSec']!='30min'):fail()
        definition=command(['/usr/bin/systemctl','cat',UNIT]).stdout
        if len(definition)>100000:fail()
        out={'format':FORMAT,'reviewHash':marker,'started':True,'unit':state,'definitionSha256':sha(definition),
             'helperSha256':HELPER_SHA,'planSha256':PLAN_SHA,'work':str(WORK),'automaticRetryAllowed':False,
             'productionOrProviderAccessAllowed':False}
        save(OPS/'actual-run-v9.start.json',encoded(out));return out
    except BaseException:
        save(OPS/'actual-run-v9.unconfirmed.json',encoded({'format':FORMAT,'reviewHash':marker,'started':None,
             'automaticRetryAllowed':False,'manualOwnedUnitReconcileRequired':True,'unit':UNIT}))
        raise
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply');args=parser.parse_args()
    if os.getuid()!=0 or os.getgid()!=0 or socket.gethostname()!='yunipals-main':fail()
    trusted(HELPER,HELPER_SHA);trusted(PLAN,PLAN_SHA)
    info=PARENT.lstat()
    if not stat.S_ISDIR(info.st_mode)or info.st_uid!=964 or info.st_gid!=958 or stat.S_IMODE(info.st_mode)!=0o700:fail()
    fd=os.open('/run/lock/yunipals-arena-genuine-v9-rollout.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode)or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600:fail()
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        print(json.dumps(apply(args.apply)if args.apply else review(),sort_keys=True))
    finally:os.close(fd)
if __name__=='__main__':main()
