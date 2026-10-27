#!/usr/bin/env python3
"""Rebuild only BNB native projections after verified committed cache omissions.

Archive fixed BNB subsets on this host, reset their native rows/checkpoint, clip
three coverage fragments at the earliest proven gap, and separately request
ordinary Ponder crash recovery. Other chains, static sources and cache rows stay
intact. No provider calls or automatic retry; original source cutoff is retained.
"""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import os
import pwd
import re
import selectors
import shutil
import signal
import socket
import stat
import subprocess
import time
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-source6-bnb-native-recovery-v4-20261022')
FORMAT='yunipals-source6-bnb-native-recovery-v4'
PARENT_HELPER=OPS/'source6-bnb-header-trial-v1.py'
PARENT_HELPER_SHA='b25f8aa1fe621cded35374208220f7a7f3390825103a73c34cb77ede4bc61cdd'
PARENT=Path('/var/backups/yunipals-source6-bnb-header-trial-v1-20261022/runtime.json')
PARENT_SHA='d41ec37965ef517496bec80f0c6cf9b2175e01c9d4eaf417970ea3d8778b66cd'
PARENT_INVOCATION='dab6fcd2704c461a9af2123168aec8f0'
EXIT_US=66087150180933
SOURCE_CHECKPOINT='166076236700000000000000560000000020527932999999999999999999999999999999999'
SCHEMA='unified_shadow_20261020_7e7375b0'
OLD_RANGE='{[7579197,20646033]}'
NEW_RANGE='{[7579197,19496903]}'
ZERO_BNB='000000000000000000000000560000000000000000000000000000000000000000000000000'
TABLES={
 'token':"collection='bnb' AND chain_id=56",
 'token_lifecycle':"collection='bnb'",
 'transfer_event':"collection='bnb' AND chain_id=56",
 'admin_role_event':"collection='bnb' AND chain_id=56",
 'canonical_event':'chain_id=56', 'transaction_candidate':'chain_id=56',
 'chain_checkpoint':'chain_id=56', 'chain_block':'chain_id=56'}
UNCHANGED=('contract_owner_event','indexer_source','booster_type','booster_original','booster_request','booster_monster','booster_refund','booster_engine_state','booster_event','booster_checkpoint','arena_tournament','arena_seat','arena_credit')
ALL_TABLES=tuple(sorted((*TABLES,*UNCHANGED)))
BACKUP_RAW_LIMIT=8*1024**3
BACKUP_COMPRESSED_LIMIT=2*1024**3
DISK_RESERVE=25_000_000_000
TOPICS=('0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d',
 '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
 '0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b')
FRAGMENTS=tuple('log_56_0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d_'+topic+'_null_null_null_0' for topic in TOPICS)
EVIDENCE={
 'bnb-native-rebuild-inventory-v1.actual.json':'4f9f6fe92c2e74d71b76074ed3f2c9e92d7ca31b0034d9b2192f5ac9a19132ee',
 'bnb-cache-completeness-v1.actual.json':'095c5f5b881276cfe83e8709412c9f95884416f86a0a429e5e53c3675a407fe6',
 'bnb-mint-cache-coverage-v1.actual.json':'20b8f3c43619726b48c7f0d870e2c93781ca5548207b0bba748bf8a429b9f2e3',
 'bnb-all-cache-intervals-v1.actual.json':'da4050a822f22ca89301b62063f6dd0650dde4f2f66fc3318e9d613b2d3cd7fe',
 'bnb-mint-merged-log-diagnosis-v1.actual.json':'f27db314b7d3670f134be979db7a3b093e234b337dc1c7b9060660db4cedafe4'}
SUPPORT_HELPER=OPS/'support-source6-normal-reconcile-v1.py'
SUPPORT_HELPER_SHA='9a1acc96df94e0eccf78b51a53813141cd5d9447ac050d23bd84a54a99327dbb'
SUPPORT_RECEIPT=Path('/var/backups/yunipals-source6-normal-support-v1-20261022/reconcile-result.json')
SUPPORT_RECEIPT_SHA='1710b0df36231900f0e61a0cb3135ad16187fdb39ce384c5554864ddd99ad37d'
SYSTEMD=Path('/etc/systemd/system')
NO_PASSWORD=OPS/'bnb-native-recovery-password-not-present'
DBUS=['/usr/bin/busctl','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager']

PREVIOUS_BASE=Path('/var/backups/yunipals-source6-bnb-native-recovery-v3-20261022')
PREVIOUS_HELPER=OPS/'source6-bnb-native-recovery-v3.py'
PREVIOUS_HELPER_SHA='13f6125aafd2012d1fb17f878daf032ea50a35e5bc3ac699442f3ac0eeccc87d'
PREVIOUS_PROOF=OPS/'bnb-native-v3-failure-proof.actual.json'
PREVIOUS_PROOF_SHA='14e03c42cdc3f149a043e51ce2d0150e36b86b4cc8780e9793bfcc38350056ab'
PREVIOUS_FILES={
 'failed.json':{'bytes':232,'sha256':'25dab4e9f3aa60bc550652a9fa25deef7e45131ecf5535a3ce325516a6e8b290'},
 'intent.json':{'bytes':416,'sha256':'10c0204d0cbcb646a7c19193f3da7a015219a3f18fe6cef8bbd8ab30e65f8767'},
 'review.json':{'bytes':42236,'sha256':'867b5c9086b3dee113007e8a8816bd6297c35996d52765e13de69c7fc48ce4fe'},
 'bnb-native-before.copy.gz':{'bytes':263723684,'sha256':'f74b34ecd90b027347950cdbddf4fe2de683d98fac719cb0fd104b0a63a399c2'}}
PREVIOUS_ABSENT=('backup.json','commit-intent.json','result.json','start-intent.json','runtime.json','start-failed.json',
 'recovery-definition.json','handover-released.json')

def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def literal(value): return "'"+str(value).replace("'","''")+"'"

