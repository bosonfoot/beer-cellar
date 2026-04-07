"""
test_battery.py — Integration test suite for the Beer Cellar app.

Runs against the live Flask server (default: http://localhost:5000).
Reads CELLAR_PASSWORD from .env. Creates and deletes its own test data.

Usage:
    python test_battery.py              # run all tests
    python test_battery.py --url http://localhost:5000
    python test_battery.py --verbose    # show pass details too

To run as a background Claude agent, say "run the test battery".
"""

import argparse
import os
import sys
import time

import requests
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

DEFAULT_URL = 'http://localhost:5000'
PASSWORD = os.environ.get('CELLAR_PASSWORD', '')

# ── Test runner ───────────────────────────────────────────────────────────────

results = []

def test(name):
    """Decorator that registers and runs a test, catching all exceptions."""
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


def assert_in(label, item, container):
    assert item in container, f'{label}: {item!r} not in {container!r}'


def assert_ok(label, r):
    assert r.status_code < 400, f'{label}: HTTP {r.status_code} — {r.text[:200]}'


# ── Setup ─────────────────────────────────────────────────────────────────────

def make_session(base_url, authed=True):
    s = requests.Session()
    s.base = base_url
    if authed:
        r = s.post(f'{base_url}/api/auth', json={'password': PASSWORD})
        assert r.status_code == 200, f'Login failed (HTTP {r.status_code}) — is CELLAR_PASSWORD set correctly?'
    return s


def cleanup(s, beer_ids):
    for bid in beer_ids:
        try:
            s.delete(f'{s.base}/api/beers/{bid}')
        except Exception:
            pass


# ── Tests ─────────────────────────────────────────────────────────────────────

