#!/usr/bin/env python3
"""Fixed V6 parent/SQL timing contract; no dispatch or acceptance authority.

The invoking constructor must authenticate the immutable V5 source before
applying these exact AST seams in its new namespace. The source graph must also
pin the V6 SQL/transport/wire closure. Existing XID, source, catalogue, actor,
literal ACK, durable-intent and reconcile bodies remain the caller's authority.
"""
import ast
import copy

FORMAT = 'yunipals-ypal-ordinary-publication-protocol-v6'
IDLE_SECONDS = 240
CACHE_PARENT_SECONDS = 360
READER_PARENT_SECONDS = 360
READER_PUBLISH_PARENT_SECONDS = 1200
READER_RESERVED_EFFECT_SECONDS = 70
NANOSECONDS = 1000000000


def need(value, code):
    if not value:
        raise RuntimeError(code)


def policy():
    return {
        'format': FORMAT,
        'cacheIdleSeconds': IDLE_SECONDS,
        'readerIdleSeconds': IDLE_SECONDS,
        'cacheParentSeconds': CACHE_PARENT_SECONDS,
        'readerParentSeconds': READER_PARENT_SECONDS,
        'readerPublishParentSeconds': READER_PUBLISH_PARENT_SECONDS,
        'readerReservedEffectSeconds': READER_RESERVED_EFFECT_SECONDS,
        'actualCallbackMeasurementRequired': True,
        'originalV5TimingGatePassed': False,
        'productionCOMMITQualified': False
    }


def callback_window(target):
    need(target in {'cache', 'reader'}, 'fixed_V6_cache_or_reader_timing_target_required')
    return {
        'idleNanoseconds': IDLE_SECONDS * NANOSECONDS,
        'reservedEffectNanoseconds': (
            0 if target == 'cache' else READER_RESERVED_EFFECT_SECONDS * NANOSECONDS
        )
    }


def require_callback_window(receipt, target):
    """Arithmetic only; the caller first authenticates receipt/context/mode."""
    need(type(receipt) is dict, 'actual_V6_callback_measurement_object_required')
    elapsed = receipt.get('elapsedNanoseconds')
    reserved = receipt.get('reservedEffectNanoseconds')
    window = callback_window(target)
    need(type(elapsed) is int and elapsed > 0 and type(reserved) is int and
         reserved == window['reservedEffectNanoseconds'] and
         elapsed + reserved < window['idleNanoseconds'],
         'actual_callback_and_owned_effect_allowance_must_fit_V6_SQL_idle_window')
    return receipt


def _parent_window(original, name, expected, replacement):
    need(isinstance(original, ast.FunctionDef) and original.name == name,
         'fixed_authenticated_V5_protocol_function_required')
    function = copy.deepcopy(original)
    deadlines = [node for node in ast.walk(function) if isinstance(node, ast.Assign) and
                 len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and
                 node.targets[0].id == 'deadline']
    need(len(deadlines) == 1 and ast.unparse(deadlines[0].value) == expected,
         'one_exact_original_parent_deadline_expression_required')
    deadlines[0].value = ast.parse(replacement, mode='eval').body
    # Parent callbacks run synchronously. Check the absolute deadline again
    # after those checks/effects and before transmitting any literal ACK.
    # No callback, predicate or existing ACK authentication is removed.
    acknowledgements = 0
    for node in ast.walk(function):
        for field, value in ast.iter_fields(node):
            if not isinstance(value, list):
                continue
            body = []
            for item in value:
                if (isinstance(item, ast.Expr) and isinstance(item.value, ast.Call) and
                        ast.unparse(item.value.func) == 'proc.stdin.write' and
                        any(isinstance(key, ast.Constant) and key.value in {
                            'openedSha256', 'preparedSha256', 'messageSha256'
                        } for key in ast.walk(item))):
                    body.append(ast.parse(
                        "need(time.monotonic() < deadline, "
                        "'V6_parent_deadline_expired_before_literal_ACK_reconcile_only')"
                    ).body[0])
                    acknowledgements += 1
                body.append(item)
            setattr(node, field, body)
    need(acknowledgements == 2, 'exact_two_existing_literal_ACK_dispatches_required')
    return ast.fix_missing_locations(function)


def cache_parent_window(original):
    """Apply after V5 transport_function; before sql_child is renamed."""
    return _parent_window(
        original, 'sql_child', 'time.monotonic() + 100',
        'time.monotonic() + ' + str(CACHE_PARENT_SECONDS)
    )


def reader_parent_window(original):
    """Apply after V5 transported_function; other launch seams stay intact."""
    return _parent_window(
        original, 'child',
        "time.monotonic() + (MAX_PREPARATION_SECONDS if mode == 'publish' else 120)",
        "time.monotonic() + (MAX_PREPARATION_SECONDS if mode == 'publish' else " +
        str(READER_PARENT_SECONDS) + ')'
    )
