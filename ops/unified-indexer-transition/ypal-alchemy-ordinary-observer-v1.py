#!/usr/bin/env python3
"""Current READ143 observer composition; unchanged worker, pool2 and schedules."""
import ast
import hashlib
import json
from pathlib import Path
import types
import urllib.request

FORMAT='yunipals-ypal-alchemy-ordinary-observer-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
OLD=OPS/'ypal-restored-ordinary-observer-v1.py'
OLD_SHA='62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3'
BASE=Path('/var/backups/yunipals-ypal-alchemy-ordinary-observer-v1-20261024')
READ=OPS/'ypal-alchemy-read-admission-v1.py'
READ_SHA='c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a'
INTAKE=OPS/'ypal-alchemy-consumer-current-context-v1.py'
INTAKE_SHA='70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420'
INSTALL_ACK='2bc98b3ddf3fc26f044489ada6b4583d547dbabb3b161a5c417f44e25d98f972'
PROFILE_ID='0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff'
PORTS={1:19221,56:19224,137:19223,8453:19222}


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()

def frozen():
    import stat
    for p in [*OLD.parents,OLD]:
        s=p.lstat();need(s.st_uid==0 and not p.is_symlink()and not s.st_mode&0o022,'protected_frozen_observer_owner_required')
    raw=OLD.read_bytes();need(len(raw)<200000 and sha(raw)==OLD_SHA,'exact_62d_observer_before_evaluation_required');return raw


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*_):return None


def preflight(chain,port,workload):
    headers={'x-yunipals-unified-rpc-profile':PROFILE_ID,'x-yunipals-rpc-workload':workload}
    request=urllib.request.Request('http://127.0.0.1:'+str(port)+'/unified/preflight',headers=headers)
    with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(request,timeout=5)as response:
        raw=response.read(300001);need(response.status==200 and len(raw)<=300000,'bounded_current_observer_policy_GET_required');return json.loads(raw)


