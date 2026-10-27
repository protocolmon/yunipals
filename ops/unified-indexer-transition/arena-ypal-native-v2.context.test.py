#!/usr/bin/env python3
"""Real07ea ack/current algorithms over synthetic manager+private files."""
import copy,json,os
from pathlib import Path
import tempfile,types,unittest
from unittest.mock import patch
HERE=Path(__file__).parent

def load(name):
 p=HERE/name;m=types.ModuleType(p.stem);m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m
ctx=load('arena-ypal-native-v2.context.py');actors_tests=load('arena-ypal-native-v1.actors.test.py');actors=actors_tests.m;old=load('arena-ypal-native-v1.rehearsal.py')

class Controls(unittest.TestCase):
 def test_actual_output_paths_and_producers_join_across_admission_credentials_and_owner(self):
  admission=load('arena-ypal-native-v2.admission.py');credentials=load('arena-ypal-native-v2.credentials.py');owner=load('arena-ypal-native-v2.py')
  self.assertEqual(admission.BASE/'result.json',credentials.ADMISSION)
  self.assertEqual(credentials.ADMISSION,owner.ADMISSION_RESULT)
  self.assertEqual(credentials.BASE,owner.AUTH_BASE)
  self.assertEqual(credentials.ADMISSION_HELPER_SHA,old.sha((HERE/owner.ADMISSION_HELPER.name).read_bytes()))
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='arena-v2-context-',dir=HERE);self.root=Path(self.tmp.name);self.addCleanup(self.tmp.cleanup)
  self.fixture=actors_tests.Fixture(self.root);self.bind(actors,'core',lambda:self.fixture.owner_tuple);self.bind(actors,'boot',lambda:'same-synthetic-boot');self.bind(actors.time,'sleep',lambda _:None)
  self.bind(actors,'BASE',self.root/'actor-ack');self.bind(actors,'RESULT',actors.BASE/'result.json')
  value=actors.review();self.record=actors.capture(value,actors.sha(actors.encoded(value)));self.pin=actors.sha(actors.encoded(self.record))
  self.bind(ctx,'ACTOR_ACK_FILE',actors.RESULT);self.bind(ctx,'ACTOR_ACK_SHA',self.pin);self.bind(ctx,'ACTOR_ACK_REVIEW',self.record['reviewHash'])
  self.proposal=copy.deepcopy(actors_tests.proposal);self.proposal['filesAbsent']=[{'path':str(self.root/('overlay-'+str(n)))}for n in range(9)];self.effects=[]
  self.leaf=types.SimpleNamespace(PINS=old.PINS,ENV=old.ENV,TARGETS=old.TARGETS,HISTORICAL_OP=old.HISTORICAL_OP,RESTORE=old.RESTORE,RESTORE_SHA=old.RESTORE_SHA,NO_PASSWORD=old.NO_PASSWORD,need=old.need,sha=old.sha,encoded=old.encoded,rollback_sql=old.rollback_sql,peer_args=lambda *a,**kw:['synthetic-transaction',*a])
  def read(p,pin=None,*a):
   if p==old.HISTORICAL_OP:return(HERE.parent/'arena-native-admission-20261022/operational-roles.current.sql.review').read_bytes()
   return(HERE/Path(p).name).read_bytes()
  self.leaf.read=read;self.leaf.load_proposal=lambda:copy.deepcopy(self.proposal);self.leaf.source_ambient=lambda:{'sourceCatalogSha256':'938a9821e266b79c5963f0f66ffc52a9a301bc908d8a870744feeed9272a4083','sourceAmbientSha256':'a'*64}
  self.leaf.catalog=lambda *a:{'roleCount':0,'schemas':'finite-synthetic'}
  def run(argv,data,**kw):self.effects.append((argv,data));self.assertTrue(data.endswith(b'ROLLBACK;\n'));return b''
  self.leaf.run=run;self.bind(ctx,'modules',lambda:(self.leaf,actors));self.h=ctx.Context()
 def bind(self,m,k,v):
  p=patch.object(m,k,v);p.start();self.addCleanup(p.stop)
 def test_actual07ea_capture_load_and_fresh_validation_use_new_actor_frame(self):
  before=copy.deepcopy(self.fixture.prior);proof=self.h.current_actors()
  self.assertEqual(proof['actors'],self.fixture.current);self.assertNotEqual(proof['actors'],before);self.assertEqual(self.fixture.prior,before)
  self.assertFalse(proof['oldWholeInvocationGatePassed']);self.assertEqual(self.h.acknowledged()['sha256'],self.pin)
  self.assertEqual(self.h.PINS,old.PINS);self.h.PINS['fixture']='only-new-facade';self.assertNotIn('fixture',old.PINS)
 def test_pure_ack_survives_own_old_actor_stop_but_fresh_forward_proof_refuses(self):
  self.fixture.r.props=lambda *a:{'MainPID':'0','InvocationID':'','ActiveState':'inactive','SubState':'dead','Restart':'on-failure','KillMode':'control-group'}
  self.assertEqual(self.h.acknowledged()['sha256'],self.pin)
  with self.assertRaisesRegex(RuntimeError,'running_restart'):self.h.current_actors()
 def test_foreign_actor_restart_private_drift_or_changed_ack_refuses(self):
  unit=next(iter(self.fixture.current));self.fixture.current[unit]['process']['argvSha256']='f'*64
  with self.assertRaises(RuntimeError):self.h.current_actors()
  self.fixture.current[unit]=copy.deepcopy(self.fixture.prior[unit]);self.fixture.private.write_text('CHANGED_SYNTHETIC=1\n')
  with self.assertRaises(RuntimeError):self.h.current_actors()
  raw=actors.RESULT.read_bytes();actors.RESULT.write_bytes(raw+b' ')
  with self.assertRaises(RuntimeError):self.h.acknowledged()
 def test_new_rehearsal_context_and_two_rollback_boundaries_preserve_actor_ack(self):
  proposal,sqls,roles,before,binding=self.h.inspect();self.assertEqual(binding['format'],ctx.FORMAT)
  self.assertEqual(binding['acknowledgedCurrentActors'],self.h.acknowledged());self.assertEqual(binding['context']['actorsSha256'],old.sha(old.encoded(self.fixture.current)))
  result=self.h.rehearse(proposal,sqls,roles,before,binding,self.h.sha(self.h.encoded(binding)))
  self.assertEqual(len(self.effects),2);self.assertTrue(all(b'COMMIT;'not in data for _,data in self.effects));self.assertEqual([r['rolesAbsentAfterRollback']for r in result['rehearsals']],[8,1]);self.assertFalse(result['oldWholeInvocationGatePassed'])
 def test_changed_current_frame_refuses_before_rehearsal_effect(self):
  p,s,r,b,v=self.h.inspect();self.fixture.private.write_text('OTHER_SYNTHETIC=2\n')
  with self.assertRaises(RuntimeError):self.h.rehearse(p,s,r,b,v,self.h.sha(self.h.encoded(v)))
  self.assertEqual(self.effects,[])
 def test_present_native_overlay_refuses_admission_context_but_not_immutable_actor_ack(self):
  Path(self.proposal['filesAbsent'][0]['path']).write_text('synthetic=only\n')
  with self.assertRaisesRegex(RuntimeError,'overlays_must_remain_absent'):self.h.context(self.proposal)
  self.assertEqual(self.h.acknowledged()['sha256'],self.pin)

if __name__=='__main__':unittest.main(verbosity=2)
