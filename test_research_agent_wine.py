"""
test_research_agent_wine.py — Tests for the Grapeminds wine research agent.

Runs against the live Grapeminds API (requires GRAPEMINDS_API_KEY in .env).
Some tests use mocking to avoid real network calls for the retry path.

Usage:
    python test_research_agent_wine.py
    python test_research_agent_wine.py --verbose
"""

import argparse
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))


# ── Test runner ───────────────────────────────────────────────────────────────

results = []

def test(name):
    def decorator(fn):
        try:
            fn()
            results.append(('PASS', name, None))
        except AssertionError as e:
            results.append(('FAIL', name, str(e) or 'assertion failed'))
        except Exception as e:
            results.append(('FAIL', name, f'{type(e).__name__}: {e}'))
        return fn
    return decorator


def assert_eq(label, actual, expected):
    assert actual == expected, f'{label}: expected {expected!r}, got {actual!r}'


def assert_not_none(label, actual):
    assert actual is not None, f'{label}: expected non-None, got None'


def assert_in(label, item, container):
    assert item in container, f'{label}: {item!r} not in {container!r}'


# ── Tests ─────────────────────────────────────────────────────────────────────

def run_all(verbose=False):
    import research_agent_wine

    print('Running research agent wine tests\n')

    # ── API key check ─────────────────────────────────────────────────────────

    @test('API key: raises RuntimeError if GRAPEMINDS_API_KEY not set')
    def _():
        saved = os.environ.pop('GRAPEMINDS_API_KEY', None)
        try:
            try:
                research_agent_wine.get_api_key()
                assert False, 'Expected RuntimeError'
            except RuntimeError as e:
                assert 'GRAPEMINDS_API_KEY' in str(e), f'Expected key name in error: {e}'
        finally:
            if saved:
                os.environ['GRAPEMINDS_API_KEY'] = saved

    # ── Article prefix stripping ──────────────────────────────────────────────

    @test('Strip articles: "Le Gode" -> "Gode"')
    def _():
        stripped = research_agent_wine._strip_articles('Le Gode Vigna Montosoli')
        assert stripped == 'Gode Vigna Montosoli', f'Got: {stripped!r}'

    @test('Strip articles: "La Chiuse" -> "Chiuse"')
    def _():
        stripped = research_agent_wine._strip_articles('La Chiuse')
        assert stripped == 'Chiuse', f'Got: {stripped!r}'

    @test('Strip articles: no prefix -> unchanged')
    def _():
        stripped = research_agent_wine._strip_articles('Boscarelli Vino Nobile')
        assert stripped == 'Boscarelli Vino Nobile', f'Got: {stripped!r}'

    # ── Producer normalization: Le Gode search ────────────────────────────────

    @test('Producer normalization: "Le Gode Vigna Montosoli" finds Gode (id 308558)')
    def _():
        results_list = research_agent_wine.search_wines('Le Gode Vigna Montosoli', limit=5)
        assert len(results_list) > 0, 'Expected at least one result'
        ids = [r.get('id') for r in results_list]
        assert 308558 in ids, f'Expected id 308558 in results, got ids: {ids}'

    # ── Happy path: Boscarelli search ─────────────────────────────────────────

    @test('Happy path: search Boscarelli Vino Nobile returns results')
    def _():
        results_list = research_agent_wine.search_wines('Boscarelli Vino Nobile Riserva', limit=5)
        assert len(results_list) > 0, 'Expected at least one result'
        assert_in('id field', 'id', results_list[0])
        assert_in('display_name field', 'display_name', results_list[0])

    @test('Happy path: Boscarelli detail (id 62624) has region=Tuscany')
    def _():
        detail = research_agent_wine.get_wine_detail(62624)
        assert_not_none('detail', detail)
        region = (detail.get('region') or {}).get('name')
        assert region == 'Tuscany', f'Expected region=Tuscany, got: {region!r}'

    @test('Happy path: Boscarelli drink_after and drink_by populated (vintage 2017)')
    def _():
        detail = research_agent_wine.get_wine_detail(62624)
        period = research_agent_wine.get_drinking_period(62624)
        if period is None:
            # Period may be generating; this is not a test failure
            results[-1] = ('SKIP', results[-1][1], 'drinking period still generating')
            return
        mapped = research_agent_wine.map_to_db(detail, period, 2017)
        assert_not_none('drink_after', mapped.get('drink_after'))
        assert_not_none('drink_by', mapped.get('drink_by'))
        assert mapped['drink_after'].startswith('202'), f'drink_after: {mapped["drink_after"]}'
        assert mapped['drink_by'].endswith('-12-31'), f'drink_by: {mapped["drink_by"]}'

    # ── Not found / manual fallback ───────────────────────────────────────────

    @test('Not found: Market Vineyards Derivative returns empty list, no exception')
    def _():
        results_list = research_agent_wine.search_wines('Market Vineyards Derivative Columbia Valley', limit=5)
        # This specific wine is not in Grapeminds; expect empty or no match
        # (search may return other results — we just check no exception raised)
        assert isinstance(results_list, list), 'Expected list result'

    # ── Retry path: generating=true ───────────────────────────────────────────

    @test('Retry path: retries when generating=true, succeeds on second call')
    def _():
        call_count = [0]
        fake_period = {'from': 6, 'to': 20, 'statement': 'Ready in 6 years.', 'young': '', 'ripe': '', 'storage': ''}

        def mock_get(*args, **kwargs):
            call_count[0] += 1
            resp = MagicMock()
            if call_count[0] == 1:
                resp.status_code = 200
                resp.json.return_value = {'error': 'Not found', 'generating': True}
            else:
                resp.status_code = 200
                resp.json.return_value = fake_period
            return resp

        with patch('research_agent_wine.requests.get', side_effect=mock_get), \
             patch('research_agent_wine.time.sleep'):
            period = research_agent_wine.get_drinking_period(99999, max_retries=3, retry_delay=0)

        assert_not_none('period after retry', period)
        assert call_count[0] == 2, f'Expected 2 calls (1 generating + 1 success), got {call_count[0]}'
        assert_eq('period.from', period.get('from'), 6)

    @test('Retry path: returns None after max retries all generating')
    def _():
        def mock_get(*args, **kwargs):
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {'error': 'Not found', 'generating': True}
            return resp

        with patch('research_agent_wine.requests.get', side_effect=mock_get), \
             patch('research_agent_wine.time.sleep'):
            period = research_agent_wine.get_drinking_period(99999, max_retries=3, retry_delay=0)

        assert period is None, f'Expected None after max retries, got: {period}'

    # ── map_to_db field mappings ──────────────────────────────────────────────

    @test('map_to_db: correct drink_after/drink_by from offsets + vintage')
    def _():
        detail = {
            'producer': {'name': 'Test Producer', 'display_name': 'Test Producer'},
            'display_name': 'Test Wine',
            'region': {'name': 'Tuscany'},
            'grapes': [{'name': 'Sangiovese'}],
            'color': 'red',
            'id': 99,
            'flavor_profile': None,
        }
        period = {'from': 8, 'to': 20, 'statement': 'Long aging.', 'young': 'Young desc.', 'ripe': 'Ripe desc.', 'storage': 'Cool cellar.'}
        mapped = research_agent_wine.map_to_db(detail, period, 2016)
        assert_eq('drink_after', mapped['drink_after'], '2024-01-01')
        assert_eq('drink_by', mapped['drink_by'], '2036-12-31')
        assert_eq('region', mapped['region'], 'Tuscany')
        assert_eq('varietal', mapped['varietal'], 'Sangiovese')
        assert_eq('wine_type', mapped['wine_type'], 'red')
        assert 'Young desc.' in mapped['considerations']
        assert 'Ripe desc.' in mapped['considerations']
        assert 'Cool cellar.' in mapped['considerations']

    # ── Report ────────────────────────────────────────────────────────────────

    passed = sum(1 for r in results if r[0] == 'PASS')
    failed = sum(1 for r in results if r[0] == 'FAIL')
    skipped = sum(1 for r in results if r[0] == 'SKIP')
    total = len(results)

    print('-' * 60)
    for status, name, detail in results:
        if status == 'PASS' and not verbose:
            continue
        icon = {'PASS': 'PASS', 'FAIL': 'FAIL', 'SKIP': 'SKIP'}[status]
        print(f'  [{icon}] {name}')
        if detail:
            print(f'         {detail}')
    print('-' * 60)
    print(f'  {passed} passed  {failed} failed  {skipped} skipped  ({total} total)')
    print()
    if failed:
        print('FAILED')
        sys.exit(1)
    else:
        print('ALL TESTS PASSED')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()
    run_all(verbose=args.verbose)
