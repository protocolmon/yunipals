#!/usr/bin/env python3
"""Bounded full metadata read captures over the immutable Owner3 proof."""
import ast
import copy
import time
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-metadata-current-epoch-v3.py'
FORMAT='yunipals-ypal-ordinary-metadata-current-epoch-v3'
FROZEN=OPS/'ypal-ordinary-metadata-current-epoch-v2.py'
FROZEN_SHA='3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
SOURCE_PINS={'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-metadata-handover-v5.py': '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f', 'ypal-ordinary-consumer-handover-v5.py': 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-ordinary-metadata-current-epoch-v2.py': '3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b'}
SOURCE_MANIFEST=OPS/'ypal-ordinary-metadata-current-epoch-v3.manifest.json'
OWNER='ypal-native-metadata-approval-epoch-v3.py'
OWNER_MANIFEST='ypal-native-metadata-approval-epoch-v3.manifest.json'
OWNER_FORMAT='yunipals-native-metadata-approval-epoch-v3'
UTILITY=OPS/'ypal-ordinary-cache-continuation-context-v1.py'
UTILITY_SHA='f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449' 
_implementation=None


def public(path,expected=None,maximum=4000000):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_continuation3_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<=maximum or \
        any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])or \
        (expected is not None and hashlib.sha256(raw).hexdigest()!=expected):raise RuntimeError('same_actual_continuation3_source_required')
    return raw


def factory():
    raw=public(FACTORY,FACTORY_SHA);value=types.ModuleType('continuation3_factory');value.__file__=str(FACTORY)
    exec(compile(raw,str(FACTORY),'exec'),value.__dict__);return value


def utility():
    raw=public(UTILITY,UTILITY_SHA);value=types.ModuleType('metadata_epoch2_utility');value.__file__=str(UTILITY)
    exec(compile(raw,str(UTILITY),'exec'),value.__dict__);return value


RETRY_CODE='metadata_backend_churn_retry_readonly_observation_only'
MAXIMUM_ATTEMPTS=3
CAPTURE_WINDOW_NS=90_000_000_000


def capture_current(epoch,original):
    """Repeat only complete read captures; never reuse a partial actor proof."""
    started=time.monotonic_ns();expected_ack=copy.deepcopy(epoch.ack);expected_binding=copy.deepcopy(epoch.binding())
    attempts=[];history=list(getattr(epoch,'current_capture_history',()))
    capture={'format':FORMAT+'-capture','inverse':epoch.inverse,'startedMonotonicNanoseconds':started,
        'attempts':(), 'effectsRetried':False,'approvalLifetimeReset':False}
    history.append(capture)
    def retain():
        capture['attempts']=tuple(copy.deepcopy(attempts))
        epoch.current_capture_attempts=tuple(copy.deepcopy(attempts))
        epoch.current_capture_history=tuple(copy.deepcopy(history))
    def window():
        if not 0<=time.monotonic_ns()-started<CAPTURE_WINDOW_NS:raise RuntimeError('bounded_metadata_current_capture_window_expired')
    def unchanged():
        if epoch.ack!=expected_ack or epoch.binding()!=expected_binding:raise RuntimeError('metadata_current_capture_immutable_ACK_or_epoch_changed')
    retain()
    try:
        for attempt in range(1,MAXIMUM_ATTEMPTS+1):
            window();unchanged();attempt_started=time.monotonic_ns()
            try:value=original(epoch)
            except BaseException as error:
                classified=type(error)is RuntimeError and str(error)==RETRY_CODE
                attempts.append({'attempt':attempt,'completed':False,'discarded':True,'classifiedMetadataBackendChurn':classified,
                    'errorClass':type(error).__name__,'fixedCode':RETRY_CODE if classified else'nonretryable_metadata_current_refusal',
                    'elapsedNanoseconds':time.monotonic_ns()-attempt_started,'effectsRetried':False,
                    'partialObservationReused':False,'ownerResultProduced':False})
                retain()
                if not classified:raise
                # The genuine owner leaf also bookends its ACK. Recheck that
                # immutable chain before another fresh Context/kernel capture.
                ack_method=epoch.owner.inverse_acknowledgement if epoch.inverse else epoch.owner.acknowledgement
                observed=epoch._check(ack_method(epoch.refs['resultSha256'],epoch.refs['inputSha256']),immutable=True)
                if observed!=expected_ack:raise RuntimeError('metadata_current_capture_actual_immutable_ACK_changed')
                unchanged();window()
                if attempt==MAXIMUM_ATTEMPTS:raise
                time.sleep(.025)
            else:
                observation={'attempt':attempt,'completed':True,'discarded':True,'classifiedMetadataBackendChurn':False,
                    'elapsedNanoseconds':time.monotonic_ns()-attempt_started,'effectsRetried':False,
                    'partialObservationReused':False,'ownerResultProduced':True}
                attempts.append(observation)
                retain();unchanged();window()
                observation['discarded']=False;retain()
                return value
        raise RuntimeError('bounded_metadata_current_capture_exhausted')
    except BaseException as error:
        retain()
        # Diagnostics must never replace the original strict refusal.
        try:
            error.metadata_current_capture_attempts=copy.deepcopy(epoch.current_capture_attempts)
            error.metadata_current_capture_history=copy.deepcopy(epoch.current_capture_history)
        except (AttributeError,TypeError):pass
        raise


def composition():
    global _implementation
    if _implementation is None:
        expected={'format':FORMAT+'-source','files':{FILE.name:hashlib.sha256(public(FILE)).hexdigest(),**SOURCE_PINS}}
        raw=json.dumps(expected,sort_keys=True,indent=2).encode()+b'\n'
        if json.loads(public(SOURCE_MANIFEST,hashlib.sha256(raw).hexdigest()))!=expected:raise RuntimeError('exact_actual_metadata_epoch3_source_manifest_required')
        for name,digest in expected['files'].items():public(OPS/name,digest)
        changed=0
        def transform(node):
            nonlocal changed
            if isinstance(node,ast.FunctionDef)and node.name=='composition':
                for value in ast.walk(node):
                    if isinstance(value,ast.Constant)and value.value=='authority-v3':value.value='authority-v4';changed+=1
            return node
        outer=factory().namespace(public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
            {key:globals()[key]for key in['FILE','FORMAT','OWNER','OWNER_MANIFEST','OWNER_FORMAT','SOURCE_PINS','SOURCE_MANIFEST']},transform=transform)
        if changed!=1:raise RuntimeError('one_actual_authority4_identity_target_seam_required')
        value=outer.composition();parent=value.Epoch;original=parent.current
        class Epoch(parent):
            def current(self):return capture_current(self,original)
        value.Epoch=Epoch;_implementation=value
    return _implementation


def __getattr__(name):return getattr(composition(),name)

if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('actual_Owner3_ACK_and_bounded_current_capture_context_required')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'historicalSelectedActorQualifiedAsCurrent':False,
        'maximumReadCaptureAttempts':3,'captureWindowNanoseconds':CAPTURE_WINDOW_NS,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
