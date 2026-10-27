#!/usr/bin/env python3
"""Single official generation invocation with disk/backup overlap supervision.

The owner admits this only after actual source+metadata readiness. No retry,
source operation, timer modification, reserve relaxation or generation relabel.
"""
import hashlib,json,os,re,signal,stat,subprocess,time
from pathlib import Path

UNIT='yunipals-ypal-ordinary-generation-attempt-v1.service'
ROOT=Path('/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer')
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
WORK=Path('/run/yunipals-ypal-ordinary-generation-attempt-v1-20261025')
NODE='/opt/node-v24.18.1/bin/node'
APP='yunipals_ypal_ordinary_generation_attempt_v1_20261025'
ARTIFACT=Path('/opt/yunipals-unified/nonmarket-consumer-releases/a39b937dbe2278478ccbecb16af362707e9b8160092488c15e513a28e5a2878a')
BACKUPS=('yunipals-arena-backup','yunipals-market-production-base-backup','yunipal-islands-backup','yunipals-islands-backup')
ENV_FILES=(str(OPS/'consumer-generation-v4-inline.env'),'/etc/yunipals-indexer/indexer.env',
 '/etc/yunipals-marketplace/production/indexer-rpc.env','/etc/yunipals-metadata-cutover.env',
 '/opt/yunipals-ops/query-capacity.env',
 '/var/backups/yunipals-ypal-ordinary-generation-candidates-v5-20261025/yunipals-leaderboard.selectors.env',
 str(OPS/'consumer-generation-v4-capacity.env'),
 '/var/backups/yunipals-ypal-ordinary-generation-attempt-v1-20261025/generation.public.env')
CLEAN={'PATH':'/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
MIN_RESERVE=25_000_000_000
ABORT_FREE=30_000_000_000
MIN_SECONDS=1470
MAX_SECONDS=2400
INPUT=Path('/var/backups/yunipals-ypal-ordinary-generation-attempt-input-v1-20261025/input.json')
INPUT_FORMAT='yunipals-ypal-ordinary-generation-attempt-v1-input'
FORMAT='yunipals-ypal-ordinary-generation-attempt-watch-v1'
TELEMETRY_JS=r"""
import{createRequire}from'node:module';const require=createRequire(process.cwd()+'/package.json'),{Client}=require('pg');
let raw='';for await(const part of process.stdin)raw+=part;const v=JSON.parse(raw);
const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:3000});
try{await db.connect();const who=(await db.query('SELECT current_user AS role,current_database()AS database')).rows[0];
if(who.role!=='yunipals'||who.database!=='yunipals_backfill')throw Error('fixed_worker_context_required');
const rows=(await db.query(`SELECT pid,extract(epoch FROM backend_start)::text AS "backendStartedUnix",
 encode(sha256(convert_to(query,'UTF8')),'hex')AS "querySha256",octet_length(query)AS "queryBytes",
 extract(epoch FROM query_start)::text AS "queryStartedUnix",state,wait_event_type AS "waitEventType",wait_event AS "waitEvent"
 FROM pg_stat_activity WHERE pid<>pg_backend_pid()AND application_name=$1 AND usename=current_user
 AND datname=current_database()AND extract(epoch FROM backend_start)>=$2 ORDER BY pid LIMIT 5`,[v.app,v.since])).rows;
if(rows.length>4)throw Error('worker_pool_limit_exceeded');console.log(JSON.stringify({rows}));
}finally{await db.end();}
"""
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
def configuration(input_sha):
 if not isinstance(input_sha,str)or not re.fullmatch('[a-f0-9]{64}',input_sha):fail('actual_new_attempt_input_SHA_required')
 for path in [*INPUT.parents,INPUT]:
  st=path.lstat()
  if st.st_uid!=0 or stat.S_ISLNK(st.st_mode)or st.st_mode&0o022:fail('protected_attempt_input_required')
 before=INPUT.stat();raw=INPUT.read_bytes();after=INPUT.stat()
 if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or len(raw)>100000 or hashlib.sha256(raw).hexdigest()!=input_sha or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):fail('exact_attempt_input_required')
 value=json.loads(raw);maximum=value.get('maximumSeconds')
 if value.get('format')!=INPUT_FORMAT or type(maximum)is not int or not MIN_SECONDS<=maximum<=MAX_SECONDS:fail('bounded_actual_new_attempt_duration_required')
 return value

