#!/usr/bin/env python3
"""Fixed read-only service-ID comparison against sealed long2, never rebaseline."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess

FORMAT='yunipals-paid-prepromotion-legacy-inventory-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
LONG2=Path('/var/lib/yunipals-unified-shadow/source5-resumes/20261020-008028af-long2')
STOP=OPS/'long2-source6-stop-proof.json'
STOP_SHA='c66daad4030bf2ce3384dec36079590efe2bebe45179bac83f078736eae8f514'
MONITOR_SHA='f45833bd65464b4e0a4dfd50a1226c4645b8720f9942cad8446cb8cd0c87f52e'
REVIEW_HASH='54e4b170af9e688ddc77757fe0a241bd783ce7afa508774be09bcd319c00ff8e'
SOURCE6='6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6'
PROOFS=Path('/var/backups/yunipals-unified-source6-free-first-20261021')
SOURCE6_PEERS={
 'ethereum':{'review':'c9f3ed8fab17a4b8c1f7c80024a98dc93712d8335cdecf8342101fd82ac59333','result':'95b2026e4bdb363927b38ce4a5ace5eda6cfc715ecb79a986e9e207c7b6519a2','before':'bfd7fbf9c4e24532a6b4bd79eff51d24','after':'a13a8ebf01f741948423746437ca7db3'},
 'polygon':{'review':'cb2df966efe0c3a29613daa97f46959d2e88e623a12e92784ee8e04f99ec4a78','result':'30d4b596d1d29c1007aa51866f0bca0a9c4ab1351c5db1c9ec34959f5151d2fb','before':'69d021597c484e8f8bb28df81121b131','after':'89114c59b89045458063020a1f19cc4b'}}
UNITS=tuple('yunipals-'+name+'.service'for name in [
 'indexer','bnb','solana','islands-indexer','base-islands-v2','metadata','read-cache','islands-metadata','api','collector-api','islands-api','exomon-preview-api','leaderboard',
 'market-production-api','market-production-bnb','market-production-read@base','market-production-read@ethereum','market-production-read@polygon',
 'market-production-rpc@base','market-production-rpc@bnb','market-production-rpc@ethereum','market-production-rpc@polygon','market-production-signature','market-production-stream',
 'arena-api','arena-capacity','arena-control','arena-lobby','arena-media','arena-projector','arena-referee','arena-settlement'])
OWNED={'yunipals-market-production-rpc@base.service','yunipals-market-production-rpc@bnb.service'}
KEYS={'Id','LoadState','ActiveState','SubState','InvocationID'}
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}

def fail(label):raise RuntimeError(label)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def protected(path,maximum):
 path=Path(path)
 if not path.is_absolute()or'..'in path.parts:fail('fixed_absolute_protected_input_required')
 for item in [*path.parents,path]:
  s=item.lstat()
  if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_root_input_required')
 before=path.stat()
 if not stat.S_ISREG(before.st_mode)or before.st_size>maximum:fail('bounded_regular_proof_required')
 raw=path.read_bytes();after=path.stat()
 if(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):fail('input_changed_during_read')
 return raw

def exact_states(value):
 if not isinstance(value,dict)or set(value)!=set(UNITS):fail('exact_32_service_graph_required')
 for name,row in value.items():
  if(not isinstance(row,dict)or set(row)!=KEYS or row['Id']!=name or any(not isinstance(v,str)for v in row.values())or
   row['InvocationID']!=''and not re.fullmatch('[0-9a-f]{32}',row['InvocationID'])):fail('exact_public_service_tuple_required')
 return value

def project(baseline,proofs):
 expected=json.loads(encoded(exact_states(baseline)))
 for name,pin in SOURCE6_PEERS.items():
  review,result=proofs[name];unit='yunipals-market-production-rpc@'+name+'.service'
  if(sha(encoded(review))!=pin['review']or result.get('review')!=review or result.get('reviewHash')!=pin['review']or result.get('applied')is not True or
   any(result.get(k)is not True for k in ['verifyExecStart','legacyHealthPassed','legacyConfigurationPreserved'])or
   result.get('sourceStarted')is not False or result.get('profileOrCapsChanged')is not False or result.get('sourceRouting')!='free_first'or result.get('paidCalls')!=0 or
   review.get('stopProofSha256')!=STOP_SHA or result.get('sourceDigest')!=SOURCE6 or result.get('unit')!=unit or
   review.get('unit')!=unit or review.get('beforeInvocationId')!=pin['before']or result.get('beforeInvocationId')!=pin['before']or
   baseline[unit]['InvocationID']!=pin['before']or result.get('afterInvocationId')!=pin['after']):fail('exact_accepted_source6_peer_transition_required')
  expected[unit]['InvocationID']=pin['after']
 return expected

def compare(expected,current):
 exact_states(expected);exact_states(current);names=set(UNITS)-OWNED
 differences=[{'unit':name,'before':expected[name],'after':current[name]}for name in sorted(names)if expected[name]!=current[name]]
 return{'format':FORMAT,'stopProofSha256':STOP_SHA,'monitorSha256':MONITOR_SHA,'comparedServiceCount':30,'comparedNonProxyCount':28,
  'expectedThirtySha256':sha(encoded({n:expected[n]for n in sorted(names)})),'currentThirtySha256':sha(encoded({n:current[n]for n in sorted(names)})),
  'unchangedThirty':not differences,'differences':differences,'baseBnbControlledSeparately':True,'baselineAdoptedFromCurrent':False,
  'promotionAuthorized':False,'providerCalls':0,'databaseCalls':0,'serviceJobs':0,'privateSettingsRead':False}

def capture(command=subprocess.run):
 stop_raw=protected(STOP,100000)
 if sha(stop_raw)!=STOP_SHA:fail('exact_completed_long2_stop_proof_required')
 stop=json.loads(stop_raw);raw=protected(LONG2/'monitor.jsonl',40000000)
 if sha(raw)!=MONITOR_SHA or stop.get('monitorSha256')!=MONITOR_SHA:fail('exact_sealed_completed_monitor_required')
 review_raw=protected(LONG2/'review.json',2000000)
 if sha(review_raw)!=stop.get('reviewSha256'):fail('exact_saved_long2_review_required')
 review=json.loads(review_raw);rows=[json.loads(line)for line in raw.splitlines()]
 if not 3<=len(rows)<=10000:fail('bounded_completed_long2_monitor_required')
 first,last=rows[0],rows[-1]
 if(review.get('reviewHash')!=REVIEW_HASH or sha(encoded(review.get('binding')))!=REVIEW_HASH or first.get('source5ResumeBinding')!=review['binding']or
  first.get('reviewHash')!=REVIEW_HASH or last.get('event')!='stopped'or last.get('reason')!='operator_interrupt'or last.get('quarantined')is not True or
  last.get('stopError')is not None or last.get('automaticRetryAllowed')is not False or last.get('after',{}).get('activeSelector')!=[]):fail('actual_sealed_original_legacy_graph_required')
 baseline=exact_states(last['after']['legacyUnits']);proofs={}
 for name,pin in SOURCE6_PEERS.items():
  directory=PROOFS/name/pin['review'];a=protected(directory/'review.json',500000);b=protected(directory/'result.json',750000)
  if sha(a)!=pin['review']or sha(b)!=pin['result']:fail('exact_accepted_source6_peer_proof_bytes_required')
  proofs[name]=(json.loads(a),json.loads(b))
 expected=project(baseline,proofs)
 result=command(['/usr/bin/systemctl','show',*UNITS,'--property=Id,LoadState,ActiveState,SubState,InvocationID'],env=ENV,capture_output=True,timeout=5)
 if result.returncode not in {0,1}or not isinstance(result.stdout,bytes)or len(result.stdout)>100000:fail('bounded_service_ID_observation_required')
 current={}
 for block in result.stdout.decode().strip().split('\n\n'):
  row={}
  for line in block.splitlines():
   key,sep,item=line.partition('=')
   if not sep or key not in KEYS or key in row:fail('unique_service_ID_properties_required')
   row[key]=item
  if row.get('Id')in current:fail('duplicate_service_ID_block_refused')
  current[row.get('Id')]=row
 return compare(expected,current)

def main():
 if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('exact_root_host_readonly_review_required')
 def expired(*_):fail('bounded_inventory_deadline')
 signal.signal(signal.SIGALRM,expired);signal.alarm(30)
 try:result=capture()
 finally:signal.alarm(0)
 print(json.dumps(result,sort_keys=True))
if __name__=='__main__':
 try:main()
 except Exception as error:print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(error).__name__,'promotionAuthorized':False}));raise SystemExit(1)
