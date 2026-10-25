#!/usr/bin/env python3
"""New acceptance ancestry; genuine feature business and event gates retained."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-feature-context-continue-v2.py'
FORMAT='yunipals-ypal-ordinary-feature-handover-continue-v2'
OWNER='ypal-ordinary-feature-handover-continue-v2.py'
PROVIDER='ypal-ordinary-read-cache-continue-v2.py'
READER='ypal-ordinary-reader-continue-v2.py'
READER_MANIFEST='ypal-ordinary-reader-continue-v2.manifest.json'
PINNED={'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-ordinary-feature-context-bound-v1.py': '9c025c89b021b7cfd156b4094c030041152f46aa62305d8c80a641f505677118', 'ypal-ordinary-feature-context-v6.py': '743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635', 'ypal-ordinary-feature-handover-bound-v1.py': '2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f', 'ypal-ordinary-feature-handover-v6.py': '4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312', 'ypal-ordinary-generation-binding-v1.py': 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035'}
EXTERNAL={PROVIDER,READER,READER_MANIFEST,'ypal-ordinary-generation-accept-binding-v2.py'}
def template():
    path=OPS/'ypal-ordinary-feature-context-bound-v1.py';expected='9c025c89b021b7cfd156b4094c030041152f46aa62305d8c80a641f505677118'
    for item in [*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_continue_feature_template_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or hashlib.sha256(raw).hexdigest()!=expected or any(
        getattr(before,key)!=getattr(after,key)for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_continue_feature_template_required')
    value=types.ModuleType('continue_feature_template');value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);return value,raw


def helper():return template()[0].helper()


def exact_dependencies(value):
    valid=lambda pin:isinstance(pin,str)and __import__('re').fullmatch('[a-f0-9]{64}',pin)and pin!='0'*64
    if not(type(value)is dict and set(value)==set(PINNED)|EXTERNAL and all(valid(pin)for pin in value.values())and all(value[name]==pin for name,pin in PINNED.items())):
        raise RuntimeError('finite_actual_continue_feature_template_and_external_publication_sources_required')
    return dict(value)


def composition():
    frozen,raw=template();h=frozen.helper()
    return h.derive(raw,hashlib.sha256(raw).hexdigest(),FILE,
        {'FORMAT':FORMAT,'FILE':FILE,'OWNER':OWNER,'PROVIDER':PROVIDER,'READER':READER,'READER_MANIFEST':READER_MANIFEST,
         'PINNED':PINNED,'EXTERNAL':EXTERNAL},{'helper':helper,'exact_dependencies':exact_dependencies})


def metadata_ancestry(host):
    """The published reader owns this immutable metadata-epoch reference."""
    h=helper();ack=host.coordinator.acknowledgement(host.config['readerResultSha256'],host.config['readerManifestSha256'])
    h.need(ack['validated']is ack['immutableReaderAcknowledgementOnly']is True and
        ack['operatorSha256']==host.manifest['dependencies'][READER]and
        ack['receiptSha256']==host.config['readerResultSha256']and ack['manifestSha256']==host.config['readerManifestSha256'],
        'actual_new_continuation_reader_immutable_ACK_before_metadata_epoch_constructor_required')
    operation=host.b.document(host.coordinator.BASE/'operation.json',ack['operationSha256'])
    epoch=operation['binding']['metadata']['metadataEpoch'];refs=epoch['refs']
    h.need(type(refs)is dict and set(refs)=={'mode','resultSha256','inputSha256','producerSha256','manifestSha256'}and
        refs['mode']=='current'and all(h.pin(refs[key])for key in refs if key!='mode')and
        epoch['acknowledgement']['metadataInputSha256']==host.b.document(host.provider.INPUT,host.config['cacheInputsSha256'])['metadataInputSha256'],
        'actual_reader_owned_upgrade_epoch_and_same_metadata_execution_input_required')
    return dict(refs)


def initialize(host,b,manifest_pin,input_pin,canonical_ref,capture_id):
    """Preserve the complete frozen initializer with its explicit new provider API."""
    class Records:
        def __getattr__(self,name):return getattr(b,name)
        def module(self,path,digest):
            value=b.module(path,digest)
            if Path(path)==OPS/PROVIDER:
                original=value;wrapped=types.SimpleNamespace(**original.__dict__)
                def cache_runtime(*args,**kwargs):
                    helper().need('metadata_refs'not in kwargs,'feature_metadata_epoch_refs_come_only_from_actual_reader_operation')
                    return original.cache_runtime(*args,metadata_refs=metadata_ancestry(host),**kwargs)
                wrapped.cache_runtime=cache_runtime;return wrapped
            return value
    return composition().initialize(host,Records(),manifest_pin,input_pin,canonical_ref,capture_id)


def __getattr__(name):return getattr(composition(),name)


if __name__=='__main__':print(json.dumps({'format':FORMAT+'-context','staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
