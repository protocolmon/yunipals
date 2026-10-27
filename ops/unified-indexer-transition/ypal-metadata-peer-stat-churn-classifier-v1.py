#!/usr/bin/env python3
"""Classify one authenticated disappearing metadata peer; retain original caps."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import time
import types

FORMAT='yunipals-metadata-peer-stat-churn-classifier-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-metadata-peer-stat-churn-classifier-v1.py'
MANIFEST=FILE.with_suffix('.manifest.json')
DIAGNOSTIC='ypal-ordinary-metadata-capture-diagnostic-v1.py'
EPOCH='ypal-ordinary-metadata-current-epoch-v3.py'
INVENTORY='ypal-old-runtime-inventory-v1.py'
PINS={DIAGNOSTIC:'2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465',
 EPOCH:'33ae8619fe0a43b94745b1a00ae57db166592c83ccf6a997d50cd8c583fdff51',
 INVENTORY:'7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b'}
SCRIPT_SHA='fc771208678d07b7e76b1a7407439b553f1f1fb031272ad58d2391c51707be28'
RETRY_CODE='metadata_backend_churn_retry_readonly_observation_only'
CAPTURE_FORMATS={'yunipals-ypal-ordinary-metadata-current-epoch-v3','yunipals-ypal-ordinary-metadata-current-observation-v1','yunipals-ypal-ordinary-metadata-current-policy-v1'}


def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def public(path,digest=None):
 path=Path(path)
 for item in[*path.parents,path]:
  row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_metadata_classifier_source_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=1000000 and
  all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'exact_metadata_classifier_source_required')
 return raw

def authenticate():
 files={FILE.name:sha(public(FILE)),**PINS};expected={'format':FORMAT+'-source','files':files}
 need(json.loads(public(MANIFEST))==expected,'complete_owned_metadata_classifier_manifest_required')
 for name,digest in files.items():public(OPS/name,digest)
 return{'format':FORMAT,'operatorSha256':files[FILE.name],'manifestSha256':sha(public(MANIFEST)),
  'diagnosticSourceSha256':PINS[DIAGNOSTIC],'epochCaptureSourceSha256':PINS[EPOCH],
  'inventorySourceSha256':PINS[INVENTORY],'publicPeerScriptSha256':SCRIPT_SHA,
  'maximumReadCaptureAttempts':3,'captureWindowNanoseconds':90_000_000_000,
  'onlyExistingCompleteReadCaptureRetryUsed':True,'originalInventoryPredicatesChanged':False,
  'partialObservationReused':False,'effectsRetried':False,'newRetryLoopInstalled':False,
  'approvalClockReset':False,'wholeSourceQualified':False}

def load(name):
 value=types.ModuleType('authenticated_classifier_'+name.replace('-','_'));value.__file__=str(OPS/name)
 exec(compile(public(OPS/name,PINS[name]),str(OPS/name),'exec',dont_inherit=True),value.__dict__);return value

def shape(code):
 return(code.co_code,code.co_names,code.co_varnames,code.co_argcount,code.co_posonlyargcount,code.co_kwonlyargcount,
  code.co_flags,code.co_exceptiontable,code.co_freevars,code.co_cellvars,code.co_firstlineno,
  tuple(shape(value)if isinstance(value,types.CodeType)else value for value in code.co_consts))


class SubprocessDiagnostics:
 """Frozen2e40 pass-through plus one complete-capture-only classification."""
 def __init__(self,original,save):
  self._binding=authenticate();self._diagnostic=load(DIAGNOSTIC);self._epoch=load(EPOCH);self._inventory=load(INVENTORY)
  need(self._diagnostic.PEER_FDS_SCRIPT_SHA==SCRIPT_SHA and sha(self._inventory.PEER_FDS.encode())==SCRIPT_SHA and
   self._epoch.RETRY_CODE==RETRY_CODE and type(self._epoch.MAXIMUM_ATTEMPTS)is int and self._epoch.MAXIMUM_ATTEMPTS==3 and
   type(self._epoch.CAPTURE_WINDOW_NS)is int and self._epoch.CAPTURE_WINDOW_NS==90_000_000_000,
   'actual_existing_peer_and_three_attempt_ninety_second_capture_required')
  self.original=original;self._base=self._diagnostic.SubprocessDiagnostics(original,save)
  self._shapes={name:shape(fn.__code__)for name,fn in{'capture':self._epoch.capture_current,
   'run':self._inventory.run,'peer':self._inventory.peer_fds,'need':self._inventory.need}.items()}
  tree=ast.parse(self._inventory.PEER_FDS);identity=next(node for node in ast.walk(tree)if isinstance(node,ast.FunctionDef)and node.name=='identity')
  self._identity_line=next(node.lineno for node in ast.walk(identity)if isinstance(node,ast.Call)and isinstance(node.func,ast.Attribute)and node.func.attr=='read_text')
  self._call_lines={node.lineno for node in ast.walk(tree)if isinstance(node,ast.Call)and isinstance(node.func,ast.Name)and node.func.id=='identity'}
  need(len(self._call_lines)==2,'two_exact_public_stat_bookends_required')
  self.classified=0;self.unclassifiedPublicPeerFailures=0;self._events=[];self._counters_complete=True
 @property
 def calls(self):return self._base.calls
 @property
 def failures(self):return self._base.failures
 @property
 def raw_failures(self):return self._base.raw_failures
 def binding(self):
  need(authenticate()==self._binding,'same_loaded_classifier_source_and_manifest_required');return copy.deepcopy(self._binding)
 def snapshot(self):
  return{**self.binding(),'classifiedStatDisappearances':self.classified if self._counters_complete else None,
   'unclassifiedPublicPeerFailures':self.unclassifiedPublicPeerFailures if self._counters_complete else None,
   'countersComplete':self._counters_complete,'events':copy.deepcopy(self._events),
   'subprocessCalls':len(self.calls),'failedCommands':len(self.failures)}
 def _error_pid(self,err,pids):
  if not isinstance(err,bytes)or not 0<len(err)<=16000:return None
  try:text=err.decode('utf-8')
  except UnicodeError:return None
  match=re.fullmatch(r"Traceback \(most recent call last\):\n(?P<body>.+)FileNotFoundError: \[Errno 2\] No such file or directory: '/proc/(?P<pid>[1-9][0-9]*)/stat'\n",text,re.S)
  if match is None or int(match['pid'])not in pids:return None
  frames=[]
  for line in match['body'].splitlines():
   row=re.fullmatch(r'  File "([^"\n]+)", line ([1-9][0-9]*), in ([a-zA-Z_<>][a-zA-Z_0-9<>]*)',line)
   if row is not None:frames.append((row[1],int(row[2]),row[3]))
   elif not line.startswith('    '):return None
  script=[row for row in frames if row[0]=='<string>']
  if len(script)!=2 or script[0][1]not in self._call_lines or script[0][2]!='<module>'or script[1]!=( '<string>',self._identity_line,'identity'):return None
  if frames[:2]!=script or not 2<=len(frames)<=4:return None
  if any(not re.fullmatch(r'/usr/lib/python3\.[0-9]+/pathlib.py',row[0])or row[2]not in{'read_text','open'}for row in frames[2:]):return None
  return int(match['pid'])
 def _context(self,argv,kwargs):
  frame=sys._getframe(1);run=peer=capture=None
  try:
   while frame is not None:
    code=frame.f_code
    if code.co_filename==str(OPS/INVENTORY):
     if run is None and shape(code)==self._shapes['run']:run=frame
     elif peer is None and shape(code)==self._shapes['peer']:peer=frame
    if code.co_filename==str(OPS/EPOCH)and shape(code)==self._shapes['capture']:
     capture=frame;break
    frame=frame.f_back
   if run is None or peer is None or capture is None or run.f_globals is not peer.f_globals:return None
   g=run.f_globals;r=run.f_locals;p=peer.f_locals;c=capture.f_locals;e=capture.f_globals
   if type(g.get('need'))is not types.FunctionType or shape(g['need'].__code__)!=self._shapes['need']or g.get('PEER_FDS')!=self._inventory.PEER_FDS:return None
   if r.get('argv')is not argv or r.get('timeout')!=8 or p.get('uid')!=111 or p.get('gid')!=113 or p.get('pids')!=json.loads(argv[12]):return None
   if kwargs!={'capture_output':True,'timeout':8,'env':g.get('CLEAN')}or g.get('CLEAN')!=self._inventory.CLEAN:return None
   if e.get('RETRY_CODE')!=RETRY_CODE or type(e.get('MAXIMUM_ATTEMPTS'))is not int or e['MAXIMUM_ATTEMPTS']!=3 or type(e.get('CAPTURE_WINDOW_NS'))is not int or e['CAPTURE_WINDOW_NS']!=90_000_000_000:return None
   if e.get('FORMAT')not in CAPTURE_FORMATS:return None
   attempt=c.get('attempt');started=c.get('started');attempt_started=c.get('attempt_started');attempts=c.get('attempts');record=c.get('capture');epoch=c.get('epoch')
   if not all(type(value)is int for value in[attempt,started,attempt_started])or not 1<=attempt<=3 or not started<=attempt_started:return None
   elapsed=time.monotonic_ns()-started
   if not 0<=elapsed<90_000_000_000 or type(attempts)is not list or len(attempts)!=attempt-1:return None
   if type(record)is not dict or record.get('format')!=e['FORMAT']+'-capture'or record.get('startedMonotonicNanoseconds')!=started or record.get('effectsRetried')is not False or record.get('approvalLifetimeReset')is not False:return None
   if epoch is None or type(getattr(epoch,'inverse',None))is not bool or record.get('inverse')is not epoch.inverse or getattr(epoch,'ack',None)!=c.get('expected_ack'):return None
   if list(record.get('attempts',()))!=attempts or any(row.get('discarded')is not True or row.get('partialObservationReused')is not False for row in attempts):return None
   return{'attempt':attempt,'captureFormat':record['format'],'captureElapsedNanoseconds':elapsed,'captureWindowNanoseconds':90_000_000_000}
  finally:frame=run=peer=capture=None
 def __call__(self,*args,**kwargs):
  before_raw=self.raw_failures;before_failures=len(self.failures)
  result=self._base(*args,**kwargs) # Original command once; private evidence saved first.
  argv=args[0]if args else kwargs.get('args')
  if not self._diagnostic.public_fd_peer(argv)or result.returncode==0 and not result.stderr:return result
  eligible=(len(args)==1 and set(kwargs)=={'capture_output','timeout','env'}and argv[1:3]==['--reuid=111','--regid=113']and
   type(result.returncode)is int and result.returncode==1 and result.stdout==b''and isinstance(result.stderr,bytes)and
   self.raw_failures==before_raw+1 and len(self.failures)==before_failures+1)
  context=None
  if eligible:
   pids=json.loads(argv[12]);pid=self._error_pid(result.stderr,pids)
   if pid is not None:context=self._context(argv,kwargs)
  if context is None:
   try:self.unclassifiedPublicPeerFailures+=1
   except MemoryError:self._counters_complete=False
   return result
  self.binding()
  event={**context,'privateEvidenceSha256':self.failures[-1]['privateEvidenceSha256'],
   'stderrSha256':sha(result.stderr),'requestedPIDCount':len(pids),'discardWholeObservation':True,
   'partialProofReused':False,'effectsRetried':False,'approvalClockReset':False}
  try:self._events.append(event);self.classified+=1
  except MemoryError:self._counters_complete=False;return result
  raise RuntimeError(RETRY_CODE)from None


if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'newRetryLoopInstalled':False}))
