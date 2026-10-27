#!/usr/bin/env python3
"""Single official generation invocation with disk/backup overlap supervision.

The owner admits this only after actual source+metadata readiness. No retry,
source operation, timer modification, reserve relaxation or generation relabel.
"""
import hashlib,json,os,re,signal,stat,subprocess,time
from pathlib import Path

UNIT='yunipals-ypal-restored-generation-prepare-v1.service'
ROOT=Path('/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer')
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
WORK=Path('/run/yunipals-ypal-restored-generation-prepare-v1-20261024')
NODE='/opt/node-v24.18.1/bin/node'
APP='yunipals_ypal_restored_generation_prepare_20261024'
ARTIFACT=Path('/opt/yunipals-unified/nonmarket-consumer-releases/f81cdb76ae45794599c723085aebd2b9c5e377975dc16d2e1461236229d4b952')
BACKUPS=('yunipals-arena-backup','yunipals-market-production-base-backup','yunipal-islands-backup','yunipals-islands-backup')
ENV_FILES=(str(OPS/'consumer-generation-v4-inline.env'),'/etc/yunipals-indexer/indexer.env',
 '/etc/yunipals-marketplace/production/indexer-rpc.env','/etc/yunipals-metadata-cutover.env',
 '/opt/yunipals-ops/query-capacity.env',
 '/var/backups/yunipals-ypal-generation-cache-candidates-v1-20261024/yunipals-leaderboard.selectors.env',
 str(OPS/'consumer-generation-v4-capacity.env'),
 '/var/backups/yunipals-ypal-restored-generation-v1-20261024/generation.public.env')
