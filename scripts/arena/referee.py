"""Pinned output schema and deterministic checks; the LLM alone chooses tactics."""
import hashlib
import json
from collections import defaultdict


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def schema():
    def obj(fields):
        return dict(type='object', properties=fields, required=list(fields), additionalProperties=False)
    def arr(item): return dict(type='array', items=item)
    def enum(*values): return dict(type='string', enum=list(values))
    text = dict(type='string'); num = dict(type='number')
    event = obj({
        'id': text, 'actorId': text, 'targetId': text, 'strategyQuote': text,
        'attackClass': enum('heavy', 'light'), 'attackName': text,
        'start': num, 'release': num, 'contact': num, 'recoveryUntil': num,
        'defense': enum('none', 'dodge', 'shield', 'guard'), 'defenderQuote': text,
        'defenseStart': num, 'defenseEnd': num,
        'outcome': enum('hit', 'guarded', 'dodged', 'shielded', 'cover_hit', 'interrupted'),
        'coverId': text, 'coverDamage': num, 'visibleAction': text, 'why': text
    })
    match = obj({
        'id': enum('SF1', 'SF2', 'FINAL'), 'fighterIds': arr(text),
        'openingState': text, 'events': arr(event), 'continuityAtThree': text,
        'winnerId': text, 'loserId': text,
        'verdict': enum('knockout', 'double-knockout', 'decision'),
        'verdictSeconds': num, 'settledSeconds': num,
        'victoryPose': text, 'whyWinner': text
    })
    return obj({'status': enum('resolved', 'needs-rule-clarification'),
                'matches': arr(match), 'championId': text, 'unresolvedQuestions': arr(text)})


def priorities(value):
    return sorted((f['id'] for f in value['roster']), key=lambda fighter:
                  sha(['yunipals-arena/tie/v2', value['tournamentId'], value['draw']['word'], fighter]))


