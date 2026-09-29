#!/usr/bin/env python3
"""Observe the previously failing read families without storing token payloads."""
import argparse
import collections
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--duration', type=int, default=86400)
parser.add_argument('--interval', type=int, default=60)
parser.add_argument('--api-port', type=int, default=9011)
parser.add_argument('--market-port', type=int, default=19013)
parser.add_argument('--output', required=True)
args = parser.parse_args()
assert 1 <= args.duration <= 86400 and args.interval >= 45
assert 1024 <= args.api_port <= 65535 and 1024 <= args.market_port <= 65535
start = time.monotonic()
report = {'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
          'samples': {}, 'errors': {}, 'expectedRefresh': {}, 'rateLimits': {},
          'generationTransitions': [], 'minimumFreeBytes': None, 'complete': False}
timings = collections.defaultdict(list)
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)


def generation():
    try:
        value = subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-XAt',
                            '-d', 'yunipals_backfill', '-c',
                            'SELECT current_id FROM metadata_projection.active WHERE singleton'],
                               capture_output=True, text=True, timeout=5)
    except subprocess.TimeoutExpired:
        return None
    return value.stdout.strip() if value.returncode == 0 else None


def save():
    report['elapsedSeconds'] = round(time.monotonic() - start)
    report['latency'] = {key: {'samples': len(values), 'p95Ms': sorted(values)[min(len(values)-1, int(.95*len(values)))],
                             'maxMs': max(values)} for key, values in timings.items() if values}
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(output)


def read(label, port, path, params):
    begun = time.monotonic()
    body = None
    try:
        request = urllib.request.Request(f'http://127.0.0.1:{port}{path}?' + urllib.parse.urlencode(params),
                                         headers={'User-Agent': 'yunipals-query-observation/1'})
        with urllib.request.urlopen(request, timeout=40) as response:
            status = response.status
            body = json.load(response)
    except urllib.error.HTTPError as error:
        status = error.code
        try:
            body = json.load(error)
        except ValueError:
            body = None
    except (OSError, ValueError):
        status = 0
    elapsed = round((time.monotonic() - begun)*1000)
    timings[label].append(elapsed)
    report['samples'][label] = report['samples'].get(label, 0) + 1
    category = None
    if status == 409 and body and body.get('error', {}).get('code') == 'snapshot_refresh_required':
        category = 'expectedRefresh'
    elif status == 429:
        category = 'rateLimits'
    elif status != 200:
        category = 'errors'
    if category:
        key = f'{label}:{status}'
        report[category][key] = report[category].get(key, 0) + 1
        print(json.dumps({'event': 'query_observation_response', 'route': label, 'status': status, 'ms': elapsed}), flush=True)
    return body if status == 200 else None


def identity(item):
    token = item['token']
    return token['chain'], token['tokenId']


cycle = 0
next_deep = start
while time.monotonic() - start < args.duration:
    cycle_start = time.monotonic()
    free = shutil.disk_usage('/').free
    report['minimumFreeBytes'] = min(report['minimumFreeBytes'] or free, free)
    if free < 25_000_000_000:
        report['errors']['disk_reserve'] = report['errors'].get('disk_reserve', 0) + 1
    before = generation()
    for sort, metadata in [('rarity-desc', 'all'), ('rarity-capped-desc', 'all'),
                           ('rarity-desc', 'available'), ('rarity-desc', 'missing')]:
        read(f'main:{sort}:{metadata}', args.api_port, '/v1/tokens',
             {'chain': 'bnb', 'sort': sort, 'metadata': metadata, 'limit': '24'})
    params = {'chain': 'bnb', 'sort': 'rarity-desc', 'limit': '24'}
    first = read('v2:rarity:first', args.market_port, '/v2/market/tokens', params)
    if first and first.get('nextCursor'):
        seen = {identity(item) for item in first['items']}
        current = first
        depth = 24 if time.monotonic() >= next_deep else 2
        if depth == 24:
            next_deep = time.monotonic() + 900
        for page in range(depth):
            time.sleep(1.1)
            params.update(snapshot=first['snapshot']['id'], cursor=current['nextCursor'])
            current = read('v2:rarity:continuation', args.market_port, '/v2/market/tokens', params)
            if not current:
                break
            keys = {identity(item) for item in current['items']}
            if current['snapshot'] != first['snapshot'] or current['total'] != first['total'] or keys & seen:
                report['errors']['v2:pagination_parity'] = report['errors'].get('v2:pagination_parity', 0) + 1
            seen.update(keys)
            if not current.get('nextCursor'):
                break
    for label, params in [('v2:capped:first', {'chain': 'bnb', 'sort': 'rarity-capped-desc', 'limit': '24'}),
                          ('v2:combined:first', {'sort': 'rarity-desc', 'limit': '24'})]:
        time.sleep(1.1)
        first = read(label, args.market_port, '/v2/market/tokens', params)
        if first and first.get('nextCursor'):
            time.sleep(1.1)
            params.update(snapshot=first['snapshot']['id'], cursor=first['nextCursor'])
            current = read(label.replace('first', 'continuation'), args.market_port, '/v2/market/tokens', params)
            if current and (current['snapshot'] != first['snapshot'] or current['total'] != first['total']):
                report['errors']['v2:pagination_parity'] = report['errors'].get('v2:pagination_parity', 0) + 1
    after = generation()
    if before and after and before != after:
        report['generationTransitions'].append({'before': before, 'after': after,
                                               'elapsedSeconds': round(time.monotonic()-start)})
    if not before or not after:
        report['errors']['generation_read_unavailable'] = report['errors'].get('generation_read_unavailable', 0) + 1
    free = shutil.disk_usage('/').free
    report['minimumFreeBytes'] = min(report['minimumFreeBytes'], free)
    save()
    cycle += 1
    if cycle == 1 or cycle % 60 == 0:
        print(json.dumps({'event': 'query_observation_checkpoint', 'cycles': cycle,
                          'elapsedSeconds': report['elapsedSeconds'], 'errors': report['errors'],
                          'rateLimits': report['rateLimits'], 'minimumFreeBytes': report['minimumFreeBytes']}), flush=True)
    time.sleep(max(0, min(args.interval-(time.monotonic()-cycle_start), args.duration-(time.monotonic()-start))))
report['complete'] = True
report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
save()
print(json.dumps(report), flush=True)
raise SystemExit(1 if report['errors'] else 0)