def modules():
 for p in [*PARENT_HELPER.parents,PARENT_HELPER]:
  s=p.lstat()
  if stat.S_ISLNK(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: fail('protected_parent_operator_required')
 raw=PARENT_HELPER.read_bytes()
 if len(raw)>200000 or sha(raw)!=PARENT_HELPER_SHA: fail('exact_parent_operator_required')
 m=types.ModuleType('retained_header');m.__file__=str(PARENT_HELPER)
 exec(compile(raw,str(PARENT_HELPER),'exec'),m.__dict__)
 d=m.modules();d.header=m
 d.support_reconcile=d.q.load(SUPPORT_HELPER,SUPPORT_HELPER_SHA,'acknowledged_support')
 return d

def read(d,path,pin=None): return d.selective.read(d,path,pin)
def journal(d): return d.live.journal_for(d.q,BASE)

def selective_ancestry(d):
    """Frozen source/artifact/financial checks, without old live BNB validation."""
    m = d.selective
    value = read(d, d.parent.PARENT, d.parent.PARENT_SHA)
    reviewed = read(d, m.BASE / 'review.json', value['reviewSha256'])
    if value.get('format') != m.FORMAT or value.get('mode') != 'selective' or value.get('reviewFile') != str(m.BASE / 'review.json') or (value.get('freeOnly') is not True) or (value.get('paidAuthority') is not False) or (value.get('permitIds') != []) or (value.get('sourceSelectionChanged') is not False) or (reviewed.get('operatorSha256') != d.parent.PARENT_HELPER_SHA) or (value.get('clock') != reviewed.get('clock')) or (value.get('ordinaryRuntime', {}).get('invocation') != d.parent.PARENT_INVOCATION) or any((os.path.lexists(m.BASE / name) for name in ['failed.json', 'rollback-intent.json', 'rollback-failed.json'])):
        fail('successful_unsuperseded_selective_parent_required')
    release = read(d, m.BASE / 'selective-handover-released.json', d.parent.PARENT_RELEASE_SHA)
    if release != {'runtimeReceiptSha256': d.parent.PARENT_SHA, 'sourceAndChainHandoverLeasesReleased': True}:
        fail('actual_parent_release_required')
    ack = m.journal(d).latest('selective_runtime_started')
    if ack is None or ack.get('receiptFile') != str(d.parent.PARENT) or ack.get('receiptSha256') != d.parent.PARENT_SHA or (ack.get('invocation') != d.parent.PARENT_INVOCATION):
        fail('actual_parent_start_ACK_required')
    ancestor, ancestor_review = m.inherited(d)
    if m.historical_overlay(d) != reviewed['historicalOverlay'] or m.candidate_proxy(d) != reviewed['candidateProxy'] or m.provider_proof(d) != reviewed['providerProof'] or (m.namespace_proof(d) != reviewed['namespaceProof']) or (m.qualified_route() != reviewed['qualifiedRoute']) or (m.pool_identity_proof(d) != reviewed['poolIdentityProof']):
        fail('unchanged_parent_runtime_artifacts_required')
    clock = m.captured_deadline(ancestor, {'InvocationID': m.PARENT_INVOCATION, 'MainPID': str(ancestor['ordinaryRuntime']['process']['pid']), 'ExecMainStartTimestampMonotonic': str(m.PARENT_START_US)}, m.PARENT_BOOT)
    if value['clock'] != clock or value['definition'] != m.render_definition(d, ancestor, clock, value['reviewSha256'], 'selective', value['definition']['maximumRuntimeSeconds']) or value['effectiveRuntime'] != {'historicalOverlay': reviewed['historicalOverlay'], 'proxyEntrySha256': m.PROXY_ENTRY_SHA, 'qualifiedRoute': reviewed['qualifiedRoute']} or (value['financialHandoff'] != ancestor['financialHandoff']):
        fail('unchanged_source_definition_deadline_and_finance_required')
    baseline = read(d, value['proxyBaselineFile'], value['proxyBaselineSha256'])
    if value['proxyBaselineFile'] != str(m.BASE / 'selective-proxies.json') or baseline != {'proxies': value['proxies'], 'freeOnly': True, 'paidAuthority': False, 'permitIds': []}:
        fail('exact_parent_proxy_baseline_required')
    for name in ['base', 'ethereum', 'polygon']:
        if m.proxy_metadata(d, name) != value['proxies'][name]['metadata']:
            fail('other_proxy_identity_must_not_change')
        m.selected_proxy_health(d, name, value['proxies'][name]['configuration'])
    return (value, reviewed, {'ordinaryRuntime': value['ordinaryRuntime'], 'sourceRole': reviewed['sourceRole']})

def transaction_ancestry(d):
    ancestor, _, source = selective_ancestry(d)
    value = d.header.read(d, d.header.PARENT, d.header.PARENT_SHA)
    reviewed = d.header.read(d, d.parent.BASE / 'review.json', value['reviewSha256'])
    release = d.header.read(d, d.parent.BASE / 'transaction-route-handover-released.json')
    ack = d.parent.journal(d).latest('transaction-route_runtime_acknowledged')
    expected_effective = {'sourceRuntime': ancestor['effectiveRuntime'], 'bnbProxyEntrySha256': d.parent.ENTRY_SHA, 'transactionRoute': d.header.route()}
    if value.get('format') != d.parent.FORMAT or value.get('mode') != 'transaction-route' or value.get('reviewFile') != str(d.parent.BASE / 'review.json') or (reviewed.get('operatorSha256') != d.header.PARENT_HELPER_SHA) or (value.get('parentRuntimeFile') != str(d.parent.PARENT)) or (value.get('parentRuntimeSha256') != d.parent.PARENT_SHA) or (value.get('freeOnly') is not True) or (value.get('paidAuthority') is not False) or (value.get('permitIds') != []) or (value.get('sourceRestarted') is not False) or (value.get('sourceSelectionChanged') is not False) or (value.get('ordinaryRuntime') != source['ordinaryRuntime']) or (value.get('clock') != ancestor['clock']) or (value.get('financialHandoff') != ancestor['financialHandoff']) or (value.get('effectiveRuntime') != expected_effective) or (value.get('sourceDefinitionSha256') != ancestor['definition']['sha256']) or (reviewed.get('sourceIdentity') != source['ordinaryRuntime']) or (reviewed.get('clock') != ancestor['clock']) or (reviewed.get('candidate') != d.parent.candidate(d)) or (reviewed.get('qualification') != d.parent.qualification(d, ancestor)) or (reviewed.get('transactionRoute') != d.header.route()) or (release != {'runtimeReceiptSha256': d.header.PARENT_SHA, 'sourceAndBnbHandoverLeasesReleased': True}) or (ack is None) or (ack.get('receiptFile') != str(d.header.PARENT)) or (ack.get('receiptSha256') != d.header.PARENT_SHA) or any((os.path.lexists(d.parent.BASE / name) for name in ['failed.json', 'rollback-intent.json', 'rollback-failed.json'])):
        fail('exact_successful_transaction_parent_required')
    for key in ['sourceDigest', 'schema', 'nativeBuild', 'profile', 'parentReferences', 'runtimeScope']:
        if value.get(key) != ancestor[key]:
            fail('unchanged_source_lineage_required')
    for name in ['base', 'ethereum', 'polygon']:
        if value['proxies'][name] != ancestor['proxies'][name]:
            fail('unchanged_other_proxy_lineage_required')
    return ({**value, 'definition': ancestor['definition']}, reviewed, source)

def ancestry(d):
    receipt_file, receipt_sha = (str(PARENT), PARENT_SHA)
    path = Path(receipt_file)
    mode = 'header-trial' if path == d.header.BASE / 'runtime.json' else 'rollback'
    if path not in {d.header.BASE / 'runtime.json', d.header.BASE / 'rollback-runtime.json'}:
        fail('exact_successor_receipt_path_required')
    value = d.header.read(d, path, receipt_sha)
    reviewed = d.header.read(d, d.header.BASE / 'review.json', value['reviewSha256'])
    if value.get('format') != d.header.FORMAT or value.get('mode') != mode or reviewed['operatorSha256'] != PARENT_HELPER_SHA or (value.get('parentRuntimeSha256') != d.header.PARENT_SHA) or (value.get('parentRuntimeFile') != str(d.header.PARENT)) or (value.get('reviewFile') != str(d.header.BASE / 'review.json')) or (value.get('freeOnly') is not True) or (value.get('paidAuthority') is not False) or (value.get('permitIds') != []) or (value.get('sourceRestarted') is not False) or (value.get('sourceSelectionChanged') is not False) or os.path.lexists(d.header.BASE / 'rollback-failed.json') or (mode == 'header-trial' and any((os.path.lexists(d.header.BASE / name) for name in ['failed.json', 'rollback-intent.json']))):
        fail('successful_unsuperseded_BNB_successor_required')
    release = d.header.read(d, d.header.BASE / (mode + '-handover-released.json'))
    if release != {'runtimeReceiptSha256': receipt_sha, 'sourceAndBnbHandoverLeasesReleased': True}:
        fail('actual_BNB_successor_lease_release_required')
    ack = d.header.journal(d).latest(mode + '_runtime_acknowledged')
    if ack is None or ack.get('receiptFile') != str(path) or ack.get('receiptSha256') != receipt_sha:
        fail('actual_successor_ACK_required')
    if mode == 'rollback' and os.path.lexists(d.header.BASE / 'failed.json'):
        recovered = d.header.read(d, d.header.BASE / 'recovery-completed.json')
        if recovered != {'failedSha256': sha(d.q.protected(d.header.BASE / 'failed.json', 100000)), 'runtimeReceiptSha256': receipt_sha}:
            fail('actual_recovery_ACK_required')
    parent, transaction_review, source = transaction_ancestry(d)
    selected = mode == 'header-trial'
    actual = d.header.proxy(d, parent, selected)
    d.header.metrics(d, parent, selected)
    if d.header.job(d) or any((value.get(k) != parent[k] for k in ['sourceDigest', 'schema', 'nativeBuild', 'profile', 'parentReferences', 'runtimeScope'])) or reviewed.get('sourceIdentity') != source['ordinaryRuntime'] or (reviewed.get('clock') != parent['clock']) or (reviewed.get('parentRuntimeSha256') != d.header.PARENT_SHA) or (reviewed.get('parentHelperSha256') != d.header.PARENT_HELPER_SHA) or (value['ordinaryRuntime'] != source['ordinaryRuntime']) or (value['clock'] != parent['clock']) or (value['sourceDefinitionSha256'] != parent['definition']['sha256']) or (value['financialHandoff'] != parent['financialHandoff']) or (value['effectiveRuntime'] != {'sourceRuntime': parent['effectiveRuntime'], 'bnbProxyEntrySha256': d.header.ENTRY_SHA if selected else d.parent.ENTRY_SHA, 'transactionRoute': d.header.route(), 'headerMinimumIntervalMs': 200 if selected else 400}) or (value['proxies'] != {**parent['proxies'], 'bnb': {'metadata': actual, 'configuration': parent['proxies']['bnb']['configuration']}}) or (reviewed['candidate'] != d.header.candidate(d)) or (reviewed['qualification'] != transaction_review['qualification']) or (reviewed['transactionRoute'] != d.header.route()):
        fail('unchanged_source_and_acknowledged_BNB_runtime_required')
    return {**value, 'definition': parent['definition'], 'sourceRole': source['sourceRole'], 'leaseReleasedFile': str(d.header.BASE / (mode + '-handover-released.json')), 'leaseReleasedSha256': sha(encoded(release))}

def support_identity(d):
    """Accept only the acknowledged process, live or its normal finite timeout."""
    value=read(d,SUPPORT_RECEIPT,SUPPORT_RECEIPT_SHA)
    old=d.support_reconcile.parent();p,_,_,_,installer,m=old.dependencies()
    seconds=value['maximumRuntimeSeconds'];raw=old.unit_text(p,installer,m,seconds)
    if (value.get('started') is not True or value.get('runtimeReceiptSha256')!=PARENT_SHA or
        value.get('paidAuthority') is not False or value.get('sourceRestarted') is not False or
        value.get('sourceSelectionChanged') is not False or value.get('unitBytesChanged') is not False or
        value.get('unitSha256')!=sha(raw) or value['clock']!=old.SOURCE_CLOCK or seconds!=3600):
      fail('unchanged_acknowledged_support_worker_required')
    mode=old.manager(('ActiveState','SubState','MainPID'))
    if mode=={'ActiveState':'active','SubState':'running','MainPID':value['unit']['MainPID']}:
      actual=old.live_definition(p,installer,m,raw,seconds,True)
      if actual!=value['unit']:fail('same_running_support_identity_required')
      state='running';exit_us=None
    else:
      # Reuse the manager-bound immutable properties without pretending the old
      # process is active. Dynamic ExecStart timestamps are deliberately excluded
      # after exit, while the executable and argv must still match exactly.
      keys=tuple(k for k in value['unit'] if k!='processIdentity')
      actual=old.manager(keys)
      mutable={'ActiveState','SubState','MainPID','ExecStart'}
      if any(actual[k]!=v for k,v in value['unit'].items() if k not in mutable|{'processIdentity'}):
       fail('same_expired_support_definition_and_invocation_required')
      if (p.trusted(old.UNIT_PATH)!=raw or actual['ActiveState']!='failed' or actual['SubState']!='failed' or actual['MainPID']!='0' or
          re.findall(r'argv\[\]=(.*?)\s+;',actual['ExecStart'])!=re.findall(r'argv\[\]=(.*?)\s+;',value['unit']['ExecStart'])):
       fail('only_normal_support_runtime_timeout_allowed')
      result=d.qe.bus_property(old.UNIT,'org.freedesktop.systemd1.Service','Result','s')
      exit_us=d.qe.bus_property(old.UNIT,'org.freedesktop.systemd1.Service','ExecMainExitTimestampMonotonic','t')
      if (result!='timeout' or type(exit_us)is not int or exit_us<int(actual['ExecMainStartTimestampMonotonic'])+seconds*1000000 or
          exit_us>d.selective.monotonic_us() or d.selective.boot_id()!=old.SOURCE_CLOCK['bootId']):
       fail('proven_normal_support_expiry_required')
      identity=value['unit']['processIdentity']
      if not d.live.original_process_gone({'pid':identity['pid'],'startTicks':identity['startTicks'],'bootId':old.SOURCE_CLOCK['bootId']}):
       fail('expired_support_process_must_be_gone')
      d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice')/old.UNIT)
      state='expired'
    return {'receiptFile':str(SUPPORT_RECEIPT),'receiptSha256':SUPPORT_RECEIPT_SHA,
      'unitSha256':sha(raw),'maximumRuntimeSeconds':seconds,'invocation':value['unit']['InvocationID'],
      'startMonotonicUs':int(value['unit']['ExecMainStartTimestampMonotonic']),
      'processIdentity':value['unit']['processIdentity'],'state':state,'exitMonotonicUs':exit_us}


def state_matches(current,expected,*,repaired=False):
    wanted=deepcopy(expected)
    if repaired:
      for row in wanted['checkpoints']:
       if row['chain']==56:
        for key in ['latest','safe','finalized']:row[key]=ZERO_BNB
    # Expiration is accepted only by support_identity's exact manager/process
    # proof; it does not authorize any worker start or extension.
    previous=wanted['support'];actual=current['support']
    if previous['state']=='expired' and actual!=previous:return False
    if previous['state']=='running':
      if {k:v for k,v in previous.items() if k not in {'state','exitMonotonicUs'}}!={k:v for k,v in actual.items() if k not in {'state','exitMonotonicUs'}}:return False
      wanted['support']=actual
    return current==wanted


def support_matches(current,expected):
 return state_matches({'support':current},{'support':expected})


# Same frozen role/build/checkpoint guard, with the acknowledged support worker
# allowed to remain connected while the crashed source has zero sessions.
def source_state(q,qe,native,expected_role,*,running):
    value=qe.query("""SELECT jsonb_build_object(
      'role',(SELECT jsonb_build_object('oid',oid::text,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit)FROM pg_roles WHERE rolname='yunipals_unified_shadow'),
      'memberships',(SELECT count(*)FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')OR roleid=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')),
      'sourceSessions',(SELECT count(*)FROM pg_stat_activity WHERE usename='yunipals_unified_shadow'),
      'supportSessions',(SELECT count(*)FROM pg_stat_activity WHERE usename='yunipals_unified_support'),
      'supportRole',(SELECT jsonb_build_object('login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit)FROM pg_roles WHERE rolname='yunipals_unified_support'),
      'sourceIdentity',(SELECT jsonb_build_object('release',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash)FROM yunipals_indexer_control.release WHERE id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'),
      'sourceManifest',(SELECT manifest FROM yunipals_indexer_control.release WHERE id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'),
      'runtime',(SELECT jsonb_build_object('version',value->>'version','build',value->>'build_id','dev',value->>'is_dev')FROM unified_shadow_20261020_7e7375b0._ponder_meta WHERE key='app'),
      'activeSelectors',(SELECT count(*)FROM yunipals_indexer_control.active_release),
      'checkpoints',(SELECT coalesce(jsonb_agg(jsonb_build_object('chain',chain_id,'latest',latest_checkpoint,'safe',safe_checkpoint,'finalized',finalized_checkpoint)ORDER BY chain_id),'[]'::jsonb)FROM unified_shadow_20261020_7e7375b0._ponder_checkpoint))""")
    if(value.get('role')!=expected_role or value.get('sourceIdentity')!={'release':native.RELEASE,'schema':native.SCHEMA,'build':native.NATIVE,'manifestHash':native.MANIFEST}or
        value.get('sourceManifest')!=json.loads(q.protected(OPS / 'normal-rpc-profile-v1.json',100000))['manifest']or
        value.get('runtime')!={'version':'6','build':native.NATIVE,'dev':'0'}or value.get('memberships')!=0 or value.get('activeSelectors')!=0 or
        type(value.get('sourceSessions'))is not int or not(1<=value['sourceSessions']<=32 if running else value['sourceSessions']==0)or
        type(value.get('supportSessions'))is not int or not 0<=value['supportSessions']<=16):fail('ordinary_source_role_runtime_or_writer_contract_changed')
    sr=value.get('supportRole')or{}
    if(sr.get('login')is not True or sr.get('connectionLimit')!=16 or any(sr.get(k)is not False for k in ['inherit','super','createDb','createRole','replication','bypassRls'])):fail('retained_support_role_contract_changed')
    points=value['checkpoints']
    if(len(points)!=4 or{r.get('chain')for r in points}!={1,56,137,8453}or any(set(r)!={'chain','latest','safe','finalized'}or any(not isinstance(r[k],str)or re.fullmatch('[0-9]{75}',r[k])is None for k in ['latest','safe','finalized'])for r in points)):fail('exact_four_retained_physical_checkpoints_required')
    return value


def source_job(d):
 value=d.qe.bus_property(d.ordinary.UNIT,'org.freedesktop.systemd1.Unit','Job','(uo)')
 if (not isinstance(value,list) or len(value)!=2 or type(value[0]) is not int or value[0]<0 or
     value[1]!=('/org/freedesktop/systemd1/job/'+str(value[0]) if value[0] else '/')):
  fail('exact_source_job_identity_required')
 return value[0]


def terminal(d,parent):
 saved=parent['ordinaryRuntime'];definition=parent['definition'];unit=d.ordinary.UNIT
 p=d.renewal.terminal_source_properties(d)
 if (p['Id']!=unit or p['LoadState']!='loaded' or p['Type']!='exec' or p['Restart']!='no' or
     p['MainPID']!='0' or p['ActiveState']!='failed' or p['SubState']!='failed' or
     p['InvocationID']!=PARENT_INVOCATION or p['InvocationID']!=saved['invocation'] or
     int(p['ExecMainStartTimestampMonotonic'])!=saved['startMonotonicUs'] or
     p['User']!=d.native.USER or p['Group']!=d.native.USER or
     re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])!=[' '.join(d.ordinary.source_command())] or
     sha(d.q.protected(SYSTEMD/unit,50000))!=definition['sha256'] or source_job(d)):
  fail('exact_crashed_source_required')
 for key,kind,wanted in [('ExecMainExitTimestampMonotonic','t',EXIT_US),('ExecMainStatus','i',1),('Result','s','exit-code')]:
  if d.qe.bus_property(unit,'org.freedesktop.systemd1.Service',key,kind)!=wanted: fail('exact_crash_exit_required')
 if (d.selective.boot_id()!=parent['clock']['bootId'] or
     not d.live.original_process_gone({'pid':saved['process']['pid'],'startTicks':saved['process']['startTicks'],'bootId':saved['bootId']})):
  fail('same_boot_original_process_gone_required')
 d.q.assert_no_unit_environment(d.qe,unit);d.selective.check_mounts(d,'selective')
 if (d.qe.bus_property(unit,'org.freedesktop.systemd1.Unit','FragmentPath','s')!=str(SYSTEMD/unit) or
     d.qe.bus_property(unit,'org.freedesktop.systemd1.Unit','DropInPaths','as')!=[]): fail('exact_retained_source_definition_required')
 d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice')/unit)
 d.selective.remaining_seconds(parent['clock'],d.selective.monotonic_us(),d.selective.boot_id())
 return {'invocation':saved['invocation'],'exitMonotonicUs':EXIT_US,'processGone':True,'job':0,
         'definitionSha256':definition['sha256'],'bootId':saved['bootId']}


