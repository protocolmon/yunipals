#!/usr/bin/env python3
"""Finite financial limits/counter/expiry/range controls; no runtime authority."""
import copy
import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('financial_model',HERE/'ypal-alchemy-catchup-financial-v1.model.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PROFILE=json.loads((HERE/'ypal-combined-rpc-profile-v1.json').read_bytes())


def fixture():
    clock=int(datetime.datetime(2026,10,24,15,0,tzinfo=datetime.timezone.utc).timestamp()*1000)
    profile={'profile_id':m.PROFILE,'scope':m.SCOPE,'manifest_hash':m.MANIFEST,'enabled':True,'expires_at':'2026-11-19T18:00:00+00:00','policy':copy.deepcopy(PROFILE)}
    before={'identity':{'database':'yunipals_market_production','user':'postgres','session':'postgres','port':'15438','socket':True,'databaseOid':'99'},
        'clockMs':clock,'global':{'scope':m.SCOPE,'enabled':True,'dailyCu':'1000000','foregroundReserveCu':'200000'},
        'allocations':[{'workload':name,'priority':priority,'dailyCu':str(amount)}for name,priority,amount in[
            ('foreground','foreground',150000),('incident','foreground',50000),('order_projection','background',400000),
            ('sale','background',200000),('source','background',200000),('unified_evidence','background',5000),('unified_source','background',25000)]],
        'coordinator':{'enabled':True,'coordinator_id':PROFILE['coordinatorId']},'profiles':[profile],
        'permits':[{'permitId':'0x'+'1'*64,'profileId':m.PROFILE,'chainId':56,'fromBlock':'1','throughBlock':'100','maximumCu':'19000000','spentCu':'3983000','enabled':False,'expiresMs':clock-86400000,'reviewedMs':clock-90000000}],
        'windows':[{'day':'2026-10-22','grantedCu':'4547000','backgroundCu':'4547000'}],
        'workloadWindows':[{'day':'2026-10-22','workload':'unified_source','grantedCu':'4547000'}],
        'schemaCatalog':{'oid':'100','acl':None,'owner':'10'},'relationCatalog':[{'name':name,'kind':'r','oid':str(200+i),'owner':'10','acl':None,'columns':[{'name':'fixture','acl':None}]}for i,name in enumerate(m.TABLES)],
        'reservationFunction':{'oid':'400','definition':'fixed fixture','acl':None,'owner':'10'}}
    ranges={'format':'yunipals-alchemy-catchup-range-input-v1','profileId':m.PROFILE,'releaseId':m.RELEASE,'manifestHash':m.MANIFEST,'schemaOid':'75963410','buildId':'71e2a7f3b7',
        'sourceActorSha256':'a'*64,'observedAt':'2026-10-24T15:00:00+00:00',
        'chains':{str(chain):{'nativeCommittedBlock':200000000,'syncCoveredBlock':200000500,'headBlock':200001000,'headTimestamp':clock//1000,
                           'marginBlocks':m.MARGINS[chain]}for chain in m.PARTITION}}
    return before,ranges


class ModelControls(unittest.TestCase):
    def setUp(self):
        self.before,self.ranges=fixture();self.plan=m.plan(self.before,self.ranges,'d'*64,self.before['clockMs'],PROFILE)
    def current(self,spent=1000):
        result=m.expected_admitted(self.before,self.plan);result['clockMs']+=1000
        result['windows'].append({'day':self.plan['grantDay'],'grantedCu':str(spent),'backgroundCu':str(spent)})
        result['workloadWindows'].append({'day':self.plan['grantDay'],'workload':'unified_source','grantedCu':str(spent)})
        return result
    def test_only_original20M_less_actual_booked_and15M_ceiling(self):
        self.assertEqual(sum(int(row['maximumCu'])for row in self.plan['permits']),15000000)
        self.assertEqual({row['chainId']:row['maximumCu']for row in self.plan['permits']},{1:'1000000',56:'9000000',137:'2000000',8453:'3000000'})
        self.assertLessEqual(int(self.plan['baselineAllDaysSourceBookedCu'])+15000000,20000000)
        self.assertFalse(self.plan['normalDaily10MApproved']);self.assertFalse(self.plan['automaticRenewal'])
    def test_overallance_actual_old_booked_refuses(self):
        self.before['workloadWindows'][0]['grantedCu']='5000001'
        self.before['windows'][0].update(grantedCu='5000001',backgroundCu='5000001')
        with self.assertRaisesRegex(RuntimeError,'original20M'):m.plan(self.before,self.ranges,'d'*64,self.before['clockMs'],PROFILE)
    def test_current_complete_policy_profile_acl_columns_and_other_allocations_remain_exact(self):
        value=self.current();self.assertEqual(m.validate_current(self.before,value,self.plan),1000)
        for edit in [lambda x:x['global'].update(foregroundReserveCu='1'),lambda x:x['allocations'][0].update(dailyCu='999999'),
                     lambda x:x['relationCatalog'][0]['columns'][0].update(acl='foreign'),lambda x:x['profiles'][0].update(enabled=False),
                     lambda x:next(row for row in x['permits']if row['permitId']=='0x'+'1'*64).update(spentCu='1')]:
            changed=copy.deepcopy(value);edit(changed)
            with self.assertRaises(RuntimeError):m.validate_current(self.before,changed,self.plan)
    def test_paid_old_permit_active_or_wrong_profile_never_relabelled(self):
        self.before['permits'][0].update(enabled=True,expiresMs=self.before['clockMs']+100000)
        with self.assertRaisesRegex(RuntimeError,'no_active_paid_permit'):m.plan(self.before,self.ranges,'d'*64,self.before['clockMs'],PROFILE)
        self.before,_=fixture();self.before['profiles'][0]['policy']['scope']='changed'
        with self.assertRaisesRegex(RuntimeError,'ebc51'):m.plan(self.before,self.ranges,'d'*64,self.before['clockMs'],PROFILE)
    def test_genuine_pinned_configured_minima_and_tail_diagnostic_margins(self):
        self.assertEqual({row['chainId']:int(row['fromBlock'])for row in self.plan['permits']},{1:12134519,56:7579197,137:21814218,8453:22224075})
        self.assertTrue(self.plan['restartRequirements']['allOfficialFilterContinuousCacheThroughNativeSafeRequired'])
        self.assertFalse(self.plan['cacheCoverageQualified'])
        bnb=next(row for row in self.plan['permits']if row['chainId']==56);self.assertEqual(bnb['throughBlock'],'200081000')
        self.ranges['chains']['56']['marginBlocks']=80001
        with self.assertRaisesRegex(RuntimeError,'bounded_tail'):m.range_plan(self.ranges,self.before['clockMs'],PROFILE)
    def test_lifetime_gap_stale_or_future_header_missing_chain_refuses(self):
        for change in [lambda x:x['chains']['1'].update(headBlock=999999999),lambda x:x.update(observedAt='2026-10-24T14:44:59+00:00'),
                       lambda x:x['chains']['1'].update(headTimestamp=self.before['clockMs']//1000+3),lambda x:x['chains'].pop('137')]:
            value=copy.deepcopy(self.ranges);change(value)
            with self.assertRaises(RuntimeError):m.range_plan(value,self.before['clockMs'],PROFILE)
    def test_disabled_sources_do_not_expand_minima_and_enabled_start_is_not_caller_input(self):
        changed=copy.deepcopy(PROFILE);changed['manifest']['sources'].append({'enabled':False,'chainId':1,'startBlock':'0'})
        self.assertEqual(m.configured_minimums(changed),m.configured_minimums(PROFILE))
        value=copy.deepcopy(self.ranges);value['chains']['1'].update(nativeCommittedBlock=1,syncCoveredBlock=2,headBlock=1000)
        with self.assertRaisesRegex(RuntimeError,'configured_start'):m.range_plan(value,self.before['clockMs'],PROFILE)
        changed['manifest']['sources'][0]['startBlock']='latest'
        with self.assertRaisesRegex(RuntimeError,'configured_source_start'):m.configured_minimums(changed)
    def test_same_UTC_day_max8h_and_no_renewal(self):
        self.assertEqual(self.plan['expiresMs']-self.plan['startMs'],28800000)
        start=self.before['clockMs']+2*3600000;self.before['clockMs']=start;self.ranges['observedAt']='2026-10-24T17:00:00+00:00'
        for row in self.ranges['chains'].values():row['headTimestamp']=start//1000
        plan=m.plan(self.before,self.ranges,'d'*64,start,PROFILE)
        self.assertEqual(plan['expiresMs'],m.next_utc(start)-900000);self.assertEqual(plan['expiresMs']-start,7*3600000-900000)
    def test_expired_window_is_not_current_authority_but_can_close(self):
        value=self.current();value['clockMs']=self.plan['expiresMs']
        with self.assertRaisesRegex(RuntimeError,'nonexpired'):m.validate_current(self.before,value,self.plan)
        m.target_closed(self.before,value,self.plan)
    def test_original_counters_never_reset_or_refunded(self):
        value=self.current();value['workloadWindows'][0]['grantedCu']='4546999'
        value['windows'][0].update(grantedCu='4546999',backgroundCu='4546999')
        with self.assertRaisesRegex(RuntimeError,'monotonic'):m.validate_current(self.before,value,self.plan)
    def test_booked_and_permit_dispatch_caps_are_distinct_both_bound(self):
        value=self.current(15000001)
        with self.assertRaisesRegex(RuntimeError,'20M'):m.validate_current(self.before,value,self.plan)
        value=self.current();row=next(row for row in value['permits']if row['permitId']in{x['permitId']for x in self.plan['permits']});row['spentCu']=str(int(row['maximumCu'])+1)
        with self.assertRaisesRegex(RuntimeError,'permit_spending'):m.validate_current(self.before,value,self.plan)
    def test_close_preserves_counters_and_normal_foreground_envelope(self):
        value=self.current(123000);closed=m.target_closed(self.before,value,self.plan)
        self.assertEqual(closed['global'],{**self.before['global'],'dailyCu':'1123000'})
        self.assertEqual(next(row for row in closed['allocations']if row['workload']=='unified_source')['dailyCu'],'148000')
        self.assertEqual(closed['windows'],value['windows']);self.assertEqual(closed['workloadWindows'],value['workloadWindows'])
        self.assertFalse(any(row['enabled']for row in closed['permits']))
    def test_explicit_UTC_restore_uses_exact_original_numbers_without_counter_change(self):
        value=self.current(123000);closed=m.target_closed(self.before,value,self.plan,utc=True)
        self.assertEqual(closed['global'],self.before['global']);self.assertEqual(closed['allocations'],self.before['allocations'])
        self.assertEqual(closed['workloadWindows'],value['workloadWindows'])
    def test_generated_sql_only_four_new_permits_and_two_exact_policy_updates(self):
        text=m.writes(self.plan,'admit');self.assertEqual(text.count('INSERT INTO'),4);self.assertEqual(text.count('UPDATE '),2)
        for forbidden in ['DELETE ','DROP ','CREATE ','GRANT ','spent_cu=','granted_cu=']:
            self.assertNotIn(forbidden,text)
    def test_actual_official_checkpoint_decoder_equivalence_and_boundary_lookback(self):
        point=lambda c,b,end:str(1234567890)+str(c).zfill(16)+str(b).zfill(16)+('9'*33 if end else'0'*33)
        cases=[{'chain':c,'point':point(c,100000,end)}for c in m.PARTITION for end in[False,True]]+[{'chain':1,'point':'0'*75}]
        path=(HERE.parents[1]/'packages/yunipals-indexer-client/src/ponder.ts').absolute()
        self.assertEqual(m.sha(path.read_bytes()),m.DECODER_SHA)
        code='import{completePonderBlock}from'+json.dumps(path.as_uri())+';console.log(JSON.stringify(JSON.parse(process.argv[1]).map(v=>{const b=completePonderBlock(v.point,v.chain);return b===null?null:Number(b)})));'
        result=subprocess.run(['/root/.nvm/versions/node/v24.18.1/bin/node','--input-type=module','-e',code,json.dumps(cases)],capture_output=True,check=True,text=True,timeout=10)
        self.assertEqual(json.loads(result.stdout),[m.complete_block(row['point'],row['chain'])for row in cases])
        with self.assertRaisesRegex(RuntimeError,'chain_must_match'):m.complete_block(point(56,100000,True),1)
    def test_actual_raw_capture_binding_refuses_forged_normalized_ranges(self):
        source={'fixture':'actor-data-only'};raw={'format':'yunipals-alchemy-range-actual-capture-v1','source':source,
            'sourceActorSha256':m.digest(source),'schemaOid':'75963410','buildId':'71e2a7f3b7',
            'restoreResultSha256':'0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1',
            'observedAt':self.ranges['observedAt'],'databaseWrites':0,'serviceActions':0,'boundedProviderRPCRequests':8,
            'checkpoints':{},'sync':{},'heads':[]}
        names={1:'mainnet',56:'bnb',137:'polygon',8453:'base'}
        for chain in m.PARTITION:
            raw['checkpoints'][str(chain)]={'latest':'1234567890'+str(chain).zfill(16)+str(200000000).zfill(16)+'9'*33}
            raw['sync'][names[chain]]=200000500
            raw['heads'].append({'chainId':chain,'headBlock':200001000,'headHash':'0x'+'1'*64,'headTimestamp':self.before['clockMs']//1000})
        self.ranges['sourceActorSha256']=m.digest(source)
        decoder=(HERE.parents[1]/'packages/yunipals-indexer-client/src/ponder.ts').read_bytes()
        proof=m.validate_range_evidence(raw,self.ranges,decoder);self.assertFalse(proof['canonicalReadinessQualified'])
        self.ranges['chains']['56']['nativeCommittedBlock']-=1
        with self.assertRaisesRegex(RuntimeError,'normalized_ranges'):m.validate_range_evidence(raw,self.ranges,decoder)
    def test_closed_normal_new_day_and_exact_UTC_without_extra_catchup_credit(self):
        closed=m.target_closed(self.before,self.current(123000),self.plan)
        current=copy.deepcopy(closed);current['clockMs']=self.plan['nextUtcMs']+1
        current['workloadWindows'].append({'day':m.day(current['clockMs']),'workload':'unified_source','grantedCu':'25000'})
        current['windows'].append({'day':m.day(current['clockMs']),'grantedCu':'25000','backgroundCu':'25000'})
        target=m.target_utc(current,closed,self.plan)
        self.assertEqual(target['global']['dailyCu'],'1000000');self.assertEqual(target['workloadWindows'],current['workloadWindows'])
        current['workloadWindows'][-1]['grantedCu']='25001'
        current['windows'][-1].update(grantedCu='25001',backgroundCu='25001')
        with self.assertRaisesRegex(RuntimeError,'25k_new_day'):m.target_utc(current,closed,self.plan)


if __name__=='__main__':unittest.main()
