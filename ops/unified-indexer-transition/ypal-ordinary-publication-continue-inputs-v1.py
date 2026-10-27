#!/usr/bin/env python3
"""Render ten immutable reader refs after an actual new cache prepared ACK."""
import argparse
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FORMAT='yunipals-ypal-ordinary-publication-continue-inputs-v1'
UTILITY=OPS/'ypal-ordinary-cache-continuation-context-v1.py'
UTILITY_SHA='f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449'
READER=OPS/'ypal-ordinary-reader-continue-v1.py'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v1.manifest.json'


def utility():
    for path in [*UTILITY.parents,UTILITY]:
        row=path.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_continuation_input_utility_required')
    first=UTILITY.lstat();raw=UTILITY.read_bytes();last=UTILITY.lstat()
    if not stat.S_ISREG(first.st_mode)or first.st_nlink!=1 or not 0<len(raw)==first.st_size<100000 or hashlib.sha256(raw).hexdigest()!=UTILITY_SHA or \
       any(getattr(first,key)!=getattr(last,key)for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_continuation_input_utility_required')
    value=types.ModuleType('actual_continuation_context');value.__file__=str(UTILITY)
    exec(compile(raw,str(UTILITY),'exec'),value.__dict__);return value


def reader_inputs(prepared_sha,manifest_sha):
    u=utility();u.need(u.pin(prepared_sha)and u.pin(manifest_sha),'actual_new_cache_prepared_and_reader_manifest_refs_required')
    manifest=json.loads(u.public(MANIFEST,manifest_sha));pins={**manifest['dependencies'],**manifest['files']}
    u.need(manifest['format']=='yunipals-ypal-ordinary-reader-continue-v1-source'and
        manifest['acknowledgementRoute']=={'file':READER.name,'sha256':pins[READER.name],'method':'acknowledgement'},
        'actual_new_reader_source_and_immutable_ACK_route_required')
    for name,digest in pins.items():
        u.need(type(name)is str and name not in {'','.','..'}and '/'not in name and '\\'not in name and u.pin(digest),
            'finite_protected_actual_reader_ref_sources_required');u.public(OPS/name,digest)
    authority=u.authority(manifest);phase=manifest['contexts']['phase'];provider=u.load(OPS/phase['file'],phase['sha256'])
    u.need(provider.FILE.name=='ypal-ordinary-read-cache-continue-v1.py','only_actual_new_cache_continuation_prepared_refs_supported')
    config=provider.config_checked(json.loads(u.public(provider.INPUT,authority.PRIOR_INPUT_SHA)))
    def receipt(path,digest=None):
        raw=u.public(path,digest);value=json.loads(raw);u.need(type(value)is dict,'actual_recorded_continuation_receipt_object_required')
        return value,u.sha(raw)
    prepared,_=receipt(provider.BASE/'prepared.json',prepared_sha)
    before,_=receipt(provider.BASE/'before.json',prepared['beforeSha256'])
    committed,_=receipt(provider.BASE/'sql-committed.json',prepared['additionalReadAcknowledgementSha256'])
    u.need(prepared['format']==before['binding']['format']==provider.FORMAT and prepared['operatorSha256']==before['binding']['operatorSha256']==phase['sha256']and
        prepared['config']==before['binding']['config']==config and prepared['prepared']is True and
        prepared['nativeWorkerStarted']is prepared['nativeGenerationPublished']is False and
        prepared['reviewHash']==before['reviewHash']==committed['reviewHash']and committed['operatorSha256']==phase['sha256']and
        committed['mode']=='apply'and committed['readAdmissionSha256']==config['readAdmissionSha256'],
        'actual_new_cache_prepared_commit_and_postdrain_ancestry_required')
    reader=u.load(READER,pins[READER.name]);_,proof=reader.core(manifest_sha)  # No Context or current validator.
    observer_ref=manifest['contexts']['observer'];observer=u.load(OPS/observer_ref['file'],observer_ref['sha256'])
    observed,observer_sha=receipt(observer.BASE/'result.json')
    u.need(observed['format']==observer.FORMAT and observed['operatorSha256']==observer_ref['sha256']and observed['mode']=='new'and
        observed['observerScopeOnly']is observed['ordinarySustainedObserver']is True,'actual_recorded_sustained_observer_ref_required')
    transport=manifest['transportQualification'];qualified,qualification_sha=receipt(Path(transport['newQualificationFile']))
    u.need(qualified['format']=='yunipals-ordinary-reader-peer-bound-v1'and qualified['qualified']is True and
        qualified['producerSha256']==transport['newProducerSha256']and qualified['wireManifestSha256']==manifest['wireManifestSha256']and
        set(qualified['peers'])=={'postgres','main'},'same_unchanged_actual_effect_SQL_peer_and_wire_qualification_required')
    for name,digest in [('ypal-generation-publisher-install-v1.py',proof.PUBLISHER_INSTALL_SHA),
        ('ypal-latest-complete-main-api-install-v1.py',proof.MAIN_INSTALL_SHA)]:
        installer=u.load(OPS/name,pins[name]);receipt(installer.BASE/'result.json',digest)  # No installed/current method.
    result={'sourceManifestSha256':manifest_sha,'readPlanSha256':config['readPlanSha256'],
        'readContextInputSha256':config['readContextInputSha256'],'cacheInputsSha256':authority.PRIOR_INPUT_SHA,
        'cachePreparedSha256':prepared_sha,'sustainedObserverSha256':observer_sha,'transportQualificationSha256':qualification_sha,
        'publisherInstallSha256':proof.PUBLISHER_INSTALL_SHA,'mainInstallSha256':proof.MAIN_INSTALL_SHA,
        'parityWitnessSha256':manifest['canonicalWitness']['witnessSha256']}
    u.need(set(result)==proof._implementation.INPUT_KEYS and all(u.pin(value)for value in result.values()),
        'exact_ten_actual_recorded_new_reader_refs_required')
    return {'format':FORMAT,'readerInputs':result,'immutableFileLineageOnly':True,'currentReadinessQualified':False,
        'inputWrites':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--prepared-sha');parser.add_argument('--manifest-sha');args=parser.parse_args()
    if args.prepared_sha is args.manifest_sha is None:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'inputWrites':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:print(json.dumps(reader_inputs(args.prepared_sha,args.manifest_sha),sort_keys=True))