def capture_telemetry(sequence,since):
 if type(sequence)is not int or not 0<=sequence<=241:fail('bounded_private_telemetry_sample_count_required')
 value=json.loads(run(node_args(APP+'_telemetry')+['--input-type=module','-e',TELEMETRY_JS],
  json.dumps({'app':APP,'since':since}).encode(),timeout=10))
 rows=value.get('rows')
 if type(rows)is not list or len(rows)>4:fail('bounded_owned_statement_telemetry_required')
 keys={'pid','backendStartedUnix','querySha256','queryBytes','queryStartedUnix','state','waitEventType','waitEvent'}
 for row in rows:
  if type(row)is not dict or set(row)!=keys or type(row['pid'])is not int or row['pid']<=1 or not re.fullmatch('[a-f0-9]{64}',row['querySha256']or'')or type(row['queryBytes'])is not int or row['queryBytes']<0:fail('hashed_owned_statement_telemetry_only_required')
  if not all(row[key]is None or isinstance(row[key],str)and len(row[key])<=100 for key in ['backendStartedUnix','queryStartedUnix','state','waitEventType','waitEvent']):fail('bounded_system_statement_wait_values_required')
 write('statement-'+str(sequence).zfill(4)+'.json',{'format':FORMAT+'-statement','applicationName':APP,'observedUnix':time.time(),'rows':rows,'rawSqlExported':False})
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
  data=value.get('data');data=data[0]if type(data)is list and len(data)==1 else data
  if value.get('type')!='t'or type(data)is not int or data<0:fail('typed_backup_timer_required')
  stamp=data/1e6
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

def child_process_record(child,command):
 raw=(Path('/proc')/str(child.pid)/'stat').read_text();ticks=int(raw[raw.rfind(')')+2:].split()[19])
 if os.getpgid(child.pid)!=child.pid or ticks<=0:fail('owned_new_child_process_group_and_epoch_required')
 write('child-process.json',{'pid':child.pid,'startTicks':ticks,'processGroup':child.pid,
  'commandSha256':hashlib.sha256((json.dumps(command,sort_keys=True,separators=(',',':'))+'\n').encode()).hexdigest(),
  'artifactDigest':ARTIFACT.name})

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

def execute(input_sha):
 if os.geteuid()!=0:fail('owned_root_one_shot_required')
 s=WORK.lstat()
 if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or s.st_mode&0o077:fail('private_systemd_runtime_directory_required')
 config=configuration(input_sha);maximum=config['maximumSeconds']
 expected=state();inputs=protected_inputs();next_backup=no_overlap_window(maximum)
 if available()<MIN_RESERVE+10_265_210_880:fail('measured_generation_and25GB_reserve_required')
 if backend_query(False,0)['rows']:fail('fresh_unique_generation_application_name_required')
 since=time.time();started=time.monotonic();minimum=available();child=None;abort=None;termination=None
 write('intent.json',{'unit':UNIT,'invocation':expected['InvocationID'],'mainPid':os.getpid(),'applicationName':APP,'workerRole':'yunipals','database':'yunipals_backfill','inputSha256':inputs,'startedUnix':since,'nextBackupUnix':next_backup,'minimumReserveBytes':MIN_RESERVE,'abortFreeBytes':ABORT_FREE,'maximumSeconds':maximum,'inputSha256Ref':input_sha,'artifactDigest':ARTIFACT.name,'automaticRetry':False})
 def stop_signal(signum,frame):fail('owned_generation_stop_signal')
 signal.signal(signal.SIGTERM,stop_signal);signal.signal(signal.SIGINT,stop_signal)
 try:
  with (WORK/'child.stdout.private').open('xb')as out,(WORK/'child.stderr.private').open('xb')as err:
   os.chmod(WORK/'child.stdout.private',0o600);os.chmod(WORK/'child.stderr.private',0o600)
   command=[str(ARTIFACT/'dist/generation-prepare.mjs')]
   command=node_args(APP)+command
   child=subprocess.Popen(command,stdout=out,stderr=err,env=CLEAN,cwd=str(ROOT),start_new_session=True)
   child_process_record(child,command)
   last_overlap=0;last_telemetry=-10;telemetry_count=0
   while child.poll()is None:
    identity(expected);free=available();minimum=min(minimum,free)
    if free<ABORT_FREE:fail('root_disk_safety_threshold_reached')
    elapsed=time.monotonic()-started
    if elapsed>=maximum:fail('bounded_generation_duration_reached')
    if elapsed-last_overlap>=5:
     no_overlap_window(max(0,maximum-elapsed));last_overlap=elapsed
    if elapsed-last_telemetry>=10:
     capture_telemetry(telemetry_count,since-1);telemetry_count+=1;last_telemetry=elapsed
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
  write('result.json',{'childExit':child.poll()if child else None,'minimumAvailableBytes':minimum,'reserveBytes':MIN_RESERVE,'safetyAbortThresholdBytes':ABORT_FREE,'elapsedSeconds':round(time.monotonic()-started,3),'failure':abort,'ownedTermination':termination,'invocation':expected['InvocationID'],'automaticRetry':False,'generationPublicationMustBeVerifiedSeparately':True,'inputSha256':input_sha,'artifactDigest':ARTIFACT.name})

def main():
 import argparse
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');parser.add_argument('--input-sha');args=parser.parse_args()
 if not args.run:
  if args.input_sha is not None:fail('explicit_owned_monitor_run_required')
  print(json.dumps({'format':FORMAT,'staticOnly':True,'generationStarted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
 if __import__('socket').gethostname()!='yunipals-main':fail('fixed_generation_monitor_host_required')
 execute(args.input_sha)

if __name__=='__main__':main()