def run_all(base_url, verbose=False):
    if not PASSWORD:
        print('ERROR: CELLAR_PASSWORD not set in .env — cannot run auth tests.')
        sys.exit(1)

    created_ids = []
    s = make_session(base_url)
    anon = make_session(base_url, authed=False)

    print(f'Running test battery against {base_url}\n')

    # ── Auth ──────────────────────────────────────────────────────────────────

    @test('Auth: unauthenticated GET /api/auth returns 403')
    def _():
        r = anon.get(f'{base_url}/api/auth')
        assert_eq('status', r.status_code, 403)

    @test('Auth: unauthenticated POST /api/beers returns 403')
    def _():
        r = anon.post(f'{base_url}/api/beers', json={'name': 'X', 'brewer': 'Y'})
        assert_eq('status', r.status_code, 403)

    @test('Auth: login with correct password returns 200')
    def _():
        r = anon.post(f'{base_url}/api/auth', json={'password': PASSWORD})
        assert_eq('status', r.status_code, 200)
        assert_in('ok', 'ok', r.json())

    @test('Auth: login with wrong password returns 403')
    def _():
        r = anon.post(f'{base_url}/api/auth', json={'password': 'wrongpassword'})
        assert_eq('status', r.status_code, 403)

    @test('Auth: authenticated GET /api/auth returns 200')
    def _():
        r = s.get(f'{base_url}/api/auth')
        assert_eq('status', r.status_code, 200)

    # ── Add beer ──────────────────────────────────────────────────────────────

    beer_id = None

    @test('Add beer: full payload returns 201 with all fields')
    def _():
        nonlocal beer_id
        r = s.post(f'{base_url}/api/beers', json={
            'name': '__TEST__ Full Payload Saison',
            'brewer': '__TEST__ Brewery',
            'year': 2022,
            'abv': 6.5,
            'quantity': 3,
            'date_bottled': '2022-09-15',
            'drink_after': '2024-01',
            'drink_by': '2028-06',
            'research': 'Test research notes.',
            'food_pairings': 'Test food pairings.',
            'considerations': 'Test considerations.',
            'label': 'Test',
        })
        assert_eq('status', r.status_code, 201)
        b = r.json()
        beer_id = b['id']
        created_ids.append(beer_id)
        assert_eq('name', b['name'], '__TEST__ Full Payload Saison')
        assert_eq('brewer', b['brewer'], '__TEST__ Brewery')
        assert_eq('year', b['year'], 2022)
        assert_eq('abv', b['abv'], 6.5)
        assert_eq('quantity', b['quantity'], 3)
        assert_eq('date_bottled', b['date_bottled'], '2022-09-15')
        assert_eq('drink_after', b['drink_after'], '2024-01')
        assert_eq('drink_by', b['drink_by'], '2028-06')
        assert_eq('label', b['label'], 'Test')

    @test('Add beer: minimal payload (name + brewer only) returns 201')
    def _():
        r = s.post(f'{base_url}/api/beers', json={
            'name': '__TEST__ Minimal Beer',
            'brewer': '__TEST__ Brewery',
        })
        assert_eq('status', r.status_code, 201)
        created_ids.append(r.json()['id'])

    @test('Add beer: missing name returns 400')
    def _():
        r = s.post(f'{base_url}/api/beers', json={'brewer': '__TEST__ Brewery'})
        assert_eq('status', r.status_code, 400)

    @test('Add beer: missing brewer returns 400')
    def _():
        r = s.post(f'{base_url}/api/beers', json={'name': '__TEST__ No Brewer'})
        assert_eq('status', r.status_code, 400)

    # ── Get beer ──────────────────────────────────────────────────────────────

    @test('Get beer: returns correct fields after add')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set (add test failed)')
        r = s.get(f'{base_url}/api/beers/{beer_id}')
        assert_eq('status', r.status_code, 200)
        b = r.json()
        assert_eq('name', b['name'], '__TEST__ Full Payload Saison')
        assert_eq('image_path', bool(b.get('image_path')), True)

    @test('Get beer: unknown id returns 404')
    def _():
        r = s.get(f'{base_url}/api/beers/999999')
        assert_eq('status', r.status_code, 404)

    @test('Get all beers: test beers appear in list')
    def _():
        r = s.get(f'{base_url}/api/beers')
        assert_eq('status', r.status_code, 200)
        names = [b['name'] for b in r.json()]
        assert_in('test beer in list', '__TEST__ Full Payload Saison', names)

    # ── Edit beer ─────────────────────────────────────────────────────────────

    @test('Edit beer: update name and brewer')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = s.put(f'{base_url}/api/beers/{beer_id}', json={
            'name': '__TEST__ Edited Name',
            'brewer': '__TEST__ Edited Brewery',
            'quantity': 3,
        })
        assert_eq('status', r.status_code, 200)
        b = r.json()
        assert_eq('name', b['name'], '__TEST__ Edited Name')
        assert_eq('brewer', b['brewer'], '__TEST__ Edited Brewery')

    @test('Edit beer: date_bottled YYYY only')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = s.put(f'{base_url}/api/beers/{beer_id}', json={
            'name': '__TEST__ Edited Name',
            'brewer': '__TEST__ Edited Brewery',
            'date_bottled': '2021',
            'quantity': 1,
        })
        assert_ok('put', r)
        assert_eq('date_bottled', r.json()['date_bottled'], '2021')

    @test('Edit beer: date_bottled YYYY-MM')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = s.put(f'{base_url}/api/beers/{beer_id}', json={
            'name': '__TEST__ Edited Name',
            'brewer': '__TEST__ Edited Brewery',
            'date_bottled': '2021-04',
            'quantity': 1,
        })
        assert_ok('put', r)
        assert_eq('date_bottled', r.json()['date_bottled'], '2021-04')

    @test('Edit beer: date_bottled YYYY-MM-DD')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = s.put(f'{base_url}/api/beers/{beer_id}', json={
            'name': '__TEST__ Edited Name',
            'brewer': '__TEST__ Edited Brewery',
            'date_bottled': '2021-04-12',
            'quantity': 1,
        })
        assert_ok('put', r)
        assert_eq('date_bottled', r.json()['date_bottled'], '2021-04-12')

    @test('Edit beer: clear a field by sending null')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = s.put(f'{base_url}/api/beers/{beer_id}', json={
            'name': '__TEST__ Edited Name',
            'brewer': '__TEST__ Edited Brewery',
            'drink_after': None,
            'drink_by': None,
            'quantity': 1,
        })
        assert_ok('put', r)
        b = r.json()
        assert_eq('drink_after cleared', b['drink_after'], None)
        assert_eq('drink_by cleared', b['drink_by'], None)

    @test('Edit beer: unauthenticated PUT returns 403')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = anon.put(f'{base_url}/api/beers/{beer_id}', json={
            'name': 'Hacked', 'brewer': 'Hacker'
        })
        assert_eq('status', r.status_code, 403)

    # ── Imbibe ────────────────────────────────────────────────────────────────

    imbibe_id = None

    @test('Imbibe: creates a fresh beer to imbibe')
    def _():
        nonlocal imbibe_id
        r = s.post(f'{base_url}/api/beers', json={
            'name': '__TEST__ Imbibe Target',
            'brewer': '__TEST__ Brewery',
        })
        assert_eq('status', r.status_code, 201)
        imbibe_id = r.json()['id']
        created_ids.append(imbibe_id)

    @test('Imbibe: sets date_imbibed and stores notes')
    def _():
        if imbibe_id is None: raise AssertionError('imbibe_id not set')
        r = s.post(f'{base_url}/api/beers/{imbibe_id}/imbibe',
                   json={'notes': 'Tasted great.'})
        assert_ok('imbibe', r)
        b = r.json()
        assert b['date_imbibed'], 'date_imbibed should be set'
        assert_eq('notes', b['imbibe_notes'], 'Tasted great.')

    @test('Imbibe: date_imbibed persists on GET')
    def _():
        if imbibe_id is None: raise AssertionError('imbibe_id not set')
        r = s.get(f'{base_url}/api/beers/{imbibe_id}')
        assert_ok('get', r)
        assert r.json()['date_imbibed'], 'date_imbibed should persist'

    # ── Research endpoint ─────────────────────────────────────────────────────

    @test('Research: POST /api/beers/{id}/research returns 200')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = s.post(f'{base_url}/api/beers/{beer_id}/research')
        assert_eq('status', r.status_code, 200)
        assert_in('ok', 'ok', r.json())

    @test('Research: unauthenticated POST returns 403')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = anon.post(f'{base_url}/api/beers/{beer_id}/research')
        assert_eq('status', r.status_code, 403)

    # ── Untappd lookup ────────────────────────────────────────────────────────

    @test('Lookup: search returns results for known beer')
    def _():
        r = s.get(f'{base_url}/api/lookup?q=Cantillon+Gueuze&brewery=Cantillon')
        if r.status_code == 503:
            results[-1] = ('SKIP', results[-1][1], 'Untappd unreachable')
            return
        assert_ok('lookup', r)
        data = r.json()
        assert len(data) > 0, 'Expected at least one result'
        assert_in('name field', 'name', data[0])
        assert_in('untappd_id field', 'untappd_id', data[0])

    @test('Lookup: empty query returns empty list')
    def _():
        r = s.get(f'{base_url}/api/lookup?q=')
        assert_eq('status', r.status_code, 200)
        assert_eq('empty', r.json(), [])

    @test('Lookup: unauthenticated returns 403')
    def _():
        r = anon.get(f'{base_url}/api/lookup?q=Cantillon')
        assert_eq('status', r.status_code, 403)

    # ── Delete ────────────────────────────────────────────────────────────────

    @test('Delete: removes beer and returns 204')
    def _():
        # Create a dedicated beer just for deletion
        r = s.post(f'{base_url}/api/beers', json={
            'name': '__TEST__ Delete Me',
            'brewer': '__TEST__ Brewery',
        })
        assert_eq('status', r.status_code, 201)
        del_id = r.json()['id']
        r2 = s.delete(f'{base_url}/api/beers/{del_id}')
        assert_eq('status', r2.status_code, 204)
        r3 = s.get(f'{base_url}/api/beers/{del_id}')
        assert_eq('gone', r3.status_code, 404)

    @test('Delete: unauthenticated returns 403')
    def _():
        if beer_id is None: raise AssertionError('beer_id not set')
        r = anon.delete(f'{base_url}/api/beers/{beer_id}')
        assert_eq('status', r.status_code, 403)

    # ── Cleanup ───────────────────────────────────────────────────────────────

    cleanup(s, created_ids)

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


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default=DEFAULT_URL)
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()
    run_all(args.url, verbose=args.verbose)
