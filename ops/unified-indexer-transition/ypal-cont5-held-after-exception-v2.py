#!/usr/bin/env python3
"""Post-failure witness for the actual CONT5 facade and composed qualifier.

No live tracing, profiling, function/transport replacement or business dispatch.
The actual cache authority object remains distinct from its function namespace.
"""
import ast
import copy
import hashlib
import json
from pathlib import Path
import stat
import types

FORMAT='yunipals-ypal-cont5-held-after-exception-v2'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FROZEN='ypal-cont5-held-after-exception-v1.py'
AUTHORITY='ypal-ordinary-cache-continuation-authority-v5.py'
SOURCE_PINS={'ypal-cont5-held-after-exception-v1.py': 'ba7e2570888811d741be95d53826e9dd1e71ad5beb3d89cb55cdff1e1c4925c1', 'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-ordinary-cache-callback-timing-v5.py': 'c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb', 'ypal-ordinary-cache-continuation-authority-v1.py': 'c413474538ad61e21b5d41736b1ca86687c2b4540639a1a760b4993ae2438dd7', 'ypal-ordinary-cache-continuation-authority-v2.py': '6ab6b0ae7e0bff7107cee6c50a709de631e505c1acef101a34ce9ec6290e303f', 'ypal-ordinary-cache-continuation-authority-v3.py': '0446dea37801f282c97d613ded19f75491925487fddbea5dc25441a1733b5ca7', 'ypal-ordinary-cache-continuation-authority-v4.py': '938b15ee463f7c950828eadeac3e599305d01dbfd8b8ddccd8a974f88b31a240', 'ypal-ordinary-cache-continuation-authority-v5.manifest.json': '2b19fe520f291ef01bc2133b18e0fe9406c6a67a0eeae55067ee1dc5fa399d78', 'ypal-ordinary-cache-continuation-authority-v5.py': 'd95bbcceb812dd7d3acc9e828a78f6125870a021dbfeed952f6c477f48003bef', 'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-metadata-current-effect-v1.py': '9d79c54f8828f36a120241c61a36e28a4c3423731a87fc8824aaecdf7c9305c7', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-ordinary-metadata-current-epoch-v2.py': '3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b', 'ypal-ordinary-metadata-current-epoch-v3.py': '33ae8619fe0a43b94745b1a00ae57db166592c83ccf6a997d50cd8c583fdff51', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9'}

def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def public(path,digest):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_fixed_facade_witness_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=4000000 and sha(raw)==digest and
        all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']),
        'same_actual_facade_witness_source_bytes_required')
    return raw
def evaluate(raw,path):
    value=types.ModuleType('fixed_facade_witness_'+Path(path).stem);value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);return value

def frozen():
    # Authenticate the entire old helper/authority source closure before even
    # evaluating the retained helper. No receipt, Host or current is constructed.
    raw=public(OPS/FROZEN,SOURCE_PINS[FROZEN])
    rows=[n for n in ast.parse(raw).body if isinstance(n,ast.Assign)and len(n.targets)==1 and
        isinstance(n.targets[0],ast.Name)and n.targets[0].id=='SOURCE_PINS']
    need(len(rows)==1 and SOURCE_PINS=={FROZEN:SOURCE_PINS[FROZEN],**ast.literal_eval(rows[0].value)},
        'complete_literal_frozen_witness_source_closure_required')
    for name,digest in SOURCE_PINS.items():
        need(Path(name).name==name and type(digest)is str and len(digest)==64,'finite_fixed_witness_source_map_required')
        public(OPS/name,digest)
    return evaluate(raw,OPS/FROZEN),raw

def reference_facade(base):
    # The old helper authenticates the exact authority manifest and every
    # source before evaluation. Here retain its facade rather than flattening.
    raw=public(OPS/AUTHORITY,SOURCE_PINS[AUTHORITY])
    manifest_name=base.AUTHORITY_MANIFEST
    manifest=json.loads(public(OPS/manifest_name,SOURCE_PINS[manifest_name]))
    files={name:digest for name,digest in base.SOURCE_PINS.items()if name!=manifest_name}
    need(manifest=={'format':base.AUTHORITY_FORMAT+'-source','files':files},
        'exact_complete_facade_authority_source_manifest_required')
    return evaluate(raw,OPS/AUTHORITY)