def evidence(d):
 values={name:read(d,OPS/name,pin) for name,pin in EVIDENCE.items()}
 actual=values['bnb-all-cache-intervals-v1.actual.json']['inventory']
 if (actual.get('chainId')!=56 or actual.get('rows')!=3 or actual.get('intervals')!=
     [{'fragment_id':f,'ranges':OLD_RANGE} for f in FRAGMENTS]): fail('actual_exact_three_interval_witness_required')
 checkpoint=values['bnb-mint-cache-coverage-v1.actual.json']['inventory']
 if next((r['checkpoint'] for r in checkpoint['checkpoints'] if r['chainId']==56),None)!=SOURCE_CHECKPOINT:
  fail('actual_completed_checkpoint_before_mint_required')
 proof=values['bnb-cache-completeness-v1.actual.json']
 if (proof.get('sourceInvocation')!=PARENT_INVOCATION or proof.get('summary',{}).get('prefix',{}).get('firstMissingBlock')!=19496903 or
     proof['summary']['prefix'].get('missingCount')!=36 or proof['summary']['prefix'].get('missingNativeTransferRows')!=36 or
     proof['summary']['prefix'].get('all36RecoveredByCurrentRangeQuery') is not True or proof['summary']['suffix'].get('missingCount')!=2065):
  fail('exact_committed_prefix_and_recoverable_gap_proof_required')
 return EVIDENCE.copy()