def namespace():
    tree=ast.parse(frozen());values={'FORMAT':repr(FORMAT),'BASE':'Path('+repr(str(BASE))+')','READ':'Path('+repr(str(READ))+')','READ_SHA':repr(READ_SHA)};changed=[]
    for node in tree.body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in values:
            key=node.targets[0].id;node.value=ast.parse(values[key],mode='eval').body;changed.append(key)
    need(set(changed)==set(values)and len(changed)==4,'exact_four_current_observer_identity_constants_required');ast.fix_missing_locations(tree)
    n=types.ModuleType('current_READ143_observer');n.__file__=str(Path(__file__).absolute());exec(compile(tree,n.__file__,'exec'),n.__dict__)
    def read_acknowledgement(read,expected):
        ack=read.acknowledgement(n.pin(expected))
        need(ack['validated']is ack['immutableAdmissionOnly']is True and ack['operatorSha256']==READ_SHA and ack['readEdgeCount']==143 and
             ack['sourceActorQualified']is ack['currentWriterQualified']is ack['currentRoleGraphQualified']is False,
             'actual_new_READ_recorded_chain_without_current_writer_claim_required')
        proof={'format':read.FORMAT,'validated':True,'receiptSha256':expected,'operatorSha256':READ_SHA,
               'planSha256':ack['planSha256'],'contextInputSha256':ack['contextInputSha256'],'sourceBinding':ack['recordedSourceBinding'],
               'catalogSha256':ack['catalogAfterSha256'],'originalWholeValidatorPassed':False,'consumerSelectionsQualified':False,
               'temporaryPackActorsQualified':False,'sourceReadinessQualified':False,'databaseWrites':0,'serviceActions':0}
        return {'qualificationAtActivation':proof,'initialSourceContext':proof['sourceBinding'],'immutableAdmissionOnly':True,
                'currentRoleGraphQualified':False,'sourceActorQualified':False,'currentWriterQualified':False}
    def data_matches_initial(data,initial):
        expected={k:initial[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId']}
        expected['nativeTableIdentitiesSha256']=n.sha(n.encoded(initial['nativeTableIdentities']))
        need(data==expected and data['sourceRelease']==n.RELEASE and data['manifestHash']==n.MANIFEST and data['schema']==n.NATIVE and
             data['schemaOid']=='75963410'and data['buildId']==n.BUILD and len(initial['nativeTableIdentities'])==44 and
             initial['sourceEpoch']=='acknowledged-alchemy-completion'and initial['intakeOnly']is True and
             initial['sourceReadinessQualified']is initial['currentCanonicalCoverageQualified']is False,
             'same_recorded_current_READ_native44_dataset_required');return data
    original_host=n.Host
    class Host(original_host):
        def __init__(self,read_ack,install_ack):
            need(install_ack==INSTALL_ACK,'actual_existing_ordinary_observer_install_ACK_required')
            super().__init__(read_ack,install_ack)
            self.activation_source=None
        def query(self,sql):
            # Inspection only. Same SDK role/DB/10s statement bound; avoid the
            # catalog JIT compile overhead without modifying worker SQL/config.
            return self.sdk.Host.peer_query(object.__new__(self.sdk.Host),
                'BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;SET LOCAL jit=off;'+sql+';ROLLBACK;')
        def initial_source(self):
            recorded=read_acknowledgement(self.read,self.read_ack);graph=self.read.validate_catalog_current(self.read_ack)
            need(graph['validated']is True and graph['catalogOnly']is True and graph['sourceActorQualified']is False,
                 'actual_current_READ143_full_catalog_before_observer_start_required')
            current=n.module(INTAKE,INTAKE_SHA).validate_runtime()
            need(current==recorded['initialSourceContext']and current['currentWriterQualified']is True,
                 'actual_initial70f_writer_and_recorded_READ_context_required')
            if self.activation_source is not None:need(current==self.activation_source,'initial_writer_changed_before_observer_start')
            self.activation_source=current;return recorded['qualificationAtActivation']
        def direct_routes(self):
            profile=n.document(n.PROFILE,n.PROFILE_SHA);gates=[]
            for chain,port in PORTS.items():
                for workload in ['unified_source','unified_evidence']:
                    reply=preflight(chain,port,workload)
                    wanted={'profileId':PROFILE_ID,'manifestHash':n.MANIFEST,'chainId':chain,'scope':profile['scope'],
                        'coordinatorId':profile['coordinatorId'],'workload':workload,'paid':'explicit_bounded_permit_only',
                        'replay':{'mode':'free_only'},'limits':profile['limits']}
                    need(all(reply.get(key)==value for key,value in wanted.items())and isinstance(reply.get('budget'),dict),
                         'exact_current_permit_free_observer_policy_lane_required');gates.append(wanted)
            return {'profileSha256':n.PROFILE_SHA,'gates':gates,'freeOnly':True,'paidAuthority':False,'permitHeaders':0,
                    'sourceActorQualified':False,'currentWriterQualified':False,'routeActorQualified':False}
        def manager(self,action):
            if action=='start':self.initial_source()
            return super().manager(action)
    n.Host=Host;n.read_acknowledgement=read_acknowledgement;n.data_matches_initial=data_matches_initial
    def review(h):
        n.absent(h);admitted=h.initial_source();initial=admitted['sourceBinding'];first=h.preserved();data_matches_initial(first['source']['dataIdentity'],initial)
        read_acknowledgement(h.read,h.read_ack);n.no_competing_observer(h);capacity=h.capacity();inspected=h.peer_inspect()
        rows=h.control();n.need(all(v['halted']is False for v in rows),'halted_source_requires_separate_resolution_before_observer_start')
        control_before={str(v['chainId']):v['revision']for v in rows}
        need(h.preserved()==first and h.initial_source()==admitted,'source_READ_or_observer_inputs_changed_during_initial_review');n.absent(h)
        binding={'format':FORMAT,'operatorSha256':n.sha(n.protected(Path(__file__).absolute())),'bootId':n.boot(),
            'readAdmissionSha256':h.read_ack,'initial143QualificationSha256':n.sha(n.encoded(admitted)),'initialSourceContext':initial,
            'dataIdentity':first['source']['dataIdentity'],'installationReceiptSha256':h.install_ack,'preserved':first,
            'runtimeMaximumSeconds':None,'automaticRestart':False,'bootEnablement':True,'ordinarySustainedObserver':True,
            'poolMaximum':2,'wholeReaderGraphRequiredAfterStart':False,'currentWriterQualifiedByObserver':False,
            'controlRevisionsBefore':control_before}
        return {'binding':binding,'reviewHash':n.sha(n.encoded(binding)),'capacity':capacity,'inspect':inspected,
                'providerRequests':0,'databaseWrites':0,'serviceActions':0}
    n.review=review
    return n


def acknowledgement(receipt_sha):return namespace().acknowledgement(receipt_sha)
def validate_current(receipt_sha):return namespace().validate_current(receipt_sha)

def main():
    import signal
    import sys
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'observerCurrentQualified':False,
            'sourceActorQualified':False,'currentWriterQualified':False,'databaseWrites':0,'serviceActions':0,'providerRequests':0}));return
    def expired(*_):raise RuntimeError('observer_owner_deadline_expired_inspect_no_retry')
    signal.signal(signal.SIGALRM,expired);signal.alarm(420)
    namespace().main()


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