def qualifier_namespace(authority,expected,code_identity):
    need(type(authority)is types.ModuleType,'actual_fixed_authority_module_or_composed_namespace_required')
    direct=authority.__dict__.get('_qualify_held')
    if type(direct)is types.FunctionType and direct.__globals__ is authority.__dict__:
        return authority
    # Production utility.authority() returns load(Auth5), whose __getattr__
    # delegates to composition(). Never substitute an acknowledgement or cache.
    need(Path(authority.__file__)==Path(expected.__file__)==OPS/AUTHORITY,
        'actual_exact_authority_facade_source_file_required')
    identities=['OPS','FILE','FORMAT','BASE','MANIFEST','FROZEN','FROZEN_SHA','FACTORY','FACTORY_SHA','EPOCH','EPOCH_SHA','SOURCE_PINS']
    need(all(authority.__dict__.get(key)==expected.__dict__[key]for key in identities),
        'all_fixed_authority_facade_identity_globals_required')
    for name,reference in vars(expected).items():
        if type(reference)is not types.FunctionType:continue
        actual=authority.__dict__.get(name)
        need(type(actual)is types.FunctionType and actual.__globals__ is authority.__dict__ and
            code_identity(actual.__code__)==code_identity(reference.__code__)and
            actual.__defaults__==reference.__defaults__ and actual.__closure__==reference.__closure__,
            'complete_genuine_authority_facade_function_bodies_required')
    value=authority.composition()
    need(type(value)is types.ModuleType and value is authority.__dict__.get('_implementation')and
        value is not authority and authority._qualify_held is value._qualify_held and authority.qualify_held is value.qualify_held,
        'actual_current_facade_implementation_and_export_links_required')
    return value

def constructor(base,raw):
    cls=next(n for n in ast.parse(raw).body if isinstance(n,ast.ClassDef)and n.name=='Witness')
    fn=copy.deepcopy(next(n for n in cls.body if isinstance(n,ast.FunctionDef)and n.name=='__init__'))
    globals_changed=references=0
    class Scope(ast.NodeTransformer):
        def visit_Attribute(self,node):
            nonlocal globals_changed
            if ast.unparse(node)=='authority.__dict__':
                globals_changed+=1
                return ast.copy_location(ast.parse('namespace.__dict__',mode='eval').body,node)
            return self.generic_visit(node)
    fn=Scope().visit(fn)
    for index,node in enumerate(fn.body):
        if isinstance(node,ast.Assign)and ast.unparse(node)=='actual = authority._qualify_held':
            fn.body.insert(index,ast.parse('namespace=qualified_namespace(authority,expected)').body[0]);references+=1;break
    need(globals_changed==2 and references==1,'exact_two_composed_globals_and_one_facade_resolution_seam_required')
    scope={**vars(base),'reference':lambda:reference_facade(base),
        'qualified_namespace':lambda actual,expected:qualifier_namespace(actual,expected,base.code_identity)}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(OPS/'ypal-cont5-held-after-exception-v2.py'),'exec'),scope)
    return scope['__init__']

class Witness:
    """Inspect only the original propagated exception after business failure."""
    def __init__(self,error,authority):
        base,raw=frozen();constructor(base,raw)(self,error,authority)
        self.base=base
        self.facade_used=not(type(authority.__dict__.get('_qualify_held'))is types.FunctionType and
            authority.__dict__['_qualify_held'].__globals__ is authority.__dict__)

    def snapshot(self):
        return{**self.base.Witness.snapshot(self),'format':FORMAT,
            'frozenWitnessSourceSha256':SOURCE_PINS[FROZEN],
            'authorityFacadeUsed':self.facade_used,'actualCacheAuthorityObjectPreserved':True,
            'composedQualifierGlobalsQualified':True,'originalV1WitnessPassed':False}

if __name__=='__main__':
    print(json.dumps({'format':FORMAT,'staticOnly':True,'liveTraceInstalled':False,'liveProfileInstalled':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
