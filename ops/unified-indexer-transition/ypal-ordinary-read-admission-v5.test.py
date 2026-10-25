"""Synthetic catalog + real exclusive journal tests; no production connections."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


m = load('ypal-ordinary-read-admission-v5.py')
f = load('ypal-combined-read-admission-v2.test.py')


def local_intake():
    def protected(path, expected):
        raw = (HERE / Path(path).name).read_bytes()
        m.need(m.sha(raw) == expected, 'fixture_exact_public_source_required')
        return raw
    def module(path, expected):
        protected(path, expected); return load(Path(path).name)
    return types.SimpleNamespace(protected=protected, module=module)


def namespace():
    with patch.object(m, 'intake', return_value=local_intake()): return m.namespace()


def fixture():
    _, _, prior = f.fixture()
    # Upgrade the older fixture's object labels to the genuine catalog shape.
    for kind in ['relations', 'functions']:
        for row in prior[kind]:
            schema, name = row['name'].split('.', 1)
            row.update(schema=schema, name=name)
            if kind == 'functions':
                row['name'], row['arguments'] = name[:-1].split('(')
    before = {'read': copy.deepcopy(prior), 'allColumnAcl': []}
    read = before['read']
    for key in ['schemas', 'relations', 'functions']:
        originals = [r for r in prior[key] if (r['name'] if key == 'schemas' else r['schema']) == m.OLD_READ]
        for original in originals:
            row = copy.deepcopy(original); row['oid'] = str(int(row['oid']) + 10000)
            if key == 'schemas': row['name'] = m.READ
            else: row['schema'] = m.READ
            read[key].append(row)
    for role in read['effective']:
        for key in ['schemas', 'relations', 'functions']:
            for name in list(role[key]):
                if name == m.OLD_READ or name.startswith(m.OLD_READ + '.'):
                    target = m.READ + name[len(m.OLD_READ):]
                    role[key][target] = {'usage': False, 'create': False} if key == 'schemas' else {'select': False, 'writes': False} if key == 'relations' else False
    edges = m.logical_edges(before, f.m.ROLE_OIDS, {'read': prior, 'allColumnAcl': []})
    after = copy.deepcopy(before); effective = {r['role']: r for r in after['read']['effective']}
    for edge in edges:
        value = {'kind': edge['kind'], 'object': edge['object'], 'object_name': edge['name'], 'grantee': edge['grantee'], 'grantor': edge['grantor'], 'privilege': edge['privilege'], 'grantable': False}
        after['read']['targetEdges'].append(value)
        after['read']['directRoleEdges'].append({**value, 'column_number': None})
        role = effective[edge['role']]
        if edge['kind'] == 'schema': role['schemas'][edge['name']]['usage'] = True
        elif edge['kind'] == 'relation': role['relations'][edge['name']]['select'] = True
        else: role['functions'][edge['name']] = True
    return {'missingPermissions': edges, 'missingCount': len(edges)}, before, after


class Tests(unittest.TestCase):
    def test_default_is_static_and_input_requires_real_new_creator_and_baseline_refs(self):
        result=subprocess.run(['/usr/bin/python3','-I','-B',str(HERE/m.__file__.split('/')[-1])],capture_output=True,text=True,check=True)
        value=json.loads(result.stdout)
        self.assertTrue(value['sourceOnly']);self.assertEqual(value['databaseWrites'],0)
        good={'format':m.FORMAT+'-input','ordinaryRuntime':{'resultSha256':'1'*64,'inputSha256':'2'*64},'baselineReadAdmissionSha256':'3'*64,'createdReceiptSha256':'4'*64}
        self.assertEqual(m.checked_input(good),good)
        for change in [lambda v:v.update(createdReceiptSha256='0'*64),lambda v:v.update(format='old-read-owner'),lambda v:v['ordinaryRuntime'].update(managed=True)]:
            bad=copy.deepcopy(good);change(bad)
            with self.assertRaises(RuntimeError):m.checked_input(bad)

    def test_exact_original_logical_scope_only_new_OIDs_and_no_native_regrant(self):
        n = namespace(); p, before, after = fixture()
        self.assertEqual(p['missingCount'], 71)  # Synthetic original143 fixture, not production count.
        self.assertEqual(m.prior_graph(before), m.prior_graph(after))
        self.assertTrue(n.validate_delta(self.helpers(), p, before, after))
        sql = self.helpers().statements(p)
        self.assertEqual(len(sql), 71)
        self.assertTrue(all(m.READ in v for v in sql))
        self.assertNotRegex('\n'.join(sql), r'\b(?:LOGIN|INSERT|UPDATE|DELETE|CREATE ROLE|ALTER)\b')
        self.assertEqual(m.prior_graph(before)['read']['directRoleEdges'], m.prior_graph(after)['read']['directRoleEdges'])

    def helpers(self):
        i = local_intake(); factory = i.module(m.FACTORY, m.FACTORY_SHA)
        return factory.namespace(i.protected(m.HELPERS, m.HELPERS_SHA), m.HELPERS_SHA, m.HELPERS, {'READ_SCHEMA': m.READ})

    def host_plan(self):
        n = namespace(); p, before, _ = fixture(); config = {'format': m.FORMAT + '-input', 'ordinaryRuntime': {'resultSha256': '1'*64, 'inputSha256': '2'*64}, 'baselineReadAdmissionSha256': '3'*64, 'createdReceiptSha256': '4'*64}
        host = types.SimpleNamespace(context_input='5'*64, input=config, created={'schemaOid': next(r['oid'] for r in before['read']['schemas'] if r['name'] == m.READ)}, baseline_after=m.prior_graph(before), helpers=self.helpers())
        sql = m.enhanced_catalog((HERE / m.CATALOG.name).read_text().strip())
        p.update(format=m.FORMAT+'-plan', operatorSha256=n.own_sha(), contextInputSha256=host.context_input, input=config,
                 createdReceiptSha256=config['createdReceiptSha256'], baselineReadAdmissionSha256=config['baselineReadAdmissionSha256'],
                 readSchema=m.READ, readSchemaOid=host.created['schemaOid'], readIdentity=m.IDENTITY,
                 catalogSqlSha256=m.sha(sql.encode()), columnsSqlSha256=n.COLUMNS_SHA, catalogBefore=before,
                 baselineCatalog=before['read'], newRoles=0, loginChanges=0, newDml=0)
        p['planReviewHash'] = m.sha(m.encoded(p))
        return n, host, p

    def test_reused_plan_validator_rejects_stale_V4_receipt_and_foreign_V5_acl(self):
        n, host, p = self.host_plan(); self.assertEqual(n.validate_plan(host, p), p)
        for change in [lambda v: v['catalogBefore']['read']['directRoleEdges'].pop(),
                       lambda v: v['catalogBefore']['read']['targetEdges'].append({'kind':'relation','object':'unknown','object_name': m.READ+'.token', 'grantee':'0','grantor':'10','privilege':'SELECT','grantable':False}),
                       lambda v: v['catalogBefore']['allColumnAcl'].append({'relation':next(x['object'] for x in v['missingPermissions'] if x['kind']=='relation'),'edges':[{'grantee':'0','privilege':'UPDATE'}]})]:
            bad = copy.deepcopy(p); change(bad)
            bad['baselineCatalog'] = bad['catalogBefore']['read']; bad['planReviewHash'] = m.sha(m.encoded({k:v for k,v in bad.items() if k != 'planReviewHash'}))
            with self.assertRaises(RuntimeError): n.validate_plan(host, bad)

    def test_effective_inherited_reads_writes_and_column_SELECT_overlap_refused(self):
        n = namespace(); p, before, _ = fixture(); baseline = m.prior_graph(before)
        edge = next(e for e in p['missingPermissions'] if e['kind']=='relation')
        for field in ['select', 'writes']:
            bad = copy.deepcopy(before); next(r for r in bad['read']['effective'] if r['role']==edge['role'])['relations'][edge['name']][field]=True
            with self.assertRaises(RuntimeError): m.logical_edges(bad, f.m.ROLE_OIDS, baseline)
        before['allColumnAcl']=[{'relation':edge['object'],'edges':[{'grantee':edge['grantee'],'privilege':'SELECT'}]}]
        with self.assertRaisesRegex(RuntimeError, 'noninvertible'): n.validate_column_overlap(p,before)

    def test_full_catalog_and_all_grantee_columns_preserved_by_reused_delta(self):
        n=namespace(); p,before,after=fixture()
        changes=[lambda v:v['read']['roles'][0].update(login=not v['read']['roles'][0]['login']),lambda v:v['read']['relations'][0].update(owner='other'),
                 lambda v:v['read']['targetEdges'].append({**v['read']['targetEdges'][0],'grantee':'0'}),
                 lambda v:v['allColumnAcl'].append({'relation':'foreign','edges':[{'grantee':'0','privilege':'SELECT'}]})]
        for change in changes:
            bad=copy.deepcopy(after);change(bad)
            with self.assertRaises(RuntimeError):n.validate_delta(self.helpers(),p,before,bad)

    def lifecycle(self, lost=False):
        n=namespace();p,before,after=fixture();stable={'runtime':{'actualOrdinaryEpoch':'synthetic'},'consumers':{'same':'private'},'created':{'same':'V5'}}
        host=types.SimpleNamespace(plan=p,plan_sha='a'*64,context_input='b'*64,helpers=self.helpers(),sql='SELECT complete_catalog',
             input={'baselineReadAdmissionSha256':'3'*64,'createdReceiptSha256':'4'*64},stable=lambda:copy.deepcopy(stable))
        state={'catalog':before,'calls':0};host.catalog=lambda:copy.deepcopy(state['catalog'])
        def query(sql,readonly):
            state['calls']+=1;state['catalog']=copy.deepcopy(before if 'REVOKE ' in sql else after)
            if lost and 'GRANT ' in sql:raise TimeoutError('synthetic lost ACK')
            return [copy.deepcopy(state['catalog'])]
        host.query=query
        review={'format':m.FORMAT,'operatorSha256':'e'*64,'bootId':'boot','planSha256':host.plan_sha,'contextInputSha256':host.context_input,
                'stable':stable,'catalogBefore':before,'readEdgeCount':p['missingCount'],'baselineReadEdgeCount':143,'loginChanges':0,'newDml':0,'serviceActions':0}
        review['reviewHash']=m.sha(m.encoded(review));return n,host,state,review,after

    def local_read(self,path,expected):
        raw=Path(path).read_bytes()
        if expected is not None:self.assertEqual(m.sha(raw),expected)
        return raw

    def prepared(self,n,base,review,after):
        n.save(base/'before.json',review);n.save(base/'rehearsed.json',{'format':m.FORMAT,'operatorSha256':'e'*64,'rehearsed':True,'databaseCommitted':False,
             'reviewHash':review['reviewHash'],'beforeSha256':m.sha((base/'before.json').read_bytes()),'after':after})

    def test_actual_reused_commit_lost_ACK_reconcile_no_resend_and_pure_chain(self):
        n,host,state,review,after=self.lifecycle(True)
        with tempfile.TemporaryDirectory() as tmp,patch.object(n,'BASE',Path(tmp)),patch.object(n,'own_sha',return_value='e'*64),patch.object(n,'boot',return_value='boot'),patch.object(n,'protected',side_effect=lambda p,expected=None: self.local_read(p,expected)):
            base=Path(tmp);self.prepared(n,base,review,after);auth=m.sha(m.encoded(host.helpers.statements(host.plan)))
            with self.assertRaises(TimeoutError):n.commit(host,review['reviewHash'],auth)
            self.assertEqual(state['calls'],1);result=n.acknowledge(host,True)
            self.assertEqual(result['readEdgeCount'],71);self.assertEqual(result['baselineReadEdgeCount'],143);self.assertEqual(result['nativeRegrants'],0)
            self.assertEqual(n.admitted(host,m.sha((base/'result.json').read_bytes()))[0],result)
            with self.assertRaisesRegex(RuntimeError,'no_repeat'):n.commit(host,review['reviewHash'],auth)
            self.assertEqual(state['calls'],1)

    def test_reused_inverse_only_owns_new_logical_edges_and_restores_entire_baseline(self):
        n,host,state,review,after=self.lifecycle()
        with tempfile.TemporaryDirectory() as tmp,patch.object(n,'BASE',Path(tmp)),patch.object(n,'own_sha',return_value='e'*64),patch.object(n,'boot',return_value='boot'),patch.object(n,'inverse_stable',return_value={'callerSource':'separate'}),patch.object(n,'protected',side_effect=lambda p,expected=None: self.local_read(p,expected)):
            base=Path(tmp);self.prepared(n,base,review,after)
            n.commit(host,review['reviewHash'],m.sha(m.encoded(host.helpers.statements(host.plan))))
            receipt=m.sha((base/'result.json').read_bytes());check=n.inverse_review(host,receipt)
            self.assertTrue(n.inverse(host,receipt,check['inverseReviewHash'])['catalogRestored'])
            self.assertEqual(state['catalog'],review['catalogBefore']);self.assertEqual(state['calls'],2)
            self.assertTrue(all(m.READ in v for v in host.helpers.statements(host.plan,True)))

    def test_enhanced_SQL_is_exact_scoped_extension_and_peer_keeps_database_identity(self):
        n=namespace();raw=(HERE/m.CATALOG.name).read_text().strip();text=m.enhanced_catalog(raw)
        self.assertEqual(text.count("'"+m.READ+"'"),5)
        self.assertIn("AND has_any_column_privilege",text)
        self.assertTrue(any(isinstance(v,str) and '-c jit=off' in v for v in n.Host.query.__code__.co_consts))
        self.assertIn('5432',n.Host.query.__code__.co_consts)
        self.assertNotIn('15438',n.Host.query.__code__.co_consts)
        with self.assertRaises(RuntimeError):m.enhanced_catalog(raw.replace(m.OLD_READ,'unknown'))


if __name__ == '__main__': unittest.main()
