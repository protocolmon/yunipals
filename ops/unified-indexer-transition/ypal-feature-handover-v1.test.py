#!/usr/bin/env python3
"""Focused real-file and reused-module controls; no host/provider access."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('feature', HERE / 'ypal-feature-handover-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def fixture():
    owner = {'grantee': m.WRITER_OID, 'grantor': m.WRITER_OID, 'privilege': 'SELECT', 'grantable': False}
    tables = [{'name': name, 'oid': oid, 'owner': m.WRITER_OID, 'kind': 'r', 'rls': False, 'forceRls': False, 'select': name not in m.EIGHT,
               'writes': False, 'columnWrites': False, 'columnAcl': [], 'acl': [copy.deepcopy(owner)]} for name, oid in sorted(m.TARGET_OIDS.items())]
    return {'baseline': {'role': {'limit': 6, 'login': True}, 'edges': [], 'retainedOldTwentyReads': ['old', 'fresh'],
                          'unrelatedMetadataEdges': [{'object': '777', 'privilege': 'SELECT'}]},
            'target': {'schemaOid': m.TARGET_OID, 'owner': m.WRITER_OID, 'usage': True, 'create': False, 'tables': tables}}


class FeatureControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='.feature-test-', dir=HERE)
        self.base = Path(self.tmp.name); self.patch = patch.object(m, 'BASE', self.base); self.patch.start()
    def tearDown(self): self.patch.stop(); self.tmp.cleanup()
    def test_eight_only_roundtrip_preserves_all_prior_edges_and_OIDs(self):
        before = fixture(); original = copy.deepcopy(before); after = m.after_eight(before)
        self.assertEqual(before, original)
        self.assertEqual(m.after_eight(after, True), before)
        self.assertEqual(len(after['baseline']['edges']), 8)
        self.assertEqual([r['oid'] for r in after['target']['tables']], [r['oid'] for r in before['target']['tables']])
        self.assertEqual(after['baseline']['unrelatedMetadataEdges'], before['baseline']['unrelatedMetadataEdges'])
        self.assertIs(m.validate_catalog(before, before['baseline'], False), before)
    def test_same_count_wrong_relation_foreign_grantor_and_role_changes_refuse(self):
        before = fixture()
        wrong = copy.deepcopy(before); wrong['target']['tables'][0]['oid'] = '888'
        with self.assertRaisesRegex(RuntimeError, 'exact_ten_native_OIDs'): m.validate_catalog(wrong, before['baseline'], False)
        wrong = m.after_eight(before); wrong['target']['tables'][2]['acl'][-1]['grantor'] = '888'
        with self.assertRaises(RuntimeError): m.after_eight(wrong, True)
        wrong = copy.deepcopy(before); wrong['baseline']['role']['limit'] = -1
        with self.assertRaisesRegex(RuntimeError, 'full_acknowledged_collector'): m.validate_catalog(wrong, before['baseline'], False)
    def test_overlapping_collector_column_SELECT_or_DML_refuses_before_table_grant(self):
        for privilege in ['SELECT','UPDATE']:
            value = fixture(); row = next(r for r in value['target']['tables'] if r['name'] == 'booster_event')
            row['columnAcl'] = [{'number':1,'name':'id','acl':[{'grantee':m.ROLE_OID,'grantor':m.WRITER_OID,'privilege':privilege,'grantable':False}]}]
            with self.assertRaisesRegex(RuntimeError,'column_'):m.validate_catalog(value,value['baseline'],False)
            if privilege == 'SELECT':
                with self.assertRaisesRegex(RuntimeError,'column_SELECT'):m.after_eight(value)
    def test_SQL_is_real_guarded_transaction_owner_grants_reset_and_rollback(self):
        before = fixture(); after = m.after_eight(before)
        text = m.grant_sql(before, after, 'SELECT 1')
        self.assertEqual(text.count('GRANT SELECT ON TABLE'), 8)
        self.assertNotIn('GRANT USAGE', text); self.assertNotIn('ALTER ROLE', text)
        self.assertIn('SET LOCAL ROLE yunipals_unified_shadow;', text)
        self.assertLess(text.index('RESET ROLE;'), text.index('feature_catalog_after_CAS'))
        self.assertTrue(text.endswith('ROLLBACK;\n'))
        wrong = copy.deepcopy(after); wrong['baseline']['unrelatedMetadataEdges'] = []
        with self.assertRaisesRegex(RuntimeError, 'exact_eight_delta'): m.grant_sql(before, wrong, 'SELECT 1')
    def native(self, ready=0):
        now = int(time.time()); point = str(now).zfill(10) + str(8453).zfill(16) + str(53001000).zfill(16) + '9' * 33
        return {'app': {'build_id': m.BUILD, 'version': '6', 'is_dev': 0, 'is_locked': 1, 'is_ready': ready, 'heartbeat_at': now * 1000},
                'checkpoint': point, 'clock': now * 1000, 'schemaOid': m.TARGET_OID, 'owner': m.WRITER_OID, 'badAddresses': False}
    def test_Base_scope_does_not_lie_about_framework_ready(self):
        value = m.validate_native(self.native(), m.TARGET, m.BUILD, 53000000)
        self.assertTrue(value['BaseScopedReady']); self.assertFalse(value['frameworkReady'])
        with self.assertRaises(RuntimeError): m.validate_native(self.native(), m.TARGET, m.BUILD, 0, True)
    def test_native_stale_incomplete_wrong_deployment_cannot_authorize_switch(self):
        for field, changed in [('clock', int(time.time() * 1000) + 200000), ('badAddresses', True), ('schemaOid', '777')]:
            value = self.native(); value[field] = changed
            with self.assertRaises(RuntimeError): m.validate_native(value, m.TARGET, m.BUILD)
        value = self.native(); value['checkpoint'] = value['checkpoint'][:-1] + '0'
        self.assertEqual(m.validate_native(value,m.TARGET,m.BUILD,53000999)['completeBlock'],53000999)
        with self.assertRaisesRegex(RuntimeError,'fresh_Base'):m.validate_native(value,m.TARGET,m.BUILD,53001000)
        spec=importlib.util.spec_from_file_location('native_parity_adapter',HERE/'ypal-booster-source-parity-v1.py')
        parity=importlib.util.module_from_spec(spec);spec.loader.exec_module(parity)
        self.assertEqual(m.complete(value['checkpoint'])[0],parity.complete_block(value['checkpoint']))
    def test_real_file_publication_is_0644_under_umask077_and_foreign_same_bytes_refuse(self):
        path = self.base / 'selector.env'
        old = os.umask(0o077)
        try: record = m.create_file(path, m.SELECTOR_BYTES)
        finally: os.umask(old)
        self.assertEqual(path.stat().st_mode & 0o777, 0o644); m.owned_file(path, record)
        foreign = self.base / 'foreign.env'; foreign.write_bytes(m.SELECTOR_BYTES); foreign.chmod(0o644)
        os.replace(foreign, path)
        with self.assertRaisesRegex(RuntimeError, 'inode_and_bytes'): m.owned_file(path, record)
    def test_actual_frozen_reader_owned_overlay_parser_is_reused_without_host(self):
        spec = importlib.util.spec_from_file_location('retained_reader', HERE.parent / 'booster-launch/ypal-reader-cutover-v1.py')
        reader = importlib.util.module_from_spec(spec); spec.loader.exec_module(reader)
        path = self.base / 'retained95.conf'; path.write_text('[Service]\nEnvironmentFile=/public.env\n'); path.chmod(0o644)
        record = {'path': str(path), 'identity': reader.identity(path.stat()), 'sha256': reader.sha(path.read_bytes())}
        reader.PUBLIC_ENV = path
        reader.owned_overlay(record)
        path.write_text('[Service]\nEnvironmentFile=/foreign.env\n')
        with self.assertRaises(RuntimeError): reader.owned_overlay(record)
    def test_single_attempt_lost_ACK_is_durable_and_never_reexecuted(self):
        m.save(self.base / 'operation.json', {'format': m.FORMAT})
        owner = m.Owner(None); effects = []
        def effect(_): effects.append('start'); raise RuntimeError('lost_manager_ACK')
        with self.assertRaisesRegex(RuntimeError, 'lost_manager_ACK'): owner.step('start-new-api', effect)
        self.assertTrue((self.base / 'start-new-api-intent.json').is_file())
        self.assertFalse((self.base / 'start-new-api-result.json').exists())
        with self.assertRaisesRegex(RuntimeError, 'already_attempted'): owner.step('start-new-api', effect)
        self.assertEqual(effects, ['start'])
    def test_same_inode_source_boot_archive_and_restore_rejects_foreign_replacement(self):
        link = self.base / 'boot.service'; link.symlink_to('/etc/systemd/system/' + m.SOURCE)
        original = m.link_record(link); archive = self.base / 'archived.service'; os.rename(link, archive)
        self.assertEqual(m.link_record(archive), original)
        os.rename(archive, link); self.assertEqual(m.link_record(link), original)
        foreign = self.base / 'foreign.service'; foreign.symlink_to('/etc/systemd/system/' + m.SOURCE); os.replace(foreign, link)
        self.assertNotEqual(m.link_record(link), original)
    def test_current_prefix_uses_explicit_named_capture_and_separate_header(self):
        header = {'format': 'actual-normalized-header'}; raw = m.encoded(header); digest = m.sha(raw)
        path = self.base / ('canonical-' + digest[:16] + '.json'); path.write_bytes(raw); path.chmod(0o600)
        calls = []
        parity = types.SimpleNamespace(validate_current_prefix=lambda result, value, capture_id: calls.append((result, value, capture_id)) or {'validated': True, 'currentPrefixUnchanged': True, 'currentCanonicalInputQualified': True})
        host = object.__new__(m.Host); host.canonical_ref = (str(path), digest); host.capture_id = 'post-event'; host.parity = parity
        with patch.object(m, 'INPUT', self.base / 'config.json'):
            result = host.parity_current('a' * 64)
        self.assertEqual(calls, [('a' * 64, header, 'post-event')]); self.assertEqual(result['canonicalFileSha256'], digest)
        host.canonical_ref = (str(path), 'b' * 64)
        with patch.object(m, 'INPUT', self.base / 'config.json'), self.assertRaises(RuntimeError): host.parity_current('a' * 64)
    def test_post_switch_fresh_event_is_mandatory_before_retirement(self):
        host = object.__new__(m.Host)
        with self.assertRaisesRegex(RuntimeError, 'genuine_post_switch'): host.fresh_event({'blockNumber': 100, 'blockHash': '0x' + 'a' * 64, 'transactionHash': '0x' + 'b' * 64, 'logIndex': 0}, 100)

    def test_real_HTTP_guard_requires_current_build_and_fresh_recent_collection(self):
        deployment = {'engine':'0x'+'1'*40,'monsters':'0x'+'2'*40,'ypal':'0x'+'3'*40,'catalogHash':'0x'+'4'*64}
        frame = {'engine':deployment['engine'],'collection':deployment['monsters'],'enabled':True,'buildId':m.BUILD,'indexedBlock':'101'}
        responses = {'/readyz':{**frame,'ready':True},'/v1/boosters/types':{**frame,'items':[{'packTypeId':'1','paymentToken':deployment['ypal'],'catalogHash':deployment['catalogHash']}]},
                     '/v1/boosters/monsters?limit=24':{**frame,'items':[{'collection':deployment['monsters'],'tokenId':'1'}]},
                     '/v1/boosters/recent-openings?limit=12':{**frame,'items':[{'requestKey':'8453:'+deployment['engine']+':1','monster':{'collection':deployment['monsters']}}]},
                     '/v1/boosters/art/base-mainnet-standard-v1/81.json':{'image':m.PUBLIC+'/v1/boosters/art-assets/'+'a'*64+'.png','yunipals':{'status':'ready','variantId':81}}}
        h = object.__new__(m.Host); h.reader = types.SimpleNamespace(INPUT=Path('/fixed/public-input'))
        h.old = types.SimpleNamespace(request=lambda path, public=False:(200,copy.deepcopy(responses[path])))
        with patch.object(m,'document',return_value=deployment): self.assertTrue(h.availability(100,m.BUILD)['ready'])
        responses['/v1/boosters/recent-openings?limit=12']['items'][0]['monster']['collection']='0x'+'9'*40
        with patch.object(m,'document',return_value=deployment), self.assertRaisesRegex(RuntimeError,'old_recent'):h.availability(100,m.BUILD)
        responses['/v1/boosters/recent-openings?limit=12']['items']=[];responses['/readyz']['buildId']='old'
        with patch.object(m,'document',return_value=deployment), self.assertRaisesRegex(RuntimeError,'actual_API_readiness'):h.availability(100,m.BUILD)

    def test_retained_five_proxy_leaf_drift_refuses_without_observing_old_API_or_source(self):
        chains = {'ethereum':None,'base':None,'polygon':None,'bnb':None}
        names = ['old-'+c for c in chains] + ['ypal19212']
        calls = []; states = {n:{'Id':n,'MainPID':'1','Environment':'public','EnvironmentFiles':'fixed'} for n in names}
        transport = types.SimpleNamespace(env_bytes=lambda:b'FREE_ONLY=true\n',BOOT_LINK=Path('/fixed/ypal19212.boot'))
        api = types.SimpleNamespace(CHAINS=chains,YPAL_UNITS=['ypal19212','OLD-SOURCE','OLD-API'],old_unit=lambda c:'old-'+c,
            state=lambda _,n:calls.append(n) or copy.deepcopy(states[n]),definition=lambda _,state,chain:({'definitionHashes':{state['Id']:'exact'},'environmentFileHashes':{'fixed':'hash'}},''),
            live_actor=lambda _,state,expected:{'pid':1,'invocation':'original','privateHash':'unchanged'},check_link=lambda p,r:None)
        expected = {n:{'definitionHashes':{n:'exact'},'environmentFileHashes':{'fixed':'hash'},'actor':{'pid':1,'invocation':'original','privateHash':'unchanged'},'settings':{'Id':n,'MainPID':'1'},'environmentPropertySha256':m.sha(b'public'),'environmentFilesPropertySha256':m.sha(b'fixed')} for n in names}
        expected['acceptedYpal']={'rpcBoot':{'path':str(transport.BOOT_LINK)}}
        self.assertEqual(set(m.retained_proxy_frame(transport,api,expected)),set(names))
        self.assertNotIn('OLD-API',calls);self.assertNotIn('OLD-SOURCE',calls)
        states['ypal19212']['MainPID']='2'
        with self.assertRaisesRegex(RuntimeError,'unchanged_old_four'):m.retained_proxy_frame(transport,api,expected)

    def test_first_service_effect_rechecks_header_deadline_after_last_read(self):
        h=object.__new__(m.Host);h.old_inputs=lambda:None;h.combined=lambda:None;h.first_effect_deadline=time.time()-1
        with patch.object(m.subprocess,'run') as invoke:
            with self.assertRaisesRegex(RuntimeError,'deadline_expired'):h.manager('stop',m.TIMER)
            invoke.assert_not_called()


class LifecycleHost:
    """External manager transport only; actual owner/files/journal/delta execute."""
    def __init__(self):
        self.before = fixture(); self.current = copy.deepcopy(self.before)
        self.config = {'readAdmissionSha256': 'a' * 64, 'cachePreparedSha256': 'b' * 64}
        self.manifest_pin, self.input_pin = 'c' * 64, 'd' * 64
        self.api = {'Id': m.API, 'MainPID': '2334701', 'InvocationID': '3a3b4014f75b4db9968f4c5ee26fa904', 'ExecMainStartTimestampMonotonic': '1', 'startTicks': 1}
        self.source = {'pid': 2309283, 'invocation': '3744d80464924b5ca1de340ac94c1034', 'actorPids': [2309283, 2309418], 'startTicks': 2}
        self.active = {m.API: True, m.QUEUE: False, m.TIMER: True, m.SOURCE: True}
        self.commands = []; self.starts = 0; self.lose_start = False; self.target_ready = True; self.boundary = 100; self.header_observed=int(time.time())
        spec = importlib.util.spec_from_file_location('observer', HERE.parent / 'booster-launch/ypal-old-runtime-inventory-v1.py')
        observer = importlib.util.module_from_spec(spec); spec.loader.exec_module(observer)
        def fds(pids, uid, gid):
            if uid == 967: return {str(p):{'startTicks':self.api['startTicks'],'socketInodes':[100]}for p in pids}
            return {str(p):{'startTicks':1,'socketInodes':[200]}for p in pids}
        observer.peer_fds = fds; observer.run = lambda _:b'u_str ESTAB 0 0 * 100 * 200\n'
        self.old = types.SimpleNamespace(core=types.SimpleNamespace(sql=self.sql), h=types.SimpleNamespace(observer=observer))
        self.inverse_mode=False;self.api_restarts=0;self.combined_down=False
    def sql(self, text):
        if text.endswith('COMMIT;\n'): self.current = copy.deepcopy(self.before if 'REVOKE SELECT' in text else m.after_eight(self.before))
        return 'catalog'
    def baseline(self): return self.before['baseline']
    def catalog(self): return copy.deepcopy(self.current)
    def catalog_sql(self): return 'SELECT 1'
    def actor(self, selected=False):
        self.definitions(selected); m.need(self.active[m.API], 'fixture_API_not_active'); return copy.deepcopy(self.api)
    def old_inputs(self): return {'fresh_originals': True, 'no_private_values': True}
    def source_actor(self, expected=None):
        m.need(self.active[m.SOURCE], 'fixture_source_not_active'); return copy.deepcopy(self.source)
    def restart_temporary_source(self, intent, original):
        self.manager('start', m.SOURCE)
        self.source = {**self.source, 'pid': 4000001, 'invocation': 'f' * 32, 'actorPids': [4000001,4000002]}
        return self.source
    def source_activation(self, retired=False):
        m.need(os.path.lexists(m.BOOT) is (not retired), 'fixture_boot_phase_mismatch')
        return {'UnitFileState': 'disabled' if retired else 'enabled', 'MainPID': str(self.source['pid']) if self.active[m.SOURCE] else '0',
                'InvocationID': self.source['invocation']}
    def state(self, unit):
        return {'ActiveState': 'active' if self.active[unit] else 'inactive', 'UnitFileState': 'enabled', 'Job': '',
                **(self.api if unit == m.API else {}), 'MainPID': self.api['MainPID'] if unit == m.API and self.active[unit] else '0',
                'NRestarts':str(self.api_restarts), 'ControlPID':'0'}
    def query(self, sql):
        assert 'usesysid=' in sql
        return [{'pid':600,'backendStart':'fixture-kernel-peer','clientAddress':None,'clientPort':None}]
    def inverse_api(self,original,intent):return m.Host.inverse_api(self,original,intent)
    def inverse_source(self):return {'terminal':not self.active[m.SOURCE],'actor':copy.deepcopy(self.source)if self.active[m.SOURCE]else None}
    def last_feature_cursor(self):return self.boundary

    def combined(self):
        if self.combined_down:
            m.need(self.inverse_mode,'fixture_combined_forward_not_ready')
            return {'inverseOnly':True,'terminal':True}
        return {'unit':m.COMBINED,'acknowledged_actor':True}
    def peers(self): return {'unrelatedReaders': 'unchanged'}
    def definitions(self, selected=False):
        if selected:
            for p in [m.SELECTOR, *m.DROPS.values()]: m.owned_file(p, m.document(m.BASE / ('published-' + m.sha(str(p).encode())[:12] + '.json')))
        else: m.need(not any(os.path.lexists(p) for p in [m.SELECTOR, *m.DROPS.values()]), 'unexpected_fixture_overlay')
        return {'old95': 'preserved', 'selected': selected}
    def parity_current(self, digest): return {'validated': True, 'boundary': self.boundary, 'headerHash': '0x' + 'a' * 64, 'canonicalObservedAtUnix': self.header_observed, 'currentPrefixUnchanged': True, 'currentCanonicalInputQualified': True}
    def native(self, schema, build, minimum=0, framework=False):
        m.need(not framework or schema != m.TARGET or self.target_ready, 'fixture_framework_not_ready')
        return {'BaseScopedReady': True, 'completeBlock': max(self.boundary, minimum)}
    def manager(self, action, unit=None, expected=None):
        if expected is not None:
            m.need(all(self.api.get(k) == expected.get(k) for k in ['Id', 'MainPID', 'InvocationID', 'ExecMainStartTimestampMonotonic']) if unit == m.API else self.source_activation()['InvocationID'] == expected['InvocationID'], 'fixture_actor_CAS')
        self.commands.append((action, unit))
        if action in {'start', 'stop'}: self.active[unit] = action == 'start'
        if action == 'start' and unit == m.QUEUE: self.active[unit] = False
        if action == 'start' and unit == m.API:
            self.starts += 1; self.api = {**self.api, 'MainPID': str(3000000 + self.starts), 'InvocationID': str(self.starts).zfill(32), 'ExecMainStartTimestampMonotonic': str(time.monotonic_ns() // 1000), 'startTicks': self.starts + 100}
            if self.lose_start: raise RuntimeError('fixture_lost_start_ACK')
    def terminal(self, unit):
        m.need(not self.active[unit], 'fixture_not_terminal'); return {'unit': unit, 'terminal': True}
    def availability(self, minimum, build):
        m.need(not (build == m.FRESH_BUILD and getattr(self,'old_http_unavailable',False)), 'actual_old_HTTP_not_ready')
        return {'ready': True, 'minimumBlock': minimum, 'buildId': build}
    def queue_proof(self, since, minimum): return {'monotonicUs': since + 1, 'indexedBlock': minimum, 'queued': 0}
    def sessions(self, temporary=None):
        return {m.COMBINED: [{'pid': 100, 'backendStart': 'current-combined-pool'}], **({m.SOURCE: [{'pid': 200, 'backendStart': 'owned-source-pool'}]} if temporary else {})}
    def fresh_event(self, event, minimum):
        m.need(event['blockNumber'] > minimum, 'new_event_must_be_later'); return event


class FeatureLifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='.feature-cycle-', dir=HERE); root = Path(self.tmp.name)
        self.patches = [patch.object(m, 'BASE', root / 'receipts'), patch.object(m, 'SELECTOR', root / 'public.env'),
                        patch.object(m, 'DROPS', {m.API: root / 'api.conf', m.QUEUE: root / 'queue.conf'}), patch.object(m, 'BOOT', root / 'source.boot')]
        for p in self.patches: p.start()
        m.BOOT.symlink_to('/etc/systemd/system/' + m.SOURCE)
        self.h = LifecycleHost(); self.owner = m.Owner(self.h)
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.tmp.cleanup()
    def admit(self):
        review = self.owner.review(); self.owner.rehearse(review['reviewHash']); self.owner.admit(m.sha(m.protected(m.BASE / 'operation.json')))
    def switched(self):
        self.admit(); review = self.owner.switch_review('e' * 64); return self.owner.switch('e' * 64, review['reviewHash'])
    def test_real_owned_file_full_switch_and_inverse_preserve_old95_and_prior_graph(self):
        value = self.switched(); self.assertTrue(value['switched']); self.assertEqual(value['api']['MainPID'], '3000001')
        self.assertEqual(len([v for v in self.h.commands if v == ('start', m.API)]), 1)
        self.assertTrue(m.SELECTOR.exists()); self.assertEqual(self.h.current, m.after_eight(self.h.before))
        review = self.owner.inverse_review(); value = self.owner.inverse(review['reviewHash'])
        self.assertTrue(value['inverse']); self.assertEqual(value['api']['MainPID'], '3000002')
        self.assertEqual(self.h.current, self.h.before); self.assertTrue(m.BOOT.is_symlink())
        self.assertFalse(any(os.path.lexists(p) for p in [m.SELECTOR, *m.DROPS.values()]))
    def test_framework_gate_refuses_before_healthy_API_or_timer_is_stopped(self):
        self.admit(); self.h.target_ready = False
        with self.assertRaisesRegex(RuntimeError, 'framework_not_ready'): self.owner.switch_review('e' * 64)
        self.assertEqual(self.h.commands, []); self.assertTrue(self.h.active[m.API])
    def test_actual_old_HTTP_gate_refuses_before_timer_or_API_stop(self):
        self.admit(); self.h.old_http_unavailable = True
        with self.assertRaisesRegex(RuntimeError,'actual_old_HTTP_not_ready'):self.owner.switch_review('e'*64)
        self.assertEqual(self.h.commands,[]);self.assertTrue(self.h.active[m.API])
    def test_lost_real_start_ACK_retains_files_hash_and_one_start_never_replays(self):
        self.admit(); review = self.owner.switch_review('e' * 64); self.h.lose_start = True
        with self.assertRaisesRegex(RuntimeError, 'lost_start_ACK'): self.owner.switch('e' * 64, review['reviewHash'])
        self.assertTrue(m.SELECTOR.exists()); self.assertTrue((m.BASE / 'start-new-api-intent.json').exists())
        self.assertFalse((m.BASE / 'start-new-api-result.json').exists()); self.assertFalse((m.BASE / 'switch-result.json').exists())
        with self.assertRaisesRegex(RuntimeError, 'already_attempted'): self.owner.switch_review('e' * 64)
        self.assertEqual(self.h.starts, 1)
    def test_separate_post_event_retirement_archives_exact_boot_inode_and_drains_own_sessions(self):
        self.switched(); original = m.boot_record(); self.h.boundary = 102
        event = {'blockNumber': 101, 'blockHash': '0x' + 'a' * 64, 'transactionHash': '0x' + 'b' * 64, 'logIndex': 0}
        review = self.owner.retirement_review('f' * 64, event); value = self.owner.retire('f' * 64, event, review['reviewHash'])
        self.assertTrue(value['retired']); self.assertFalse(m.BOOT.exists()); self.assertFalse(self.h.active[m.SOURCE])
        self.assertEqual(m.link_record(m.BASE / 'temporary-source.boot.original'), original)
        self.assertTrue(self.h.active[m.API]); self.assertTrue(self.h.active[m.TIMER])

    def test_retirement_inverse_restores_same_boot_inode_and_fresh_source_and_API_actors(self):
        self.switched(); original = m.boot_record(); self.h.boundary = 102
        event = {'blockNumber': 101, 'blockHash': '0x' + 'a' * 64, 'transactionHash': '0x' + 'b' * 64, 'logIndex': 0}
        review = self.owner.retirement_review('f' * 64, event); self.owner.retire('f' * 64, event, review['reviewHash'])
        reviewed = self.owner.inverse_review(); value = self.owner.inverse(reviewed['reviewHash'])
        self.assertTrue(value['inverse']); self.assertEqual(m.boot_record(), original)
        self.assertEqual(value['source']['pid'], 4000001); self.assertEqual(value['api']['MainPID'], '3000002')
        self.assertEqual(self.h.current, self.h.before); self.assertTrue(self.h.active[m.SOURCE])
    def test_foreign_same_target_boot_inode_refuses_inverse_before_source_start(self):
        self.switched(); self.h.boundary = 102
        event = {'blockNumber': 101, 'blockHash': '0x' + 'a' * 64, 'transactionHash': '0x' + 'b' * 64, 'logIndex': 0}
        review = self.owner.retirement_review('f' * 64, event); self.owner.retire('f' * 64, event, review['reviewHash'])
        archive = m.BASE / 'temporary-source.boot.original'; foreign = m.BASE / 'foreign.boot'
        foreign.symlink_to('/etc/systemd/system/' + m.SOURCE); os.replace(foreign, archive)
        with self.assertRaisesRegex(RuntimeError, 'same_archived_boot_inode'): self.owner.inverse_review()
        self.assertNotIn(('start', m.SOURCE), self.h.commands)

    def test_inverse_with_terminal_combined_and_terminal_API_never_starts_combined(self):
        self.switched(); self.h.combined_down=True;self.h.active[m.API]=False
        with self.assertRaisesRegex(RuntimeError,'forward_not_ready'):self.owner.selected()
        reviewed=self.owner.inverse_review();self.assertIsNone(reviewed['api'])
        result=self.owner.inverse(reviewed['reviewHash']);self.assertTrue(result['inverse'])
        self.assertEqual(result['api']['MainPID'],'3000002');self.assertEqual(self.h.current,self.h.before)
        self.assertFalse(any(unit==m.COMBINED for action,unit in self.h.commands))
    def test_inverse_only_API_autorestart_requires_counter_and_real_kernel_join(self):
        self.switched();self.h.api={**self.h.api,'MainPID':'3000099','InvocationID':'9'*32,'ExecMainStartTimestampMonotonic':str(time.monotonic_ns()//1000),'startTicks':199}
        with self.assertRaisesRegex(RuntimeError,'exact_owned_newAPI'):self.owner.selected()
        self.h.inverse_mode=True
        with self.assertRaisesRegex(RuntimeError,'systemd_restart_counter'):self.owner.inverse_review()
        self.h.api_restarts=1;reviewed=self.owner.inverse_review()
        self.assertEqual(reviewed['api']['MainPID'],'3000099');self.assertEqual(reviewed['apiKernelSessions'][0]['pid'],600)
        result=self.owner.inverse(reviewed['reviewHash']);self.assertTrue(result['inverse'])
        self.assertEqual(self.h.current,self.h.before)

    def test_inverse_context_can_never_be_reused_for_forward_admission_or_retirement(self):
        self.switched();self.owner.inverse_review()
        with self.assertRaisesRegex(RuntimeError,'never_forward'):self.owner.selected()
        with self.assertRaisesRegex(RuntimeError,'never_forward'):self.owner.switch_review('e'*64)


if __name__ == '__main__': unittest.main()