CLEAN={'PATH':'/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
MIN_RESERVE=25_000_000_000
ABORT_FREE=30_000_000_000
MAX_SECONDS=1470
CANCEL_JS=r"""
import {createRequire}from'node:module';
const require=createRequire('/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer/package.json');
const {Client}=require('pg');let raw='';for await(const part of process.stdin)raw+=part;
const v=JSON.parse(raw),db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:3000});
try{await db.connect();
 const context=(await db.query("SELECT current_user AS role,current_database()AS database")).rows[0];
 if(context.role!=='yunipals'||context.database!=='yunipals_backfill')throw Error('fixed_worker_database_role_required');
 const sql=v.terminate?
 "SELECT pid,pg_terminate_backend(pid,2000)AS terminated FROM pg_stat_activity WHERE pid<>pg_backend_pid()AND application_name=$1 AND usename=current_user AND datname=current_database()AND extract(epoch FROM backend_start)>=$2":
 "SELECT pid,extract(epoch FROM backend_start)::text AS started FROM pg_stat_activity WHERE pid<>pg_backend_pid()AND application_name=$1 AND usename=current_user AND datname=current_database()";
 const params=v.terminate?[v.app,v.since]:[v.app];
 const rows=(await db.query(sql,params)).rows;console.log(JSON.stringify({context,rows}));
}catch(error){console.log(JSON.stringify({failed:true,code:/^[A-Z0-9]{5}$/.test(error.code??'')?error.code:'bounded_query_failed'}));process.exitCode=1;}
finally{await db.end().catch(()=>{});}
"""

def fail(code):raise RuntimeError(code)
def run(args,data=None,timeout=8):
 r=subprocess.run(args,input=data,capture_output=True,timeout=timeout,env=CLEAN,cwd=str(ROOT))
 if r.returncode or r.stderr or len(r.stdout)>100000:fail('bounded_private_command_failed')
 return r.stdout

def state():
 raw=run(['/usr/bin/systemctl','show',UNIT,'--property=Id,InvocationID,MainPID,ActiveState,SubState']).decode()
 result=dict(line.split('=',1)for line in raw.splitlines()if'='in line)
 if result.get('Id')!=UNIT or not re.fullmatch('[a-f0-9]{32}',result.get('InvocationID',''))or result.get('MainPID')!=str(os.getpid()):fail('owned_generation_invocation_required')
 return result

def identity(expected):
 now=state()
 if now['InvocationID']!=expected['InvocationID']or now['MainPID']!=expected['MainPID']:fail('generation_invocation_changed')
 return now

def node_args(app):
 return ['/usr/bin/env','-i',*[k+'='+v for k,v in CLEAN.items()],'PGAPPNAME='+app,NODE,
  *['--env-file='+path for path in ENV_FILES]]

def backend_query(terminate,since):
 args=node_args(APP+'_guard')+['--input-type=module','-e',CANCEL_JS]
 value=json.loads(run(args,json.dumps({'app':APP,'since':since,'terminate':terminate}).encode(),timeout=10))
 if value.get('failed'):fail('owned_backend_query_failed')
 return value

def no_overlap_window(seconds):
 earliest=None
 for name in BACKUPS:
  raw=run(['/usr/bin/systemctl','show',name+'.service','--property=ActiveState','--value']).decode().strip()
  if raw not in ('inactive','failed'):fail('data_backup_overlap_observed')
  obj='/org/freedesktop/systemd1/unit/'+''.join(c if c.isalnum()else'_'+format(ord(c),'02x')for c in name+'.timer')
  value=json.loads(run(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',obj,'org.freedesktop.systemd1.Timer','NextElapseUSecRealtime']))
  if value.get('type')!='t'or len(value.get('data',[]))!=1:fail('typed_backup_timer_required')
  stamp=value['data'][0]/1e6
  if stamp:earliest=stamp if earliest is None else min(earliest,stamp)
 for entry in Path('/proc').iterdir():
  if not entry.name.isdecimal():continue
  try:name=(entry/'comm').read_text().strip()
  except(OSError,UnicodeError):continue
  if name in ('pg_dump','pg_basebackup','pg_restore','restic','borg','rclone','gzip','pigz','rsync'):fail('backup_restore_process_overlap_observed')
 if earliest is not None and time.time()+seconds+30>=earliest:fail('full_one_shot_window_before_next_backup_required')
 return earliest

def available():
 fs=os.statvfs('/');return fs.f_bavail*fs.f_frsize

def write(name,value):
 with (WORK/name).open('xb')as f:
  os.fchmod(f.fileno(),0o600);f.write((json.dumps(value,sort_keys=True)+'\n').encode());f.flush();os.fsync(f.fileno())

def protected_inputs():
 result={}
 for path in ENV_FILES:
  p=Path(path)
  for part in [*reversed(p.parents),p]:
   s=part.lstat()
   if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or(s.st_mode&0o022 and not(stat.S_ISDIR(s.st_mode)and s.st_mode&stat.S_ISVTX)):fail('protected_generation_input_required')
  if not p.is_file()or p.stat().st_size>4000000:fail('bounded_generation_input_required')
  result[path]=hashlib.sha256(p.read_bytes()).hexdigest()
 return result

def stop_owned(expected,child,since):
 identity(expected)
 # Same login role may terminate its own sessions; no postgres/admin credential
 # or new pg_signal_backend grant is needed. The predicate cannot hit source or
 # legacy workers, whose app names differ. No PID-only cancellation is issued.
 cancelled=backend_query(True,since)
 if any(row.get('terminated')is not True for row in cancelled['rows']):fail('owned_backend_termination_not_confirmed')
 if child.poll()is None:
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=3)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=3)
 remaining=backend_query(False,since)
 if remaining['rows']:fail('owned_backend_sessions_remain')
 return {'terminatedBackends':cancelled['rows'],'remainingBackends':0,'noAdminGrantRequired':True}

def main():
 if os.geteuid()!=0:fail('owned_root_one_shot_required')
 s=WORK.lstat()
 if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or s.st_mode&0o077:fail('private_systemd_runtime_directory_required')
 expected=state();inputs=protected_inputs();next_backup=no_overlap_window(MAX_SECONDS)
 if available()<MIN_RESERVE+10_265_210_880:fail('measured_generation_and25GB_reserve_required')
 if backend_query(False,0)['rows']:fail('fresh_unique_generation_application_name_required')
 since=time.time();started=time.monotonic();minimum=available();child=None;abort=None;termination=None
 write('intent.json',{'unit':UNIT,'invocation':expected['InvocationID'],'mainPid':os.getpid(),'applicationName':APP,'workerRole':'yunipals','database':'yunipals_backfill','inputSha256':inputs,'startedUnix':since,'nextBackupUnix':next_backup,'minimumReserveBytes':MIN_RESERVE,'abortFreeBytes':ABORT_FREE,'maximumSeconds':MAX_SECONDS,'automaticRetry':False})
 def stop_signal(signum,frame):fail('owned_generation_stop_signal')
 signal.signal(signal.SIGTERM,stop_signal);signal.signal(signal.SIGINT,stop_signal)
 try:
  with (WORK/'child.stdout.private').open('xb')as out,(WORK/'child.stderr.private').open('xb')as err:
   os.chmod(WORK/'child.stdout.private',0o600);os.chmod(WORK/'child.stderr.private',0o600)
   command=[str(ARTIFACT/'dist/generation-prepare.mjs')]
   child=subprocess.Popen(node_args(APP)+command,stdout=out,stderr=err,env=CLEAN,cwd=str(ROOT),start_new_session=True)
   last_overlap=0
   while child.poll()is None:
    identity(expected);free=available();minimum=min(minimum,free)
    if free<ABORT_FREE:fail('root_disk_safety_threshold_reached')
    elapsed=time.monotonic()-started
    if elapsed>=MAX_SECONDS:fail('bounded_generation_duration_reached')
    if elapsed-last_overlap>=5:
     no_overlap_window(max(0,MAX_SECONDS-elapsed));last_overlap=elapsed
    time.sleep(1)
   if child.returncode:fail('official_generation_child_failed')
   if protected_inputs()!=inputs:fail('generation_private_inputs_changed')
   identity(expected)
 except BaseException as error:
  abort=str(error)if isinstance(error,RuntimeError)else type(error).__name__
  if child is not None:
   try:termination=stop_owned(expected,child,since-1)
   except BaseException as stopping:
    termination={'failed':type(stopping).__name__,'needsOwnedProcessAndDatabaseReconciliation':True}
    if child.poll()is None:os.killpg(child.pid,signal.SIGKILL)
  raise
 finally:
  write('result.json',{'childExit':child.poll()if child else None,'minimumAvailableBytes':minimum,'reserveBytes':MIN_RESERVE,'safetyAbortThresholdBytes':ABORT_FREE,'elapsedSeconds':round(time.monotonic()-started,3),'failure':abort,'ownedTermination':termination,'invocation':expected['InvocationID'],'automaticRetry':False,'generationPublicationMustBeVerifiedSeparately':True})

if __name__=='__main__':
 import sys
 if len(sys.argv)!=1:fail('generation_preparation_takes_no_arguments')
 main()