def table_stats_sql(table,predicate):
 # A deterministic digest of row hashes detects equal-count concurrent changes;
 # only its digest/counts leave PostgreSQL, never the underlying ownership rows.
 return "SELECT jsonb_build_object('total',count(*),'selected',count(*) FILTER(WHERE "+predicate+"),'digest',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)) FILTER(WHERE "+predicate+"),''))) FROM "+SCHEMA+'.'+table+' t'


def snapshot_sql():
 tables=','.join(literal(t)+',('+table_stats_sql(t,p)+')' for t,p in TABLES.items())
 untouched=','.join(literal(t)+',(SELECT count(*) FROM '+SCHEMA+'.'+t+')' for t in UNCHANGED)
 journals=','.join(literal(t)+',(SELECT count(*) FROM '+SCHEMA+'._reorg__'+t+')' for t in ALL_TABLES)
 contradictions=' + '.join('(SELECT count(*) FROM '+SCHEMA+'.'+t+" WHERE (collection='bnb') IS DISTINCT FROM (chain_id=56))" for t in ['token','transfer_event','admin_role_event'])
 return """SELECT jsonb_build_object(
 'identity',jsonb_build_object('database',current_database(),'port',current_setting('port'),
   'sessionUser',session_user,'currentUser',current_user,'socket',inet_client_addr() IS NULL),
 'app',(SELECT value FROM unified_shadow_20261020_7e7375b0._ponder_meta WHERE key='app'),
 'checkpoints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY chain_id) FROM unified_shadow_20261020_7e7375b0._ponder_checkpoint c),
 'intervals',(SELECT jsonb_agg(to_jsonb(r) ORDER BY chain_id,fragment_id) FROM
   (SELECT chain_id,fragment_id,blocks::text AS ranges FROM ponder_sync.intervals WHERE chain_id=56 ORDER BY chain_id,fragment_id LIMIT 257)r),
 'nativeTables',jsonb_build_object("""+tables+"""),
 'unchangedCounts',jsonb_build_object("""+untouched+"""),
 'staticSourcesDigest',("""+table_stats_sql('indexer_source','true')+"""),
 'reorgJournalCounts',jsonb_build_object("""+journals+"""),
 'unexpectedBNBOwnershipRows',(SELECT count(*) FROM unified_shadow_20261020_7e7375b0.contract_owner_event WHERE chain_id=56 OR collection='bnb'),
 'contradictoryCollectionRows',"""+contradictions+""",
 'enabledTriggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'trigger',t.tgname,'enabled',t.tgenabled) ORDER BY c.relname,t.tgname),'[]'::jsonb)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"""+SCHEMA+"""' AND NOT t.tgisinternal AND t.tgenabled<>'D'),
 'foreignKeys',(SELECT count(*) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"""+SCHEMA+"""' AND x.contype='f'))"""


def validate_snapshot(value,repaired=False):
 if value.get('identity')!={'database':'yunipals_backfill','port':'5432','sessionUser':'postgres','currentUser':'postgres','socket':True}:fail('exact_local_backfill_database_required')
 app=value.get('app') or {}
 if (app.get('build_id')!='bf4939b3ff' or str(app.get('is_locked'))!='0' or str(app.get('is_ready'))!='0' or
     sorted(app.get('table_names',[]))!=list(ALL_TABLES)):fail('same_unlocked_native_app_and_table_catalog_required')
 points=value.get('checkpoints')
 if not isinstance(points,list) or len(points)!=4 or {r.get('chain_id') for r in points}!={1,56,137,8453}:fail('four_native_checkpoints_required')
 bnb=next(r for r in points if r['chain_id']==56)
 if repaired:
  if any(bnb.get(k)!=ZERO_BNB for k in ['latest_checkpoint','safe_checkpoint','finalized_checkpoint']):fail('exact_BNB_zero_checkpoint_required')
 elif any(bnb.get(k)!=SOURCE_CHECKPOINT for k in ['latest_checkpoint','safe_checkpoint']):fail('unchanged_complete_BNB_safe_and_latest_checkpoint_required')
 rows=value.get('intervals')
 if not isinstance(rows,list) or len(rows)>256:fail('bounded_actual_interval_catalog_required')
 wanted=[{'chain_id':56,'fragment_id':f,'ranges':NEW_RANGE if repaired else OLD_RANGE} for f in FRAGMENTS]
 if rows!=wanted:fail('exact_three_BNB_intervals_required')
 if (value.get('reorgJournalCounts')!={t:0 for t in ALL_TABLES} or value.get('enabledTriggers')!=[] or
     value.get('foreignKeys')!=0 or value.get('unexpectedBNBOwnershipRows')!=0 or value.get('contradictoryCollectionRows')!=0):
  fail('historical_no_journals_triggers_or_cross_chain_dependencies_required')
 stats=value.get('nativeTables',{})
 if set(stats)!=set(TABLES) or set(value.get('unchangedCounts',{}))!=set(UNCHANGED):fail('exact_native_table_inventory_required')
 for row in stats.values():
  if (set(row)!={'total','selected','digest'} or type(row['total'])is not int or type(row['selected'])is not int or
      not 0<=row['selected']<=row['total'] or not re.fullmatch('[0-9a-f]{32}',str(row['digest'])) or
      (repaired and (row['selected']!=0 or row['digest']!=hashlib.md5(b'').hexdigest()))):fail('exact_bounded_native_inventory_required')
 if any(type(v)is not int or v<0 for v in value['unchangedCounts'].values()):fail('valid_unchanged_table_counts_required')
 return value


