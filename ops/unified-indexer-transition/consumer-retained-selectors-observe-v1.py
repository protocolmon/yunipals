#!/usr/bin/env python3
"""Fixed three current API process selectors only; no commands or configuration writes."""
import hashlib,json,os,re,subprocess,time
from pathlib import Path
UNITS=('yunipals-api.service','yunipals-collector-api.service','yunipals-islands-api.service')
FLAGS=('SOLANA_API_ENABLED','SOLANA_LEGACY_METADATA_ENABLED','API_ISLANDS_ENABLED','API_BASE_ISLANDS_ENABLED','API_ISLAND_STAKING_ENABLED','YUNIPALS_READ_CACHE','API_COLLECTOR_FILTERS_ENABLED')
KEYS=('Id','ActiveState','SubState','MainPID','InvocationID','EnvironmentFiles')
def sha(v):return hashlib.sha256(v).hexdigest()
def fail(code):raise RuntimeError(code)
def state(unit):
 p=subprocess.run(['/usr/bin/systemctl','show',unit,*['--property='+k for k in KEYS]],capture_output=True,timeout=5,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC'})
 if p.returncode or len(p.stdout)>100000:fail('bounded_fixed_unit_metadata_required')
 v={};files=[]
 for line in p.stdout.decode().splitlines():
  k,sep,x=line.partition('=')
  if not sep or k not in KEYS:fail('fixed_unit_properties_required')
  if k=='EnvironmentFiles':files.append(x)
  elif k in v:fail('duplicate_unit_property')
  else:v[k]=x
 if set(v)!=set(KEYS)-{'EnvironmentFiles'}or v['Id']!=unit or v['ActiveState']!='active'or v['SubState']!='running'or not re.fullmatch('[1-9][0-9]*',v['MainPID'])or not re.fullmatch('[0-9a-f]{32}',v['InvocationID']):fail('actual_running_retained_API_required')
 v['orderedEnvironmentFileSelectors']=files;return v

def identity(pid):
 raw=Path('/proc/'+pid+'/stat').read_bytes()
 if len(raw)>20000:fail('bounded_process_identity_required')
 parts=raw[raw.rfind(b')')+2:].split()
 return {'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'pid':int(pid),'startTicks':int(parts[19])}
def observe(unit):
 before=state(unit);pid=before['MainPID'];process=identity(pid);path=Path('/proc')/pid/'environ'
 with path.open('rb')as f:raw=f.read(2000001)
 if len(raw)>2000000:fail('bounded_actual_process_environment_required')
 values={}
 for entry in raw.split(b'\0'):
  if b'='not in entry:continue
  key,value=entry.split(b'=',1)
  if key in {k.encode()for k in [*FLAGS,'BOOSTER_DATABASE_SCHEMA','BOOSTER_ARTWORK_DIRECTORY','BOOSTER_REGISTRY','BOOSTER_ENGINE','BOOSTER_MONSTERS','BOOSTER_WRAPPER']}:
   k=key.decode()
   if k in values:fail('duplicate_retained_selector')
   values[k]=value.decode('utf-8')
 flags={k:values.get(k)for k in FLAGS}
 if any(v is not None and v not in {'true','false','1','0',''}for v in flags.values()):fail('fixed_boolean_selector_value_required')
 schema=values.get('BOOSTER_DATABASE_SCHEMA')or None
 if schema is not None and not re.fullmatch('[a-z_][a-z0-9_]{0,62}',schema):fail('fixed_public_booster_schema_identifier_required')
 artwork=values.get('BOOSTER_ARTWORK_DIRECTORY');contracts={k:bool(values.get(k))for k in ['BOOSTER_REGISTRY','BOOSTER_ENGINE','BOOSTER_MONSTERS','BOOSTER_WRAPPER']}
 if any(contracts.values())and not all(contracts.values()):fail('partial_booster_deployment_requires_review')
 if state(unit)!=before or identity(pid)!=process:fail('retained_process_changed_during_selector_read')
 return {'unit':unit,'invocationId':before['InvocationID'],'process':process,'orderedEnvironmentFileSelectors':before['orderedEnvironmentFileSelectors'],'flags':flags,'boosterDatabaseSchema':schema,'boosterDeploymentConfigured':all(contracts.values()),'boosterArtworkDirectoryPresent':bool(artwork),'boosterArtworkDirectorySha256':sha(artwork.encode())if artwork else None,'actualProcessEnvironmentCompared':True,'nonAllowlistedEnvironmentExported':False}
if __name__=='__main__':
 if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('root_on_exact_main_required')
 started=time.monotonic();rows=[observe(u)for u in UNITS]
 print(json.dumps({'format':'yunipals-consumer-retained-selectors-v1','completed':True,'services':rows,'elapsedSeconds':round(time.monotonic()-started,3),'configurationChanged':False,'applicationCodeExecuted':False,'secretValuesExported':False},sort_keys=True))
