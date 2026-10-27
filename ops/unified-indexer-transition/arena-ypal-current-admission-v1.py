#!/usr/bin/env python3
"""Exact current Arena9/240 admission; static default, explicit review/rollback/commit.

Historical actors, catalogs and operators are immutable ancestry. Only the
reviewed ambient trigger extension and current source fence are new predicates.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import time
import types

FORMAT = 'yunipals-arena-ypal-current-admission-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS / 'arena-ypal-current-admission-v1.py'
BASE = Path('/var/backups/yunipals-arena-ypal-current-admission-v1-20261024')
REHEARSAL = Path('/var/backups/yunipals-arena-ypal-current-rehearsal-v1-20261024')
PROPOSAL = OPS / 'arena-ypal-current-admission-v1.proposal.json'
PROPOSAL_SHA = '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4'
PINS = {
    'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd',
    'arena-ypal-native-v2.admission.py': '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e',
    'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80',
    'ypal-alchemy-consumer-current-context-v1.py': '70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420'}
CURRENT_CATALOG = Path('/var/backups/yunipals-arena-existing-default-review-20261024/review-20261024T215100Z-3843882/ambient-current-catalog.json')
CURRENT_CATALOG_SHA = 'b709ebaf92d05a92e89781bf329506ef85e7a2ca77830df1fb80c41c048685aa'
GENERATOR_PROOF = CURRENT_CATALOG.with_name('Ponder-generator-proof.json')
INVENTORY_SHA = 'ebeb5a3f1ab9a2152500ff7bf859b81e62101fe8b15b9c0e4d5bb51d5b40da40'
RUNTIME = Path('/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer/node_modules/ponder')
GENERATORS = {'dist/esm/database/actions.js': '03d03f76f79821baebf36064d48f5469dd3f3e496a6aa12a7e5d4e2fc1463110',
              'dist/esm/drizzle/onchain.js': '475cb1fb8f64d77c98070ada1144caec407ecfc80805bd37b885427ca3bbc7c4'}


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def own_sha(): return sha(Path(__file__).read_bytes())
def read(path, expected=None, maximum=2000000):
    path = Path(path)
    for part in [*path.parents, path]:
        row = part.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             'protected_current_admission_input_required')
    before = path.lstat()
    key = lambda row: tuple(getattr(row, k) for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
         'bounded_single_link_current_admission_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, maximum + 1)
        need(key(before) == key(os.fstat(fd)) == key(path.lstat()) and len(raw) == before.st_size,
             'current_admission_input_changed_during_read')
    finally: os.close(fd)
    need(expected is None or sha(raw) == expected, 'exact_current_admission_input_required')
    return raw

def load(name):
    path = OPS / name; raw = read(path, PINS[name]); result = types.ModuleType('current_arena_' + path.stem)
    result.__file__ = str(path); exec(compile(raw, str(path), 'exec'), result.__dict__); read(path, PINS[name]); return result

def ambient(doc):
    value = copy.deepcopy(doc)
    for key in ['sourceRole', 'readOnly', 'isolation']: value.pop(key)
    for row in [value['database'], *value['schemas']]: row['acl'] = [a for a in row['acl'] if a['granteeOid'] == 0]
    return value

def descriptor(row):
    return {**{k:v for k,v in row.items() if k != 'acl'},
        'publicExecuteCount': sum(a['granteeOid'] == 0 and a['privilege'] == 'EXECUTE' for a in row['acl']),
        'otherNonownerAclCount': sum(a['granteeOid'] not in {0,row['ownerOid']} for a in row['acl']),
        'aclSha256': sha(encoded(row['acl']))}

def validate_proposal(old, value):
    original = copy.deepcopy(value); acknowledgement = original.pop('currentAmbientAcknowledgement')
    original.update(format=old['format'], status=old['status'], sourceCatalogFile=old['sourceCatalogFile'],
                    sourceCatalogSha256=old['sourceCatalogSha256'])
    original['sourceReader']['existingAmbientAuthority'] = old['sourceReader']['existingAmbientAuthority']
    need(original == old and value['format'] == FORMAT + '-proposal' and value['sourceCatalogFile'] == str(CURRENT_CATALOG) and
         value['sourceCatalogSha256'] == CURRENT_CATALOG_SHA and acknowledgement['historicalProposalSha256'] == PINS['arena-ypal-native-v1.proposal.json'] and
         acknowledgement['originalCatalogSha256'] == old['sourceCatalogSha256'] and acknowledgement['originalFunctionCount'] == 2 and
         acknowledgement['addedGeneratedFunctionCount'] == 21 and acknowledgement['currentFunctionCount'] == 23 and
         acknowledgement['newDefaultAclCount'] == 0 and acknowledgement['sourceCurrentIntakeSha256'] == PINS['ypal-alchemy-consumer-current-context-v1.py'],
         'only_exact_current_ambient_extension_of_original_240_scope_allowed')
    rows = acknowledgement['functions']
    need(len(rows) == 23 and len({r['oid'] for r in rows}) == 23 and
         value['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions'] ==
         [{'oid':r['oid'],'securityDefiner':False} for r in rows] and
         all(r['schema'] == 'unified_ypal_20261023_v1' and r['ownerOid'] == 73004621 and r['language'] == 'plpgsql' and
             r['result'] == 'trigger' and r['signature'] == '' and r['securityDefiner'] is r['leakproof'] is False and
             r['config'] is None and r['publicExecuteCount'] == 1 and r['otherNonownerAclCount'] == 0 for r in rows) and
         sum(r['name'].startswith('operation_reorg__') for r in rows) == 21 and
         sum(len(w['requiredEdges']) for w in value['workers']) == 227 and len(value['sourceReader']['tables']) == 13,
         'exact_23_invoker_triggers_and_unchanged_227_plus13_reads_required')
    return value

def generator_current(proof):
    need(proof['inventorySha256'] == INVENTORY_SHA and proof['allMatched'] is True and proof['fileCount'] == 2 and
         set(proof['files']) == set(GENERATORS), 'actual_accepted_runtime_two_generator_proof_required')
    root = RUNTIME.resolve(strict=True)
    for relative, expected in GENERATORS.items():
        item = proof['files'][relative]; path = root / relative
        need(item['sha256'] == expected and item['acceptedInventoryMatched'] is True and
             str(path).endswith('/' + item['relativeRuntimePath']) and
             sha(read(path, expected)) == expected, 'same_two_installed_accepted_Ponder_generator_bytes_required')
    return True


def context_type(old):
    class Context(old.Context):
        def __init__(self):
            super().__init__()
            self.PINS = dict(self.PINS); self.PINS['arena-ypal-native-v1.proposal.json'] = PROPOSAL_SHA
            self.intake = load('ypal-alchemy-consumer-current-context-v1.py')
            self.source_binding = None; self.source_observations = []; self.completion = None
        def load_proposal(self):
            old_proposal = json.loads(read(OPS/'arena-ypal-native-v1.proposal.json', PINS['arena-ypal-native-v1.proposal.json']))
            value = validate_proposal(old_proposal, json.loads(read(PROPOSAL, PROPOSAL_SHA)))
            self.source_ambient(value)
            return value
        def source_ambient(self, proposal=None):
            value = json.loads(read(PROPOSAL, PROPOSAL_SHA)) if proposal is None else proposal
            saved = json.loads(read(CURRENT_CATALOG, CURRENT_CATALOG_SHA))
            baseline = json.loads(self.leaf.read(self.leaf.CATALOG_FILE, value['currentAmbientAcknowledgement']['originalCatalogSha256'], 1000000))['catalog']
            left, right = ambient(baseline), ambient(saved)
            need({k:v for k,v in left.items() if k!='functions'} == {k:v for k,v in right.items() if k!='functions'} and
                 right['functions'][:2] == left['functions'] and len(right['functions']) == 23 and
                 [descriptor(row) for row in right['functions']] == value['currentAmbientAcknowledgement']['functions'],
                 'only_exact_acknowledged_21_generated_functions_may_extend_ambient_catalog')
            proof = json.loads(read(GENERATOR_PROOF))
            need(proof == value['currentAmbientAcknowledgement']['generatorRuntimeProof'], 'same_actual_generator_capture_required')
            generator_current(proof)
            helper = self.leaf.module(self.leaf.CATALOG_HELPER, self.leaf.CATALOG_HELPER_SHA)
            current = json.loads(self.run(self.peer_args(5432,'yunipals_backfill'), helper.sql().encode(), timeout=12))
            need(ambient(current) == right, 'current_23_function_ambient_defaultACL_and_identities_must_match')
            return {'sourceCatalogSha256':CURRENT_CATALOG_SHA, 'sourceAmbientSha256':self.sha(self.encoded(right)),
                    'publicNonDefinerFunctions':[{'oid':r['oid'],'securityDefiner':False}for r in right['functions']],
                    'inputSha256':PROPOSAL_SHA}
        def full_source(self):
            observed = self.intake.observe_runtime(); binding = observed['binding']
            need(binding['intakeOnly'] is binding['currentWriterQualified'] is True and
                 binding['completionReceiptSha256'] == self.intake.RESULT_SHA and
                 binding['sourceEpoch'] == 'acknowledged-alchemy-completion', 'actual_full_current_source_intake_required')
            if self.source_binding is not None: need(binding == self.source_binding, 'source_epoch_or_dataset_changed_around_admission')
            else: self.source_binding = binding; self.completion = self.intake._completion()
            self.source_observations.append(observed['observation'])
            return binding
        def source_cas(self):
            need(self.source_binding is not None and int(time.time()*1000) + 5000 < self.source_binding['automaticReturnAtMs'],
                 'fresh_outer_source_fence_before_automatic_return_required')
            c = self.completion
            actor = c.h.restore.canonical_actor(c.h.source.actor(self.intake.UNIT))
            need(actor == self.source_binding['source'] and c.h.source.inputs() == c.owner.operation()['inputs'],
                 'same_current_source_actor_and_private_inputs_at_admission_CAS_required')
            c.loaded('paid'); native = c.h.source.native()
            need(native['schemaOid'] == self.source_binding['schemaOid'] and native['tables'] == self.source_binding['nativeTableIdentities'] and
                 native['cache'] == self.source_binding['syncCacheIdentity'] and native['app']['build_id'] == self.source_binding['buildId'],
                 'same_native44_cache_build_at_admission_CAS_required')
            return self.intake.sha(self.intake.encoded(self.source_binding))
        def context(self, proposal):
            began = time.monotonic()
            source_sha = self.source_cas()
            value = super().context(proposal)
            need(self.source_cas() == source_sha, 'source_actor_changed_during_held_admission_context')
            need(time.monotonic() - began < 12, 'current_context_must_fit_existing_15_second_held_transaction')
            return {**value, 'currentSourceBindingSha256':source_sha, 'sourceIntakeProducerSha256':PINS['ypal-alchemy-consumer-current-context-v1.py'],
                    'sourceCompletionReceiptSha256':self.intake.RESULT_SHA, 'oldWholeSourceValidatorPassed':False}
    # The actual unchanged inspect/rehearse bytecode dispatches this new typed
    # context. Only its output domain and producer file differ in this namespace.
    globals_ = {**old.__dict__, 'FORMAT':FORMAT+'-rehearsal', 'PRODUCER':FILE}
    for name in ['inspect','rehearse']:
        fn = getattr(old.Context,name)
        setattr(Context,name,types.FunctionType(fn.__code__,globals_,fn.__name__,fn.__defaults__,fn.__closure__))
    return Context


def business(context_factory):
    old = load('arena-ypal-native-v2.admission.py')
    result = types.ModuleType('current_Arena_admission_business')
    namespace = result.__dict__
    namespace.update({**old.__dict__, '__file__':str(FILE), 'FORMAT':FORMAT, 'BASE':BASE, 'REHEARSAL':REHEARSAL,
                      'RUNNER_SHA':own_sha(), 'runner':context_factory})
    for name, value in old.__dict__.items():
        if isinstance(value,types.FunctionType) and value.__module__ == old.__name__ and name != 'runner':
            namespace[name] = types.FunctionType(value.__code__,namespace,value.__name__,value.__defaults__,value.__closure__)
            namespace[name].__kwdefaults__ = value.__kwdefaults__
    return result


def create():
    old = load('arena-ypal-native-v2.context.py'); cls = context_type(old)
    return cls(), business(cls)


def acknowledgement(receipt_sha):
    """Authenticate the durable admission chain, with no current writer claim."""
    h,n = create()
    result = json.loads(read(BASE/'result.json', receipt_sha)); intent = n.saved(h,BASE/'intent.json')
    need(intent['format'] == FORMAT and intent['operatorSha256'] == own_sha() and
         intent['reviewHash'] == h.sha(h.encoded({k:v for k,v in intent.items() if k!='reviewHash'})) and
         intent['proposalSha256'] == PROPOSAL_SHA and intent['acknowledgedCurrentActors'] == h.acknowledged(),
         'actual_current_admission_intent_and_recorded_actor_ancestry_required')
    prior = json.loads(read(REHEARSAL/'review.json',intent['rehearsalReviewSha256']))
    rollback = json.loads(read(REHEARSAL/'result.json',intent['rehearsalResultSha256']))
    need(prior['status']=='readonly_review_passed' and prior['binding']['operatorSha256']==own_sha() and
         prior['reviewHash']==h.sha(h.encoded(prior['binding'])) and rollback['status']=='rollback_rehearsal_passed' and
         rollback['reviewHash']==prior['reviewHash'] and prior['binding']['context']==intent['context'] and
         prior['binding']['catalogSha256']==intent['catalogSha256'] and intent['rollbackOperatorSha256']==own_sha(),
         'actual_same_current_review_and_rollback_chain_required')
    rollback_intent=n.saved(h,REHEARSAL/'rehearsal-intent.json')
    need(rollback_intent=={'reviewHash':prior['reviewHash'],'operatorSha256':own_sha(),'commitAllowed':False} and
         len(rollback['rehearsals'])==2 and all(
             row['sqlSha256']==h.PINS[name] and row['catalogUnchanged'] is True and row['rolesAbsentAfterRollback']==count
             for row,name,count in zip(rollback['rehearsals'],['operational-roles.current.sql.review','arena-ypal-native-v1.source.sql.review'],[8,1])),
         'both_exact_owned_rollback_boundaries_required')
    parts = {}
    for scope in n.SCOPES:
        prepared=n.saved(h,BASE/(scope+'-prepared.json')); commit=n.saved(h,BASE/(scope+'-commit-intent.json'))
        part=n.saved(h,BASE/(scope+'-result.json')); attempted=n.saved(h,BASE/(scope+'-intent.json'))
        backend=prepared['catalog']['markers']; sql_name='operational-roles.current.sql.review' if scope=='operational' else 'arena-ypal-native-v1.source.sql.review'
        need(prepared['format']==FORMAT and prepared['scope']==scope and type(backend['backendPid']) is int and backend['backendPid']>0 and
             commit=={'preparedSha256':h.sha(h.encoded(prepared)),'backendPid':backend['backendPid'],'backendStart':backend['backendStart']} and
             attempted=={'format':FORMAT,'scope':scope,'sqlSha256':h.PINS[sql_name],'reviewHash':intent['reviewHash']} and
             part['commitOutcome']=='commit_confirmed' and part['roles']==prepared['roles'] and
             part['preparedSha256']==commit['preparedSha256'] and part['sqlSha256']==h.PINS[sql_name],
             'exact_acknowledged_prepared_OIDs_and_backend_epoch_chain_required')
        parts[scope]=part
    need(result==n.final_receipt(h,intent,parts), 'actual_current_admission_receipt_recomputation_required')
    return {'format':FORMAT+'-acknowledgement','validated':True,'receiptSha256':receipt_sha,'operatorSha256':own_sha(),
            'proposalSha256':PROPOSAL_SHA,'recordedInitialSourceBindingSha256':intent['context']['currentSourceBindingSha256'],
            'roles':result['roles'],'sourceRole':result['sourceRole'],'recordedAdmissionQualified':True,
            'currentRoleGraphQualified':False,'sourceActorQualified':False,'currentWriterQualified':False,
            'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def verify_current(receipt, *, phase='admitted', password_sha256=None):
    """Current owned role/catalog phase; never invokes the initial paid source."""
    h,n=create()
    need(receipt == json.loads(read(BASE/'result.json')), 'exact_own_current_admission_receipt_required')
    acknowledgement(sha(read(BASE/'result.json')))
    value=n.verify_current(receipt,phase=phase,password_sha256=password_sha256)
    return {**value,'currentRoleGraphQualified':True,'sourceActorQualified':False,'currentWriterQualified':False,
            'financialAuthorityQualified':False,'serviceActions':0,'providerCalls':0}


def validate_catalog_current(receipt_sha, *, phase='admitted', password_sha256=None):
    value=acknowledgement(receipt_sha)
    current=verify_current(json.loads(read(BASE/'result.json',receipt_sha)),phase=phase,password_sha256=password_sha256)
    return {**value,'currentRoleGraphQualified':True,'phase':phase,'catalogs':current['catalogs']}

def sources():
    return {'format':FORMAT+'-sources', 'producerSha256':own_sha(), 'proposalSha256':PROPOSAL_SHA, 'dependencies':PINS,
            'unchangedSqlSha256':{'operational':'310b817daf1ee7254e54d21a783334638d3ef58aee3c430dd10f4991a704d9b3',
                                 'source':'a045f16cd35135d6ae60c522f39bbefe50a683d57906482e78597edec9ca1c45'},
            'newRoles':9,'requiredEdges':240,'loginChanges':0,'credentialWrites':0,'sourceSelectionsChanged':0}

def checked_manifest():
    need(json.loads(read(FILE.with_suffix('.manifest.json'))) == sources(), 'exact_current_admission_external_manifest_required')

def print_summary(**fields):
    print(json.dumps({'format':FORMAT, **fields,'loginChanges':0,'credentialWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True))

def main():
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group()
    group.add_argument('--sources',action='store_true');group.add_argument('--review',action='store_true');group.add_argument('--rehearse')
    group.add_argument('--admission-review',action='store_true');group.add_argument('--commit');group.add_argument('--reconcile',action='store_true')
    args=parser.parse_args()
    if args.sources: print(json.dumps(sources(),sort_keys=True));return
    if not any([args.review,args.rehearse,args.admission_review,args.commit,args.reconcile]):
        print_summary(sourceOnly=True,databaseWrites=0,roleChanges=0);return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main' and Path(__file__).absolute()==FILE,'fixed_current_admission_host_and_source_required')
    os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_current_admission_expired'));signal.alarm(300);checked_manifest()
    h,n=create();h.full_source()
    if args.review:
        need(not os.path.lexists(REHEARSAL) and not os.path.lexists(BASE),'fresh_current_admission_review_required')
        _,_,_,_,binding=h.inspect();h.full_source();value={'format':FORMAT+'-rehearsal','status':'readonly_review_passed','reviewHash':h.sha(h.encoded(binding)),'binding':binding}
        REHEARSAL.mkdir(mode=0o700);n.save(h,REHEARSAL/'review.json',value)
        print_summary(reviewed=True,reviewHash=value['reviewHash'],reviewSha256=sha(read(REHEARSAL/'review.json')),databaseWrites=0,roleChanges=0);return
    saved_review=n.saved(h,REHEARSAL/'review.json')
    if args.rehearse:
        need(not os.path.lexists(REHEARSAL/'result.json') and not os.path.lexists(REHEARSAL/'rehearsal-intent.json') and not os.path.lexists(BASE),'one_current_rollback_rehearsal_required')
        proposal,sqls,roles,before,binding=h.inspect()
        need(saved_review['binding']==binding and saved_review['reviewHash']==args.rehearse,'same_current_review_before_rollback_required')
        n.save(h,REHEARSAL/'rehearsal-intent.json',{'reviewHash':args.rehearse,'operatorSha256':own_sha(),'commitAllowed':False})
        result=h.rehearse(proposal,sqls,roles,before,binding,args.rehearse);h.full_source();n.save(h,REHEARSAL/'result.json',result)
        print_summary(rehearsed=True,resultSha256=sha(read(REHEARSAL/'result.json')),persistentRoleChanges=0,databaseCommitted=False);return
    if args.reconcile:
        result=n.reconcile(h);h.full_source();print_summary(commitOutcome=result['commitOutcome'],resultSha256=sha(read(BASE/'result.json')),reconciled=True);return
    proposal,sqls,binding=n.review(h,sha(read(REHEARSAL/'review.json')),sha(read(REHEARSAL/'result.json')))
    if args.admission_review:
        h.full_source();print_summary(reviewed=True,reviewHash=binding['reviewHash'],roleChanges=0,databaseWrites=0);return
    need(args.commit==binding['reviewHash'] and not os.path.lexists(BASE),'one_fresh_exact_current_admission_commit_required')
    BASE.mkdir(mode=0o700);n.save(h,BASE/'intent.json',binding);parts={}
    try:
        for scope,raw in zip(n.SCOPES,sqls):parts[scope]=n.boundary(h,proposal,scope,raw,binding)
        need(h.context(proposal)==binding['context'],'current_context_must_remain_exact_after_both_commits');h.full_source()
        result=n.final_receipt(h,binding,parts);n.verify_current(result);n.save(h,BASE/'result.json',result)
        print_summary(commitOutcome='commit_confirmed',resultSha256=sha(read(BASE/'result.json')),roleCount=9,requiredEdges=240,databaseBoundariesAtomic=False)
    except BaseException as error:
        n.save(h,BASE/'failed.json',{'format':FORMAT,'commitOutcome':'partial_or_unknown','acknowledgedDatabaseBoundaries':parts,'errorClass':type(error).__name__,'automaticRetryAllowed':False,'rawMessagesExported':False});raise


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print_summary(completed=False,errorClass=type(error).__name__,automaticRetryAllowed=False);raise SystemExit(1)