def expected_after(before):
 value=deepcopy(before)
 for row in value['intervals']:
  if row['chain_id']==56:row['ranges']=NEW_RANGE
 for row in value['checkpoints']:
  if row['chain_id']==56:
   for k in ['latest_checkpoint','safe_checkpoint','finalized_checkpoint']:row[k]=ZERO_BNB
 for row in value['nativeTables'].values():
  row['total']-=row['selected'];row['selected']=0;row['digest']=hashlib.md5(b'').hexdigest()
 return value


def lock_sql():
 names=[SCHEMA+'.'+t for t in (*ALL_TABLES,*('_reorg__'+t for t in ALL_TABLES),'_ponder_meta','_ponder_checkpoint')]
 return 'LOCK TABLE '+','.join(names)+',ponder_sync.intervals IN SHARE ROW EXCLUSIVE MODE;\n'


def guarded_sql(before,commit=False):
 validate_snapshot(before)
 old=literal(encoded(before).decode())+'::jsonb';new=literal(encoded(expected_after(before)).decode())+'::jsonb'
 q="BEGIN; SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='120s'; SET LOCAL idle_in_transaction_session_timeout='130s';\n"+lock_sql()
 q+='DO $repair$ DECLARE observed jsonb; n bigint; BEGIN\nobserved:=('+snapshot_sql()+'); IF observed IS DISTINCT FROM '+old+" THEN RAISE EXCEPTION 'native_repair_stale_snapshot'; END IF;\n"
 for table,predicate in TABLES.items():
  q+='DELETE FROM '+SCHEMA+'.'+table+' WHERE '+predicate+';\nGET DIAGNOSTICS n=ROW_COUNT; IF n<>'+str(before['nativeTables'][table]['selected'])+" THEN RAISE EXCEPTION 'exact_BNB_delete_count_required'; END IF;\n"
 q+='UPDATE '+SCHEMA+'._ponder_checkpoint SET '+','.join(k+'='+literal(ZERO_BNB) for k in ['latest_checkpoint','safe_checkpoint','finalized_checkpoint'])+' WHERE chain_id=56;\nGET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION \'one_BNB_checkpoint_required\'; END IF;\n'
 q+="UPDATE ponder_sync.intervals SET blocks=nummultirange(numrange(7579197,19496903,'[]')) WHERE chain_id=56 AND fragment_id IN ("+','.join(literal(f) for f in FRAGMENTS)+") AND blocks=nummultirange(numrange(7579197,20646033,'[]'));\nGET DIAGNOSTICS n=ROW_COUNT; IF n<>3 THEN RAISE EXCEPTION 'exact_three_interval_updates_required'; END IF;\n"
 q+='observed:=('+snapshot_sql()+'); IF observed IS DISTINCT FROM '+new+" THEN RAISE EXCEPTION 'native_repair_exact_postcondition_failed'; END IF; END $repair$;\n"+snapshot_sql()+';\n'+('COMMIT;' if commit else 'ROLLBACK;')
 return q


def peer_argv(write=False):
 if os.path.lexists(NO_PASSWORD):fail('absent_peer_password_file_required')
 user=pwd.getpwnam('postgres')
 if (user.pw_uid,user.pw_gid)!=(111,113):fail('exact_existing_local_postgres_identity_required')
 options='-c statement_timeout=120000 -c lock_timeout=1500 -c idle_in_transaction_session_timeout=130000 -c work_mem=8MB -c temp_file_limit=512MB -c max_parallel_workers_per_gather=0'
 if not write:options+=' -c default_transaction_read_only=on'
 return ['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs',
  '/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME=/nonexistent','PGUSER=postgres','PGHOST=/var/run/postgresql','PGPORT=5432','PGDATABASE=yunipals_backfill',
  'PGPASSFILE='+str(NO_PASSWORD),'PGOPTIONS='+options,'/usr/bin/psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1']


