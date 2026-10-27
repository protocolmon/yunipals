#!/usr/bin/env python3
"""Explicit 120-second continuation authority; native policy binding is mandatory."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import re
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-cache-continuation-authority-v6.py'
FORMAT='yunipals-ypal-ordinary-cache-continuation-authority-v6'
BASE=Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v6-20261026')
INPUT=Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-input-v6-20261026/input.json')
MANIFEST=OPS/'ypal-ordinary-cache-continuation-authority-v6.manifest.json'
FORWARD='ypal-ordinary-cache-continuation-authority-v5.py'
POLICY='ypal-native-metadata-readiness-policy-v2.py'
POLICY_MANIFEST='ypal-native-metadata-readiness-policy-v2.manifest.json'
POLICY_FORMAT='yunipals-native-metadata-readiness-policy-v2'
TTL_NS=120_000_000_000
COMMIT_RESERVE_NS=5_000_000_000
SOURCE_PINS={'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-ordinary-cache-callback-timing-v5.py': 'c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb', 'ypal-ordinary-cache-continuation-authority-v1.py': 'c413474538ad61e21b5d41736b1ca86687c2b4540639a1a760b4993ae2438dd7', 'ypal-ordinary-cache-continuation-authority-v2.py': '6ab6b0ae7e0bff7107cee6c50a709de631e505c1acef101a34ce9ec6290e303f', 'ypal-ordinary-cache-continuation-authority-v3.py': '0446dea37801f282c97d613ded19f75491925487fddbea5dc25441a1733b5ca7', 'ypal-ordinary-cache-continuation-authority-v4.py': '938b15ee463f7c950828eadeac3e599305d01dbfd8b8ddccd8a974f88b31a240', 'ypal-ordinary-cache-continuation-authority-v5.manifest.json': '2b19fe520f291ef01bc2133b18e0fe9406c6a67a0eeae55067ee1dc5fa399d78', 'ypal-ordinary-cache-continuation-authority-v5.py': 'd95bbcceb812dd7d3acc9e828a78f6125870a021dbfeed952f6c477f48003bef', 'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-metadata-current-effect-v1.py': '9d79c54f8828f36a120241c61a36e28a4c3423731a87fc8824aaecdf7c9305c7', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-ordinary-metadata-current-epoch-v2.py': '3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b', 'ypal-ordinary-metadata-current-epoch-v3.py': '33ae8619fe0a43b94745b1a00ae57db166592c83ccf6a997d50cd8c583fdff51', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-ordinary-read-cache-continue-v1.py': 'e4b0a18fc1358a04da6a6a47c8363d193836d23493a28f6c09a1780e3dadc06e', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9'}


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None


def public(path,digest=None):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_explicit120_authority_file_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=4000000 and
        all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
        (digest is None or pin(digest)and sha(raw)==digest),'same_actual_explicit120_authority_file_required')
    return raw


def authenticate():
    expected={'format':FORMAT+'-source','files':{FILE.name:sha(public(FILE)),**SOURCE_PINS}}
    need(json.loads(public(MANIFEST))==expected,'actual_explicit120_authority_manifest_required')
    for name,digest in expected['files'].items():public(OPS/name,digest)


def module(name):
    value=types.ModuleType('explicit120_'+Path(name).stem.replace('-','_'));value.__file__=str(OPS/name)
    exec(compile(public(OPS/name,SOURCE_PINS[name]),str(OPS/name),'exec'),value.__dict__);return value


def refs3(value):
    need(type(value)is dict and set(value)=={'producerSha256','manifestSha256','resultSha256'}and all(pin(item)for item in value.values()),
        'exact_actual_native120_policy_refs3_required');return copy.deepcopy(value)


def policy_module(refs):
    raw=public(OPS/POLICY,refs['producerSha256']);tree=ast.parse(raw)
    pins=[node.value for node in tree.body if isinstance(node,ast.Assign)and len(node.targets)==1 and
        isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
    need(len(pins)==1,'native120_policy_literal_source_map_required');upstream=ast.literal_eval(pins[0])
    need(type(upstream)is dict and 0<len(upstream)<=512 and FILE.name not in upstream and POLICY not in upstream and
        all(type(name)is str and Path(name).name==name and pin(digest)for name,digest in upstream.items()),
        'finite_upstream_only_native120_policy_before_evaluation_required')
    expected={'format':POLICY_FORMAT+'-source','files':{POLICY:refs['producerSha256'],**upstream}}
    need(json.loads(public(OPS/POLICY_MANIFEST,refs['manifestSha256']))==expected,'exact_actual_native120_policy_manifest_required')
    for name,digest in expected['files'].items():public(OPS/name,digest)
    value=types.ModuleType('actual_native120_policy');value.__file__=str(OPS/POLICY)
    exec(compile(raw,str(OPS/POLICY),'exec'),value.__dict__)
    need(value.FORMAT==POLICY_FORMAT and callable(value.acknowledgement)and callable(value.current),
        'actual_fixed_native120_policy_API_required');return value


def callback_guard(previous,cache,dispatch,replacement):
    """Retain the actual complete callback wrapper, replacing its owner cell."""
    raw=public(OPS/'ypal-ordinary-read-cache-continue-v1.py',SOURCE_PINS['ypal-ordinary-read-cache-continue-v1.py'])
    node=ast.parse(raw);namespace=next(item for item in node.body if isinstance(item,ast.FunctionDef)and item.name=='namespace')
    runtime=next(item for item in namespace.body if isinstance(item,ast.FunctionDef)and item.name=='cache_runtime')
    function=copy.deepcopy(next(item for item in runtime.body if isinstance(item,ast.FunctionDef)and item.name=='sql_child'))
    wrapper=ast.parse('def build(authority,cache,launch):\n pass').body[0]
    wrapper.body=[function,ast.Return(value=ast.Name(id='sql_child',ctx=ast.Load()))]
    scope={};exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapper],type_ignores=[])),str(FILE),'exec'),scope)
    expected=scope['build'](previous,cache,None)
    need(type(dispatch)is types.FunctionType and previous.code_identity(dispatch.__code__)==previous.code_identity(expected.__code__),
        'complete_original_prepared_callback_authority_wrapper_required')
    cells=dict(zip(dispatch.__code__.co_freevars,dispatch.__closure__ or()))
    need(set(cells)=={'authority','cache','launch'}and cells['authority'].cell_contents is previous and cells['cache'].cell_contents is cache,
        'same_actual_cache_facade_and_original_launch_closure_required')
    def cell(value):return(lambda:value).__closure__[0]
    closure=tuple(cell(replacement)if key=='authority'else cells[key]for key in dispatch.__code__.co_freevars)
    return types.FunctionType(dispatch.__code__,dispatch.__globals__,dispatch.__name__,dispatch.__defaults__,closure)


class Context:
    """Distinct scope over complete C5 bodies; no old90 receipt can qualify it.

    A policy-aware caller must construct its honest current context and baseline
    before binding. This component cannot waive the existing full source gates.
    """
    def __init__(self,input_sha):
        authenticate();need(pin(input_sha),'actual_protected120_authority_input_SHA_required')
        self.input_sha=input_sha;self.config=json.loads(public(INPUT,input_sha))
        need(type(self.config)is dict and set(self.config)=={'format','nativePolicyRefs'}and self.config['format']==FORMAT+'-input',
            'exact_explicit120_authority_input_required')
        self.refs=refs3(self.config['nativePolicyRefs']);self.policy=policy_module(self.refs)
        self.ack=self.policy.acknowledgement(self.refs['resultSha256'])
        self.bound_cache=self.bound_host=None
        # Loading the real wrapper afresh creates its own complete C5/C413
        # globals; no existing module or frozen receipt is changed.
        wrapper=module(FORWARD);self.value=wrapper.composition()
        need(self.value.TTL_NS==90_000_000_000 and self.value.COMMIT_RESERVE_NS==COMMIT_RESERVE_NS,
            'exact_original90_scope_and_unchanged_five_second_ACK_tail_required')
        self.shared_policy(self.ack,True)
        self.original_identity=self.value.new_identity;original_snapshot=self.value.approval_snapshot
        old_error='actual_official_approval_must_be_current_inside_unchanged_ninety_second_TTL'
        need(original_snapshot.__code__.co_consts.count(old_error)==1,'one_original_approval_expiry_diagnostic_required')
        code=original_snapshot.__code__.replace(co_consts=tuple(
            'actual_official_approval_must_be_current_inside_explicit_120_second_TTL'if item==old_error else item
            for item in original_snapshot.__code__.co_consts))
        self.original_snapshot=types.FunctionType(code,original_snapshot.__globals__,original_snapshot.__name__,
            original_snapshot.__defaults__,original_snapshot.__closure__)
        self.value.FILE=FILE;self.value.FORMAT=FORMAT;self.value.BASE=BASE;self.value.MANIFEST=MANIFEST
        self.value.SOURCE_PINS=SOURCE_PINS;self.value.TTL_NS=TTL_NS
        self.value.new_identity=self.identity;self.value.approval_snapshot=self.approval_snapshot
        self.value.composition=lambda:self.value
        self.readiness=None

    def bind_readiness(self,readiness):
        need(self.readiness is None and self.bound_cache is None and readiness.refs==self.refs,
            'one_same_native120_context_before_family6_binding_required')
        readiness.binding();self.readiness=readiness
        value=self.value
        value.NEW=OPS/'ypal-ordinary-read-cache-continue-v6.py'
        value.NEW_FORMAT='yunipals-ypal-ordinary-read-cache-continue-v6'
        value.NEW_BASE=Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v6-20261026')
        fn=value.qualification_key
        replacements={'ypal-ordinary-publication-continue-v5.py':'ypal-ordinary-publication-continue-v6.py',
            'ypal-ordinary-reader-continue-v5.py':'ypal-ordinary-reader-continue-v6.py'}
        need(all(fn.__code__.co_consts.count(old)==1 for old in replacements),
            'two_exact_family6_qualification_producer_identity_constants_required')
        value.qualification_key=types.FunctionType(fn.__code__.replace(co_consts=tuple(replacements.get(item,item)
            if type(item)is str else item for item in fn.__code__.co_consts)),fn.__globals__,fn.__name__,fn.__defaults__,fn.__closure__)
        raw=public(OPS/'ypal-ordinary-cache-continuation-authority-v1.py',SOURCE_PINS['ypal-ordinary-cache-continuation-authority-v1.py'])
        tree=ast.parse(raw);method=copy.deepcopy(next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='original_catalog'))
        count=0
        for node in ast.walk(method):
            if isinstance(node,ast.Call)and ast.unparse(node)=="host.read.acl_catalog(before['catalog']['postProof']['catalog'])":
                node.args[0]=ast.parse("_readiness.catalog_expectation(before['catalog']['postProof']['catalog'])",mode='eval').body;count+=1
        need(count==1,'one_historical_expected_READ_catalog_operand_in_original_full_catalog_body_required')
        scope={**value.original_catalog.__globals__,'_readiness':readiness}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[method],type_ignores=[])),str(FILE),'exec'),scope)
        value.original_catalog=scope['original_catalog']
        return value

    def shared_policy(self,value,immutable):
        need(type(value)is dict and value['operatorSha256']==self.refs['producerSha256']and value['receiptSha256']==self.refs['resultSha256']and
            type(value['policyTTLSeconds'])is int and value['policyTTLSeconds']==120 and
            value['readSchema']==self.value.READ_SCHEMA and value['readIdentity']==self.value.READ_IDENTITY and
            value['approvedImplementation']==self.value.APPROVED_IMPLEMENTATION and value['immutableAcknowledgementOnly']is immutable and
            value['originalCreatorWholeValidatorPassed']is False and
            all(pin(value[key])for key in['inputSha256','operationSha256','functionBodySha256','beforeCatalogSha256','afterCatalogSha256']),
            'actual_owned_native120_SQL_policy_and_unchanged_dataset_implementation_required')
        return value

    def inputs(self):
        authenticate();need(json.loads(public(INPUT,self.input_sha))==self.config and
            self.policy.acknowledgement(self.refs['resultSha256'])==self.ack,'same_actual_native120_input_and_immutable_policy_ACK_required')
        self.shared_policy(self.ack,True)

    def identity(self,cache,host):
        self.inputs();need(getattr(host,'cache',None)is cache and not getattr(host,'inverse_mode',False)and not getattr(cache,'inverse_mode',False)and
            (self.bound_cache is None or self.bound_cache is cache and self.bound_host is host),
            'one_actual_forward_cache_Host_for_native120_authority_required')
        value=self.original_identity(cache,host)
        return{**value,'approvalScopeNanoseconds':TTL_NS,'literalACKTailNanoseconds':COMMIT_RESERVE_NS,
            'nativeReadinessPolicyRefs':copy.deepcopy(self.refs),'nativeReadinessPolicyInputSha256':self.ack['inputSha256'],
            'nativeReadinessPolicyOperationSha256':self.ack['operationSha256'],'nativeReadinessFunctionBodySha256':self.ack['functionBodySha256'],
            'authorityInputSha256':self.input_sha,'old90SecondQualificationClaimed':False}

    def approval_snapshot(self,host):
        self.inputs();current=self.policy.current(self.refs['resultSha256'],host);self.shared_policy(current,False)
        need(current['validated']is current['actualPolicyBodyCurrent']is True and
            all(current[key]==self.ack[key]for key in['inputSha256','operationSha256','functionBodySha256','beforeCatalogSha256','afterCatalogSha256'])and
            current['databaseWrites']==current['serviceActions']==current['providerCalls']==0,
            'actual_current_native120_function_body_required_before_new120_approval')
        gate=self.original_snapshot(host)
        need(gate['ttlNanoseconds']==TTL_NS and gate['officialApprovalRefreshedByThisGate']is False,
            'actual120_approval_query_not_refreshed_or_old90_relabelled')
        return{**gate,'nativeReadinessPolicyRefs':copy.deepcopy(self.refs),'nativeReadinessFunctionBodySha256':current['functionBodySha256'],
            'nativePolicyCurrentProof':copy.deepcopy(current),'old90SecondQualificationClaimed':False}

    def bind(self,cache,host):
        need(self.bound_cache is None and getattr(cache,'approval_window_context',None)is None,'one_explicit120_binding_per_cache_Context_required')
        self.identity(cache,host)
        previous=cache.continuation_authority;raw=cache._sql_child
        expected=previous.bounded_sql_parent(cache.prior_cache._sql_child,cache.prior_cache._sql_child)
        need(previous.code_identity(raw.__code__)==previous.code_identity(expected.__code__)and raw.__defaults__==expected.__defaults__ and
            raw.__closure__==expected.__closure__,'complete_original_C5_SQL_parent_before_explicit120_hooks_required')
        dispatch=callback_guard(previous,cache,cache.sql_child,self.value)
        cache._sql_child=types.FunctionType(raw.__code__,{**raw.__globals__,
            'continuation_approval_before_launch':lambda actual_host,mode:self.value.approval_before_launch(cache,actual_host,mode),
            'continuation_ack_deadline':lambda actual_host,mode:self.value.ack_deadline(cache,actual_host,mode)},raw.__name__,raw.__defaults__,raw.__closure__)
        cache.continuation_authority=self.value
        cache.sql_child=dispatch
        cache.stopped=lambda actual_host:self.value.stopped(cache,actual_host)
        cache.approval_window_context=self;self.bound_cache=cache;self.bound_host=host
        return self.value


if __name__=='__main__':
    print(json.dumps({'format':FORMAT,'staticOnly':True,'policyTTLSeconds':120,'literalACKTailSeconds':5,
        'actualNativePolicyOrQualificationClaimed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