def validate(value, outcome):
    import jsonschema
    errors = [e.message for e in jsonschema.Draft202012Validator(schema()).iter_errors(outcome)]
    if errors: return {'valid': False, 'errors': errors, 'matches': []}
    def check(ok, message):
        if not ok: errors.append(message)
    def near(a, b): return abs(a-b) < .002
    def overlap(a, b): return min(a[1], b[1])-max(a[0], b[0]) > .002
    rules = value['rules']['combat']; roster = {f['id']: f for f in value['roster']}
    strategies = {s['fighterId']: s['text'] for s in value['strategies']}
    check(value['rules']['version'] == 'arena-combat-lab-v2', 'Unsupported combat rules')
    check(outcome['status'] == 'resolved' and not outcome['unresolvedQuestions'], 'Referee did not resolve input')
    check([m['id'] for m in outcome['matches']] == ['SF1','SF2','FINAL'], 'Invalid bracket')
    results=[]; winners=[]; priority=priorities(value)
    for idx, match in enumerate(outcome['matches']):
        label=match['id']; ids=match['fighterIds']
        expected=value['semifinals'][idx] if idx<2 else winners[:2]
        check(ids == expected, f'{label}: bracket mismatch')
        if len(ids)!=2 or len(set(ids))!=2 or any(i not in roster for i in ids):
            check(False, f'{label}: invalid participants'); continue
        check(set([match['winnerId'], match['loserId']])==set(ids), f'{label}: invalid winner/loser')
        winners.append(match['winnerId'])
        events=match['events']; hp={i:60 for i in ids}; energy={i:100 for i in ids}; busy=defaultdict(list); defenses=defaultdict(list); costs=[]; covers={}
        check(1<=len(events)<=8, f'{label}: event count')
        check(len({e['id'] for e in events})==len(events),f'{label}: duplicate event IDs')
        check([e['contact'] for e in events]==sorted(e['contact'] for e in events), f'{label}: contact order')
        ko=None
        damage_timeline=[]
        for e in events:
            tag=f'{label}/{e["id"]}'; a,b=e['actorId'],e['targetId']
            if set([a,b])!=set(ids): check(False, tag+': invalid actors'); continue
            attack=rules[e['attackClass']]; interrupted=e['outcome']=='interrupted'
            check(e['strategyQuote'] and e['strategyQuote'] in strategies[a],tag+': attack lacks source quote')
            check(0<=e['start']<e['release'] and e['start']<e['contact']<=5,tag+': invalid time')
            check(near(e['release'],e['start']+attack['windup']),tag+': windup')
            if interrupted:
                check(e['contact']<e['release'] and near(e['recoveryUntil'],e['contact']),tag+': interrupted timing')
            else:
                check(e['release']<=e['contact'] and near(e['recoveryUntil'],e['release']+attack['recovery']),tag+': release/recovery')
            busy[a].append((e['start'],e['recoveryUntil']))
            costs.append((e['start'],a,attack['cost']))
            defense=e['defense']; ds=e['defenseStart']; de=e['defenseEnd']
            if defense=='none':
                check(ds==de==0 and e['defenderQuote']=='',tag+': none defense fields')
            else:
                check(e['defenderQuote'] and e['defenderQuote'] in strategies[b],tag+': defense lacks source quote')
                check(ds>=e['start']+rules['minimumReactionSeconds']-.002 and ds<de<=5,tag+': invalid defense timing')
                if defense=='shield': check(near(de-ds,rules['shieldSeconds']),tag+': shield duration')
                defenses[b].append((ds,de));costs.append((ds,b,rules['defenses'][defense]))
            if e['outcome'] in ['guarded','shielded','dodged']:
                check(defense=={'guarded':'guard','shielded':'shield','dodged':'dodge'}[e['outcome']],tag+': response/outcome mismatch')
                if defense in ['guard','shield']:
                    check(ds<=e['contact']<=de+.002,tag+': defense absent at contact')
                else:
                    check(ds<e['contact'],tag+': dodge starts after impact')
            damage=attack['damage'] if e['outcome']=='hit' else attack['damage']/2 if e['outcome']=='guarded' else 0
            if e['outcome']=='cover_hit':
                check(bool(e['coverId']) and e['coverDamage']==attack['damage'],tag+': cover damage')
                old=covers.get(e['coverId'],rules['breakableCoverHealth'])
                check(old>0,tag+': destroyed cover reused');covers[e['coverId']]=max(0,old-e['coverDamage'])
            else: check(e['coverId']=='' and e['coverDamage']==0,tag+': unexpected cover damage')
            check(ko is None or near(ko,e['contact']),tag+': event after KO')
            hp[b]=max(0,hp[b]-damage)
            if hp[b]==0 and ko is None: ko=e['contact']
            damage_timeline.append({'eventId':e['id'],'at':e['contact'],'damage':damage,'health':dict(hp)})
        for f in ids:
            intervals=sorted(busy[f])
            check(all(not overlap(a,b) for a,b in zip(intervals,intervals[1:])),f'{label}/{f}: attacks during recovery')
            check(all(not overlap(a,b) for a in intervals for b in defenses[f]),f'{label}/{f}: defense during own attack/recovery')
            # A single timed guard may cover simultaneous hits; paid defenses may not overlap.
        for t,f,cost in sorted(costs):
            energy[f]-=cost
            check(energy[f]>=0,f'{label}/{f}: exhausted energy')
            check(ko is None or t<ko,f'{label}/{f}: action starts after knockout')
        for e in events:
            if e['outcome']=='interrupted':
                check(ko is not None and near(e['contact'],ko) and hp[e['actorId']]==0,f'{label}: invalid interruption')
        zero=[i for i in ids if hp[i]==0]
        verdict='double-knockout' if len(zero)==2 else 'knockout' if zero else 'decision'
        expected_winner=next(i for i in priority if i in ids) if len(zero)==2 or hp[ids[0]]==hp[ids[1]] else max(ids,key=lambda i:hp[i])
        at=ko if ko is not None else 5
        check(match['verdict']==verdict and near(match['verdictSeconds'],at),f'{label}: verdict mismatch')
        check(match['winnerId']==expected_winner,f'{label}: winner inconsistent with HP/priority')
        fall=.65 if roster[match['loserId']]['locomotion']=='flight' else .4
        check(at+fall-.002<=match['settledSeconds']<=6,f'{label}: missing fall/defeated hold')
        results.append({'id':label,'health':hp,'energy':energy,'damageTimeline':damage_timeline,'winnerId':match['winnerId'],'verdict':verdict})
    check(len(winners)==3 and outcome['championId']==winners[-1], 'Champion mismatch')
    return {'valid':not errors,'errors':errors,'matches':results,'tiePriority':priority,
            'scope':'Schema, bracket, source quotes, timing, health, energy and terminal state; physical plausibility additionally requires visual/semantic review.'}