def sql(query,write=False):
 p=subprocess.run(peer_argv(write),input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd='/',
  env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC'},timeout=140)
 if p.returncode or p.stderr or len(p.stdout)>262144:fail('bounded_native_database_operation_failed')
 if os.path.lexists(NO_PASSWORD):fail('peer_password_file_appeared')
 return json.loads(p.stdout)


def backup_query(before):
 # One repeatable-read snapshot binds both the digest and COPY. The eventual
 # write transaction repeats that digest guard under table locks.
 locks=''
 guard='DO $backup$ BEGIN IF ('+snapshot_sql()+') IS DISTINCT FROM '+literal(encoded(before).decode())+"::jsonb THEN RAISE EXCEPTION 'backup_stale_snapshot'; END IF; END $backup$;\n"
 parts=['SELECT '+literal(t)+' AS table_name,to_jsonb(t) AS row_data FROM '+SCHEMA+'.'+t+' t WHERE '+p for t,p in TABLES.items()]
 parts.append("SELECT '_ponder_checkpoint',to_jsonb(t) FROM "+SCHEMA+'._ponder_checkpoint t WHERE chain_id=56')
 return 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'+locks+guard+'COPY ('+' UNION ALL '.join(parts)+') TO STDOUT;\nROLLBACK;'


def disk_reserve():
 if min(shutil.disk_usage(p).free for p in [BASE,'/var/lib/postgresql'])<DISK_RESERVE+BACKUP_COMPRESSED_LIMIT+512*1024**2:
  fail('backup_and_25GB_reserve_required')


def backup(d,before):
 path=BASE/'bnb-native-before.copy.gz'
 if os.path.lexists(path):fail('one_private_backup_only')
 disk_reserve();expected=sum(v['selected'] for v in before['nativeTables'].values())+1
 raw_sha=hashlib.sha256();raw_bytes=rows=0;started=time.monotonic()
 # No raw rows/stderr leave this host. The parent owns the archive descriptor,
 # the child only has its pipe after dropping to the existing postgres identity.
 with path.open('xb') as out:
  with gzip.GzipFile(filename='',fileobj=out,mode='wb',compresslevel=1,mtime=0) as zipped:
   p=subprocess.Popen(peer_argv(False),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd='/',env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC'})
   try:
    p.stdin.write(backup_query(before).encode());p.stdin.close()
    poll=selectors.DefaultSelector();poll.register(p.stdout,selectors.EVENT_READ,'rows');poll.register(p.stderr,selectors.EVENT_READ,'error');err=bytearray()
    while poll.get_map():
     if time.monotonic()-started>280:fail('bounded_native_backup_expired')
     for key,_ in poll.select(timeout=1):
      chunk=os.read(key.fileobj.fileno(),65536)
      if not chunk:poll.unregister(key.fileobj);continue
      if key.data=='error':
       err.extend(chunk)
       if len(err)>65536:fail('bounded_native_backup_error')
       continue
      raw_bytes+=len(chunk)
      if raw_bytes>BACKUP_RAW_LIMIT:fail('bounded_native_backup_size_exceeded')
      raw_sha.update(chunk);rows+=chunk.count(b'\n');zipped.write(chunk)
      if out.tell()>BACKUP_COMPRESSED_LIMIT:fail('bounded_compressed_backup_size_exceeded')
    if p.wait(timeout=5) or err or rows!=expected:fail('complete_native_backup_required')
   finally:
    if p.poll() is None:p.kill();p.wait(timeout=5)
    for stream in [p.stdin,p.stdout,p.stderr]:stream.close()
    if 'poll' in locals():poll.close()
  out.flush();os.fsync(out.fileno())
 d.q.sync_directory(BASE)
 # Verify the exact saved compressed stream once, before any native mutation.
 saved=hashlib.sha256();verified=hashlib.sha256();saved_size=0
 with path.open('rb') as handle:
  while chunk:=handle.read(1024*1024):saved.update(chunk);saved_size+=len(chunk)
 if saved_size>BACKUP_COMPRESSED_LIMIT:fail('bounded_saved_backup_size_exceeded')
 with gzip.open(path,'rb') as handle:
  verified_bytes=0
  while chunk:=handle.read(1024*1024):
   verified_bytes+=len(chunk)
   if verified_bytes>BACKUP_RAW_LIMIT:fail('bounded_backup_verification_required')
   verified.update(chunk)
 if verified_bytes!=raw_bytes or verified.hexdigest()!=raw_sha.hexdigest():fail('durable_backup_readback_required')
 receipt={'path':str(path),'sha256':saved.hexdigest(),'compressedBytes':saved_size,'uncompressedBytes':raw_bytes,
  'uncompressedSha256':raw_sha.hexdigest(),'rows':rows,'snapshotSha256':sha(encoded(before)),
  'copyFormat':'text_table_name_jsonb','tables':list(TABLES)+['_ponder_checkpoint'],'rawRowsExported':False}
 d.q.save(BASE/'backup.json',receipt)
 return receipt


def verify_backup(d,receipt,before):
 if (receipt.get('path')!=str(BASE/'bnb-native-before.copy.gz') or receipt.get('snapshotSha256')!=sha(encoded(before)) or
     receipt.get('tables')!=list(TABLES)+['_ponder_checkpoint'] or receipt.get('rows')!=sum(v['selected'] for v in before['nativeTables'].values())+1 or
     receipt.get('copyFormat')!='text_table_name_jsonb' or receipt.get('rawRowsExported') is not False):fail('exact_host_private_archive_required')
 path=Path(receipt['path']);st=path.lstat()
 if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600 or st.st_size!=receipt['compressedBytes'] or st.st_size>BACKUP_COMPRESSED_LIMIT:
  fail('protected_complete_native_archive_required')
 digest=hashlib.sha256()
 with path.open('rb') as handle:
  while chunk:=handle.read(1024*1024):digest.update(chunk)
 if digest.hexdigest()!=receipt['sha256']:fail('unchanged_native_archive_required')
 return receipt


def fixed_state(d):
 parent=ancestry(d);stopped=terminal(d,parent);support=support_identity(d)
 peer=source_state(d.q,d.qe,d.native,parent['sourceRole'],running=False)
 if support['state']=='expired' and peer['supportSessions']!=0:fail('expired_support_must_have_no_sessions')
 return {'parent':parent,'terminal':stopped,'support':support,'sourceRole':peer['role'],'checkpoints':peer['checkpoints']}


def prior_processes_absent():
 # The failed read-only psql child was reaped. Refuse another old helper or any
 # psql process now; never kill it or infer termination from an observation timeout.
 count=0
 for path in Path('/proc').iterdir():
  if not path.name.isdigit():continue
  count+=1
  if count>8192:fail('bounded_process_catalog_required')
  try:
   comm=(path/'comm').read_text().strip()
   if comm=='psql':fail('prior_peer_child_must_be_terminal')
   if comm.startswith('python'):
    with (path/'cmdline').open('rb')as handle:raw=handle.read(32769)
    if len(raw)>32768:fail('bounded_python_command_required')
    if str(PREVIOUS_HELPER).encode() in raw.split(b'\0'):fail('prior_helper_must_be_terminal')
  except FileNotFoundError:continue


def previous_attempt(d):
 # This is one expressly reviewed successor to a proved pre-COMMIT failure, not
 # permission to retry an unknown SQL outcome. All v3 files remain untouched.
 if sha(d.q.protected(PREVIOUS_HELPER,200000))!=PREVIOUS_HELPER_SHA:fail('exact_preserved_v3_helper_required')
 proof=read(d,PREVIOUS_PROOF,PREVIOUS_PROOF_SHA)
 if (proof.get('activeV3HelperPids')!=[] or proof.get('psqlPids')!=[] or proof.get('databaseWrites')!=0 or
     proof.get('providerCalls')!=0 or proof.get('serviceActions')!=0 or proof.get('rawRowsExported')is not False or
     proof.get('source')!={'ActiveState':'failed','SubState':'failed','MainPID':'0','Result':'exit-code',
       'InvocationID':PARENT_INVOCATION,'ExecMainExitTimestampMonotonic':str(EXIT_US)} or
     proof.get('absent')!={name:True for name in PREVIOUS_ABSENT[:6]}):fail('exact_terminal_precommit_failure_proof_required')
 for name,expected in PREVIOUS_FILES.items():
  actual=proof.get('files',{}).get(name,{})
  if any(actual.get(k)!=v for k,v in expected.items()):fail('exact_preserved_attempt_file_proof_required')
 if any(os.path.lexists(PREVIOUS_BASE/name) for name in PREVIOUS_ABSENT):fail('prior_commit_or_start_artifact_forbids_retry')
 failed=read(d,PREVIOUS_BASE/'failed.json',PREVIOUS_FILES['failed.json']['sha256'])
 if (failed!=proof['files']['failed.json']['status'] or failed.get('commitOutcomeMayBeUnknown')is not False or
     failed.get('manualReconcileRequired')is not True or failed.get('automaticRetryAllowed')is not False or
     failed.get('sourceStarted')is not False):fail('known_no_dispatch_failure_required')
 intent=read(d,PREVIOUS_BASE/'intent.json',PREVIOUS_FILES['intent.json']['sha256'])
 old=read(d,PREVIOUS_BASE/'review.json',PREVIOUS_FILES['review.json']['sha256'])
 if (intent!={'reviewHash':PREVIOUS_FILES['review.json']['sha256'],'parentRuntimeSha256':PARENT_SHA,
      'automaticRetryAllowed':False,'nativeTablesToRebuild':list(TABLES),'checkpointRowsToReset':1,'sourceStartAllowed':False} or
     old.get('format')!='yunipals-source6-bnb-native-recovery-v3' or old.get('operatorSha256')!=PREVIOUS_HELPER_SHA or
     old.get('parentRuntimeSha256')!=PARENT_SHA or old.get('expectedAfter')!=expected_after(old['snapshot'])):
  fail('exact_failed_attempt_review_and_intent_required')
 path=PREVIOUS_BASE/'bnb-native-before.copy.gz';st=path.lstat();expected=PREVIOUS_FILES[path.name]
 if (stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_nlink!=1 or
     stat.S_IMODE(st.st_mode)!=0o600 or st.st_size!=expected['bytes']):fail('preserved_partial_archive_required')
 digest=hashlib.sha256();size=0
 with path.open('rb')as handle:
  while chunk:=handle.read(1024*1024):
   size+=len(chunk)
   if size>expected['bytes']:fail('bounded_partial_archive_required')
   digest.update(chunk)
 if size!=expected['bytes'] or digest.hexdigest()!=expected['sha256']:fail('unchanged_partial_archive_required')
 prior_processes_absent()
 peer=sql("SELECT jsonb_build_object('activePriorPeerTransactions',count(*)) FROM pg_stat_activity WHERE datname=current_database() AND usename='postgres' AND backend_type='client backend' AND pid<>pg_backend_pid() AND state IS DISTINCT FROM 'idle'")
 if peer!={'activePriorPeerTransactions':0}:fail('prior_database_child_must_be_terminal')
 return old,{'proofFile':str(PREVIOUS_PROOF),'proofSha256':PREVIOUS_PROOF_SHA,
  'preservedAttemptDirectory':str(PREVIOUS_BASE),'preservedFiles':PREVIOUS_FILES,'partialArchiveReused':False,
  'priorCommitDispatched':False,'priorProcessesTerminal':True}


def scoped_inventory(inventory):
 # Other Ponder applications legitimately advance their own shared-cache intervals.
 # Bind only the exact BNB fragments; every native-table/checkpoint guard remains whole.
 value=deepcopy(inventory)
 value['intervals']=[r for r in value['intervals'] if r.get('chain_id')==56]
 return value


def review(d):
 if any(os.path.lexists(BASE/name) for name in ['intent.json','result.json','failed.json','start-intent.json']): fail('one_fresh_repair_only')
 previous,previous_binding=previous_attempt(d)
 state=fixed_state(d);proof=evidence(d)
 inventory=read(d,OPS/'bnb-native-rebuild-inventory-v1.actual.json',EVIDENCE['bnb-native-rebuild-inventory-v1.actual.json'])
 if inventory.get('databaseWrites')!=0 or inventory.get('providerCalls')!=0:fail('read_only_native_inventory_required')
 before=validate_snapshot(sql('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+snapshot_sql()+'; ROLLBACK;'))
 if before!=scoped_inventory(inventory.get('inventory')):fail('native_snapshot_changed_since_actual_inventory')
 if before!=previous['snapshot']:fail('native_snapshot_changed_since_failed_archive_attempt')
 if not state_matches(fixed_state(d),state): fail('stable_terminal_source_support_and_proxies_required')
 return {'format':FORMAT,'operatorSha256':sha(d.q.protected(Path(__file__).absolute(),200000)),
  'parentRuntimeFile':str(PARENT),'parentRuntimeSha256':PARENT_SHA,'state':state,'evidence':proof,
  'previousAttempt':previous_binding,'snapshot':before,'expectedAfter':expected_after(before),'repairSqlSha256':sha(guarded_sql(before,True).encode()),
  'intervalRowsChanged':3,'cacheRowsDeleted':0,'nativeRowsToDelete':sum(v['selected'] for v in before['nativeTables'].values()),
  'nativeTablesToRebuild':list(TABLES),'checkpointRowsToReset':1,'providerCalls':0,'sourceStarted':False,
  'decodedRetainedThrough':19496902,'decodedInvalidatedFrom':19496903,'decodedInvalidatedThrough':20646032}


def prepare_directory(d):
 BASE.mkdir(mode=0o700,exist_ok=True)
 s=BASE.lstat()
 if stat.S_ISLNK(s.st_mode) or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700: fail('private_owned_recovery_directory_required')
 d.q.sync_directory(BASE.parent)


def repair(d,expected,commit):
 with ExitStack() as locks:
  locks.enter_context(d.c.source_lease());locks.enter_context(d.v.chain_lock('bnb'))
  reviewed=review(d)
  if sha(encoded(reviewed))!=expected:fail('exact_fresh_repair_review_required')
  if not commit:
   result=sql(guarded_sql(reviewed['snapshot'],False),write=True)
   if result!=reviewed['expectedAfter'] or sql(snapshot_sql())!=reviewed['snapshot']:fail('repair_rehearsal_must_rollback_exactly')
   if not state_matches(fixed_state(d),reviewed['state']):fail('rehearsal_identity_changed')
   return {'format':FORMAT,'reviewHash':expected,'rollbackConfirmed':True,'persistentWrites':0,'sourceStarted':False,'providerCalls':0}
  prepare_directory(d);d.q.save(BASE/'review.json',reviewed)
  # Durably records this one attempt before the backup or any SQL write. A
  # failed backup cannot authorize a reset, and the attempt cannot auto-retry.
  d.q.save(BASE/'intent.json',{'reviewHash':expected,'parentRuntimeSha256':PARENT_SHA,'automaticRetryAllowed':False,
   'nativeTablesToRebuild':list(TABLES),'checkpointRowsToReset':1,'sourceStartAllowed':False})
  dispatched=False
  try:
   saved=backup(d,reviewed['snapshot']);verify_backup(d,saved,reviewed['snapshot'])
   if not state_matches(fixed_state(d),reviewed['state']):fail('repair_state_changed_before_sql')
   d.q.save(BASE/'commit-intent.json',{'reviewHash':expected,'backupSha256':saved['sha256'],'sqlSha256':reviewed['repairSqlSha256'],
    'automaticRetryAllowed':False})
   dispatched=True;result=sql(guarded_sql(reviewed['snapshot'],True),write=True)
   if result!=reviewed['expectedAfter'] or not state_matches(fixed_state(d),reviewed['state'],repaired=True):fail('repair_postcommit_acknowledgement_failed')
   receipt={'format':FORMAT,'reviewSha256':expected,'parentRuntimeSha256':PARENT_SHA,'committed':True,
    'beforeSha256':sha(encoded(reviewed['snapshot'])),'afterSha256':sha(encoded(result)),'after':result,'backup':saved,
    'intervalRowsChanged':3,'cacheRowsDeleted':0,'nativeRowsDeleted':reviewed['nativeRowsToDelete'],
    'nativeTablesRebuilt':list(TABLES),'checkpointRowsReset':1,'providerCalls':0,'sourceStarted':False}
   pin=d.q.save(BASE/'result.json',receipt)
   return {'format':FORMAT,'resultFile':str(BASE/'result.json'),'resultSha256':pin,'committed':True,
    'nativeRowsDeleted':receipt['nativeRowsDeleted'],'backupSha256':saved['sha256'],'sourceStarted':False}
  except BaseException as error:
   d.q.save(BASE/'failed.json',{'failure':d.normal.failure(error),'manualReconcileRequired':True,'automaticRetryAllowed':False,
    'commitOutcomeMayBeUnknown':dispatched,'sourceStarted':False})
   raise


def repair_receipt(d,pin):
 if not isinstance(pin,str) or not re.fullmatch('[0-9a-f]{64}',pin):fail('exact_repair_receipt_hash_required')
 value=read(d,BASE/'result.json',pin);reviewed=read(d,BASE/'review.json',value['reviewSha256'])
 if (value.get('format')!=FORMAT or value.get('committed') is not True or value.get('sourceStarted') is not False or
     value.get('cacheRowsDeleted')!=0 or value.get('intervalRowsChanged')!=3 or value.get('checkpointRowsReset')!=1 or
     value.get('nativeTablesRebuilt')!=list(TABLES) or value.get('nativeRowsDeleted')!=reviewed.get('nativeRowsToDelete') or
     value.get('parentRuntimeSha256')!=PARENT_SHA or value.get('after')!=reviewed['expectedAfter'] or
     value.get('afterSha256')!=sha(encoded(value['after'])) or value.get('beforeSha256')!=sha(encoded(reviewed['snapshot'])) or
     reviewed.get('operatorSha256')!=sha(d.q.protected(Path(__file__).absolute(),200000)) or
     read(d,BASE/'intent.json').get('reviewHash')!=value['reviewSha256'] or os.path.lexists(BASE/'failed.json')):
  fail('exact_acknowledged_native_repair_required')
 saved=read(d,BASE/'backup.json')
 if value.get('backup')!=saved or read(d,BASE/'commit-intent.json')!={'reviewHash':value['reviewSha256'],'backupSha256':saved['sha256'],
   'sqlSha256':reviewed['repairSqlSha256'],'automaticRetryAllowed':False}:fail('durable_archive_and_commit_intent_required')
 verify_backup(d,saved,reviewed['snapshot']);validate_snapshot(value['after'],True)
 return value,reviewed


def start_job(d,definition):
 if source_job(d): fail('no_existing_source_job_allowed')
 journal(d).emit('source_start_intent',definitionSha256=definition['sha256'],bootId=d.selective.boot_id(),
   earliestStartMonotonicUs=d.selective.monotonic_us())
 # Before a returned job ID is captured, dispatch uncertainty is manual. Do not
 # issue a second start or cancel an unidentified job after a client timeout.
 raw=d.q.run([*DBUS,'StartUnit','ss',d.ordinary.UNIT,'fail'],timeout=5)
 match=re.fullmatch(r'o "(/org/freedesktop/systemd1/job/([1-9][0-9]*))"\s*',raw)
 if not match: fail('exact_owned_source_start_job_response_required')
 owned=int(match[2]);journal(d).emit('source_start_job_created',jobId=owned)
 try:
  end=time.monotonic()+30
  while time.monotonic()<end:
   current=source_job(d)
   if current==0: return
   if current!=owned: fail('foreign_source_job_blocks_acknowledgement')
   time.sleep(0.2)
  fail('bounded_source_start_job_expired')
 except BaseException:
  if source_job(d)==owned:
   journal(d).emit('source_start_job_cancel_intent',jobId=owned)
   try:d.q.run([*DBUS,'CancelJob','u',str(owned)],timeout=5)
   except Exception:
    if source_job(d)==owned:fail('owned_source_start_job_cancel_failed')
  raise


def start(d,pin):
 with ExitStack() as locks:
  locks.enter_context(d.c.source_lease())
  for name in ['base','bnb','ethereum','polygon']:locks.enter_context(d.v.chain_lock(name))
  if any(os.path.lexists(BASE/name) for name in ['start-intent.json','runtime.json','start-failed.json']):fail('one_explicit_source_start_only')
  repaired,reviewed=repair_receipt(d,pin)
  state=fixed_state(d)
  if not state_matches(state,reviewed['state'],repaired=True) or sql(snapshot_sql())!=repaired['after']:fail('unchanged_repaired_source_before_start_required')
  # Use the normal3 baseline definition so the existing renderer adds the same
  # historical bind once, while recomputing only the remaining finite lifetime.
  ancestor,_=d.selective.inherited(d)
  definition=d.selective.source_definition(d,ancestor,state['parent']['clock'],pin,'selective')
  d.q.save(BASE/'recovery-definition.json',definition)
  d.q.save(BASE/'start-intent.json',{'repairReceiptSha256':pin,'parentRuntimeSha256':PARENT_SHA,
   'definitionSha256':definition['sha256'],'clock':state['parent']['clock'],'automaticRetryAllowed':False,
   'sourceSelectionChanged':False,'paidAuthority':False})
  try:
   if not state_matches(fixed_state(d),state):fail('start_state_changed_before_definition_replace')
   d.renewal.replace_source_definition(d,definition,state['parent']['definition']['sha256'])
   p=d.renewal.terminal_source_properties(d)
   if (p['MainPID']!='0' or p['InvocationID']!=PARENT_INVOCATION or p['ActiveState']!='failed' or source_job(d) or
       sql(snapshot_sql())!=repaired['after'] or not support_matches(support_identity(d),state['support']) or ancestry(d)!=state['parent']):
    fail('unchanged_terminal_state_after_definition_replace_required')
   d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice')/d.ordinary.UNIT)
   if d.selective.monotonic_us()+d.selective.START_COMMAND_LIMIT_US+definition['maximumRuntimeSeconds']*1000000>state['parent']['clock']['originalRuntimeExpiresMonotonicMicroseconds']:
    fail('original_deadline_headroom_consumed_no_source_start')
   start_job(d,definition)
   actual=d.selective.runtime(d,definition,state['parent']['clock'],'selective')
   if actual['invocation']==PARENT_INVOCATION:fail('fresh_crash_recovery_invocation_required')
   d.v.retry(lambda:(d.ordinary.source_health(),source_state(d.q,d.qe,d.native,state['sourceRole'],running=True)))
   if ancestry(d)!=state['parent'] or not support_matches(support_identity(d),state['support']):fail('proxy_or_support_changed_during_source_recovery')
   d.selective.runtime(d,definition,state['parent']['clock'],'selective',saved=actual)
   value={'format':FORMAT,'repairReceiptSha256':pin,'parentRuntimeFile':str(PARENT),'parentRuntimeSha256':PARENT_SHA,
    'definition':definition,'ordinaryRuntime':actual,'clock':state['parent']['clock'],'financialHandoff':state['parent']['financialHandoff'],
    'effectiveRuntime':state['parent']['effectiveRuntime'],'proxies':state['parent']['proxies'],'sourceRole':state['sourceRole'],
    'sourceDigest':state['parent']['sourceDigest'],'schema':state['parent']['schema'],'nativeBuild':state['parent']['nativeBuild'],
    'profile':state['parent']['profile'],'parentReferences':state['parent']['parentReferences'],'runtimeScope':state['parent']['runtimeScope'],
    'supportAtRecovery':state['support'],'stoppedCheckpoints':state['checkpoints'],
    'sourceRestarted':True,'sourceSelectionChanged':False,'nativeRowsDeleted':repaired['nativeRowsDeleted'],'checkpointRowsReset':1,'cacheRowsDeleted':0,
    'freeOnly':True,'paidAuthority':False,'permitIds':[],'sourceAndChainLeaseReleaseRequired':True}
   path=BASE/'runtime.json';runtime_pin=d.q.save(path,value)
   journal(d).emit('recovered_source_runtime_acknowledged',receiptFile=str(path),receiptSha256=runtime_pin,invocation=actual['invocation'])
  except BaseException as error:
   d.q.save(BASE/'start-failed.json',{'failure':d.normal.failure(error),'manualReconcileRequired':True,
    'automaticRetryAllowed':False,'sourceStartOutcomeMayBeUnknown':True})
   raise
 release={'runtimeReceiptSha256':runtime_pin,'sourceAndChainHandoverLeasesReleased':True}
 release_pin=d.q.save(BASE/'handover-released.json',release)
 return {'format':FORMAT,'runtimeReceiptFile':str(path),'runtimeReceiptSha256':runtime_pin,
  'leaseReleasedFile':str(BASE/'handover-released.json'),'leaseReleasedSha256':release_pin,'sourceStarted':True,
  'sourceSelectionChanged':False,'paidAuthority':False,'originalSourceExpiryUnchanged':True}


def validate_current(receipt_file,receipt_sha):
 d=modules()
 if receipt_file!=str(BASE/'runtime.json'):fail('fixed_recovery_runtime_receipt_required')
 value=read(d,receipt_file,receipt_sha)
 parent=ancestry(d);repaired,reviewed=repair_receipt(d,value['repairReceiptSha256'])
 intent=read(d,BASE/'start-intent.json');definition=read(d,BASE/'recovery-definition.json')
 ack=journal(d).latest('recovered_source_runtime_acknowledged')
 if (value.get('format')!=FORMAT or value.get('parentRuntimeSha256')!=PARENT_SHA or
     value.get('sourceRestarted') is not True or value.get('sourceSelectionChanged') is not False or
     value.get('freeOnly') is not True or value.get('paidAuthority') is not False or value.get('permitIds')!=[] or
     value.get('definition')!=definition or value.get('clock')!=parent['clock'] or
     value.get('proxies')!=parent['proxies'] or value.get('financialHandoff')!=parent['financialHandoff'] or
     value.get('effectiveRuntime')!=parent['effectiveRuntime'] or value.get('sourceRole')!=parent['sourceRole'] or
     any(value.get(k)!=parent[k] for k in ['sourceDigest','schema','nativeBuild','profile','parentReferences','runtimeScope']) or
     intent.get('definitionSha256')!=definition['sha256'] or intent.get('repairReceiptSha256')!=value['repairReceiptSha256'] or
     ack is None or ack.get('receiptFile')!=receipt_file or ack.get('receiptSha256')!=receipt_sha or
     ack.get('invocation')!=value['ordinaryRuntime']['invocation'] or os.path.lexists(BASE/'start-failed.json') or
     read(d,BASE/'handover-released.json')!={'runtimeReceiptSha256':receipt_sha,'sourceAndChainHandoverLeasesReleased':True}):
  fail('exact_acknowledged_recovery_lineage_required')
 ancestor,_=d.selective.inherited(d)
 if definition!=d.selective.render_definition(d,ancestor,parent['clock'],value['repairReceiptSha256'],'selective',definition['maximumRuntimeSeconds']):
  fail('same_source_definition_with_only_remaining_lifetime_required')
 actual=d.selective.runtime(d,definition,parent['clock'],'selective',saved=value['ordinaryRuntime'])
 d.ordinary.source_health()
 peer=source_state(d.q,d.qe,d.native,parent['sourceRole'],running=True)
 return {**value,'ordinaryRuntime':actual,'checkpoints':peer['checkpoints'],'leaseReleasedFile':str(BASE/'handover-released.json')}


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 group=parser.add_mutually_exclusive_group()
 for name in ['rehearse','apply','start','validate']:group.add_argument('--'+name)
 args=parser.parse_args()
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('fixed_main_root_required')
 d=modules();d.q.actual_root_capabilities();os.umask(0o077)
 def interrupted(*_):raise InterruptedError('bounded_BNB_native_recovery_interrupted')
 for sig in [signal.SIGALRM,signal.SIGTERM,signal.SIGINT]:signal.signal(sig,interrupted)
 signal.alarm(600)
 try:
  if args.rehearse:result=repair(d,args.rehearse,False)
  elif args.apply:result=repair(d,args.apply,True)
  elif args.start:result=start(d,args.start)
  elif args.validate:result=validate_current(str(BASE/'runtime.json'),args.validate)
  else:
   value=review(d);result={'reviewHash':sha(encoded(value)),'binding':value}
  print(json.dumps(result,sort_keys=True))
 finally:signal.alarm(0)

if __name__=='__main__':
 try:main()
 except BaseException as error:
  print(json.dumps({'format':FORMAT,'failed':True,'failure':str(error) if isinstance(error,RuntimeError) and re.fullmatch('[a-zA-Z0-9_]+',str(error)) else type(error).__name__,
   'automaticRetryAllowed':False},sort_keys=True))
  raise SystemExit(1)
