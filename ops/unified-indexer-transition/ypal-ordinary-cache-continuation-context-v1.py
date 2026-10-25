#!/usr/bin/env python3
"""Finite compile/identity seams for a new known-aborted cache continuation."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import re
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
HELPER=OPS/'ypal-ordinary-generation-accept-binding-v2.py'
HELPER_SHA='e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc'
OLD_PROVIDER=OPS/'ypal-ordinary-read-cache-accept-v2.py'
OLD_PROVIDER_SHA='8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834'
OLD_READER=OPS/'ypal-ordinary-reader-accept-v2.py'
OLD_READER_SHA='973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5'
OLD_BASE=Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-v2-20261025')
BOOT_ARCHIVE=OLD_BASE/'original-boot-link'
AUTHORITY='ypal-ordinary-cache-continuation-authority-v1.py'
AUTHORITY_MANIFEST='ypal-ordinary-cache-continuation-authority-v1.manifest.json'


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None


def public(path,digest=None,maximum=4000000):
    path=Path(path)
    for item in [*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_continuation_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
        all(getattr(before,key)==getattr(after,key)for key in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
        (digest is None or pin(digest)and sha(raw)==digest),'exact_unchanged_continuation_source_required')
    return raw


def load(path,digest):
    value=types.ModuleType('actual_continuation_'+Path(path).stem.replace('-','_'));value.__file__=str(path)
    exec(compile(public(path,digest),str(path),'exec'),value.__dict__);return value


def helper():return load(HELPER,HELPER_SHA)


def authority(manifest):
    """A fixed external program, authenticated by the caller's real manifest."""
    need(type(manifest)is dict and type(manifest.get('dependencies'))is dict,
        'explicit_authenticated_continuation_reader_manifest_required')
    pins={**manifest['dependencies'],**manifest['files']};digest=pins.get(AUTHORITY)
    need(pin(digest)and pin(pins.get(AUTHORITY_MANIFEST)),'actual_continuation_authority_and_source_manifest_refs_required')
    raw=public(OPS/AUTHORITY,digest)
    rows=[row for row in ast.parse(raw).body if isinstance(row,ast.Assign)and len(row.targets)==1 and
        isinstance(row.targets[0],ast.Name)and row.targets[0].id=='SOURCE_PINS']
    need(len(rows)==1,'one_literal_continuation_authority_source_map_required');source=ast.literal_eval(rows[0].value)
    need(type(source)is dict and 1<=len(source)<=512 and all(type(name)is str and name not in {'','.','..'}and
        '/'not in name and '\\'not in name and pin(value)for name,value in source.items()),'finite_continuation_authority_source_map_required')
    actual=json.loads(public(OPS/AUTHORITY_MANIFEST,pins[AUTHORITY_MANIFEST]));expected={AUTHORITY:digest,**source}
    need(type(actual)is dict and set(actual)=={'format','files'}and actual['format']=='yunipals-ypal-ordinary-cache-continuation-authority-v1-source'and
        actual['files']==expected and all(pins.get(name)==value for name,value in expected.items()),
        'exact_complete_continuation_authority_closure_in_reader_manifest_required')
    for name,value in expected.items():public(OPS/name,value)
    return load(OPS/AUTHORITY,digest)


def identity(node,values):
    """Only authenticated namespace globals and literal identity dictionaries."""
    if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in values:
        value=values[node.targets[0].id];node.value=ast.parse('Path('+repr(str(value))+')'if isinstance(value,Path)else repr(value),mode='eval').body
    if isinstance(node,ast.FunctionDef)and node.name in {'composition','composed'}:
        for row in ast.walk(node):
            if isinstance(row,ast.Dict):
                for index,key in enumerate(row.keys):
                    if isinstance(key,ast.Constant)and key.value in values:
                        value=values[key.value];row.values[index]=ast.parse('Path('+repr(str(value))+')'if isinstance(value,Path)else repr(value),mode='eval').body
    return node


class Chain:
    """Each new construction owns its globals; frozen modules stay untouched."""
    def __init__(self,base,file,identities,digests,transform=None,post=None):
        self.base,self.file,self.identities,self.digests=base,file,identities,set(digests)
        self.transform,self.post=transform,post;self.observed=[]
    def __getattr__(self,name):return getattr(self.base,name)
    def derive(self,raw,digest,filename,constants=None,overrides=None,transform=None):
        selected=digest in self.digests;functions=dict(overrides or {})
        if selected and any(isinstance(row,ast.FunctionDef)and row.name=='helper'for row in ast.parse(raw).body):functions['helper']=lambda:self
        def changed(node):
            node=transform(node)if transform else node
            if selected:node=identity(node,self.identities)
            return self.transform(node,digest)if selected and self.transform else node
        result=self.base.derive(raw,digest,self.file if selected else filename,constants,functions,changed)
        if selected:
            self.observed.append(digest)
            if self.post:self.post(result,digest)
        return result


def unwrap(value,stop):
    count=0
    while stop not in value.__dict__:
        need('composition'in value.__dict__ and count<8,'finite_actual_namespace_wrapper_chain_required')
        value=value.composition();count+=1
    return value


def archive_node(node,needle):
    count=0
    class Archive(ast.NodeTransformer):
        def visit_BinOp(self,row):
            nonlocal count
            if ast.unparse(row)==needle:
                count+=1;return ast.copy_location(ast.parse('Path('+repr(str(BOOT_ARCHIVE))+')',mode='eval').body,row)
            return self.generic_visit(row)
    return ast.fix_missing_locations(Archive().visit(copy.deepcopy(node))),count


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('continuation_context_is_a_static_source_utility')
    print(json.dumps({'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
