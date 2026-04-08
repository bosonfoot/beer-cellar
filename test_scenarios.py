"""
test_scenarios.py — End-to-end scenario tests using real beers.

Runs each beer in test_scenarios.yaml through the full Add Beer flow:
  1. Search Untappd via /api/lookup
  2. Fetch full beer details via /api/lookup/{id}
  3. Add to DB via POST /api/beers
  4. Optionally wait for research agent to populate drink window
  5. Print a report card for human review
  6. Clean up (delete added beers)

Usage:
    python test_scenarios.py                  # run all scenarios, skip research wait
    python test_scenarios.py --research       # wait up to 90s for drink window
    python test_scenarios.py --keep           # don't delete added beers (for inspection)
    python test_scenarios.py --url http://localhost:5000

Items marked [REVIEW] require human judgment — the script can't assert on them.
"""

import argparse
import os
import sys
import time

# Ensure UTF-8 output on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

import requests
import yaml
from dotenv import load_dotenv

load_dotenv()

DEFAULT_URL = 'http://localhost:5000'
PASSWORD = os.environ.get('CELLAR_PASSWORD', '')
SCENARIOS_FILE = os.path.join(os.path.dirname(__file__), 'test_scenarios.yaml')


# ── Helpers ───────────────────────────────────────────────────────────────────

def login(base_url):
    s = requests.Session()
    r = s.post(f'{base_url}/api/auth', json={'password': PASSWORD})
    if r.status_code != 200:
        print(f'ERROR: Login failed (HTTP {r.status_code}). Is CELLAR_PASSWORD set and Flask running?')
        sys.exit(1)
    return s


def check(label, condition, detail=''):
    icon = 'PASS' if condition else 'FAIL'
    line = f'  [{icon}] {label}'
    if detail:
        line += f'  ({detail})'
    print(line)
    return condition


def review(label, value):
    """Print a value that needs human eyeballing."""
    display = str(value)[:120] if value else '(none)'
    print(f'  [REVIEW] {label}: {display}')


def divider(char='-', width=64):
    print(char * width)


# ── Scenario runner ───────────────────────────────────────────────────────────

def run_scenario(s, base_url, scenario, wait_for_research=False, keep=False):
    name     = scenario['name']
    brewery  = scenario['brewery']
    notes    = scenario.get('notes', '').strip()
    exp_abv  = scenario.get('expect_abv')
    exp_style = scenario.get('expect_style')
    pinned_id = scenario.get('untappd_id')

    passes = []
    beer_id = None

    divider('=')
    print(f'SCENARIO: {name} — {brewery}')
    if notes:
        print(f'  NOTE: {notes}')
    divider()

    # ── Step 1: Lookup ────────────────────────────────────────────────────────
    if pinned_id:
        print(f'  Pinned Untappd ID: {pinned_id} (skipping search)')
        results = [{'untappd_id': pinned_id}]
        ok = True
    else:
        url = f'{base_url}/api/lookup?q={requests.utils.quote(name)}&brewery={requests.utils.quote(brewery)}'
        try:
            r = s.get(url, timeout=20)
            results = r.json() if r.ok else []
        except Exception as e:
            results = []
        ok = len(results) > 0
        passes.append(ok)
        check('Untappd search returned results', ok,
              f'{len(results)} result(s)' if ok else 'zero results — beer not found')
        if not ok:
            print('  Skipping remaining steps.\n')
            return False

    best = results[0]
    untappd_id = best['untappd_id']
    slug = best.get('slug', '')

    # ── Step 2: Fetch full details ────────────────────────────────────────────
    try:
        r = s.get(f'{base_url}/api/lookup/{untappd_id}?slug={requests.utils.quote(slug)}', timeout=30)
        detail = r.json() if r.ok else {}
    except Exception as e:
        detail = {}

    ok = bool(detail.get('name'))
    passes.append(ok)
    check('Fetched full beer details', ok)
    if not ok:
        print('  Skipping remaining steps.\n')
        return False

    returned_name   = detail.get('name', '')
    returned_brewer = detail.get('brewer', '')
    returned_abv    = detail.get('abv')
    returned_style  = detail.get('style', '')
    returned_image  = detail.get('image_url') or detail.get('label_url')

    print(f'  Name returned:   {returned_name}')
    print(f'  Brewer returned: {returned_brewer}')
    print(f'  ABV:             {returned_abv}%' if returned_abv else '  ABV:             (none)')
    print(f'  Style:           {returned_style or "(none)"}')
    review('Image URL', returned_image)

    # Sanity checks on returned data
    if exp_abv:
        abv_ok = returned_abv is not None and abs(returned_abv - exp_abv) < 1.5
        passes.append(abv_ok)
        check(f'ABV near expected ({exp_abv}%)', abv_ok,
              f'got {returned_abv}%' if returned_abv else 'missing')

    if exp_style:
        style_ok = exp_style.lower() in (returned_style or '').lower()
        passes.append(style_ok)
        check(f'Style contains "{exp_style}"', style_ok,
              f'got "{returned_style}"')

    has_image = bool(returned_image)
    passes.append(has_image)
    check('Has image URL', has_image)

    # ── Step 3: Add to DB ─────────────────────────────────────────────────────
    payload = {
        'name':          returned_name,
        'brewer':        returned_brewer,
        'abv':           returned_abv,
        'style':         returned_style,
        'untappd_rating': detail.get('rating'),
        'label':         'Test',
    }
    if detail.get('year'):
        payload['year'] = detail['year']

    try:
        r = s.post(f'{base_url}/api/beers', json=payload, timeout=15)
        added = r.json() if r.status_code == 201 else {}
    except Exception as e:
        added = {}

    ok = bool(added.get('id'))
    passes.append(ok)
    check('Added to DB', ok, f'id={added["id"]}' if ok else f'HTTP {r.status_code}')
    if not ok:
        print()
        return False

    beer_id = added['id']

    # ── Step 4: Research (optional) ───────────────────────────────────────────
    if wait_for_research:
        print('  Waiting for research agent (up to 90s)...')
        found = False
        for _ in range(30):
            time.sleep(3)
            try:
                r = s.get(f'{base_url}/api/beers/{beer_id}', timeout=10)
                b = r.json()
                if b.get('drink_after') or b.get('drink_by'):
                    found = True
                    break
            except Exception:
                pass
        passes.append(found)
        check('Research agent found drink window', found)
        if found:
            review('Drink after', b.get('drink_after'))
            review('Drink by', b.get('drink_by'))
            review('Research notes', b.get('research'))
    else:
        print('  [SKIP] Research wait skipped (run with --research to enable)')

    # ── Cleanup ───────────────────────────────────────────────────────────────
    if keep:
        print(f'  [KEEP] Beer left in DB (id={beer_id}, label=Test)')
    else:
        try:
            s.delete(f'{base_url}/api/beers/{beer_id}', timeout=10)
            print(f'  Cleaned up (id={beer_id} deleted)')
        except Exception:
            print(f'  WARNING: Could not delete beer id={beer_id}')

    all_passed = all(passes)
    print()
    return all_passed


# ── Entry point ───────────────────────────────────────────────────────────────

def run_all(base_url, wait_for_research, keep, verbose):
    if not PASSWORD:
        print('ERROR: CELLAR_PASSWORD not set in .env')
        sys.exit(1)

    with open(SCENARIOS_FILE, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)

    scenarios = data.get('beers', [])
    print(f'Loaded {len(scenarios)} scenarios from test_scenarios.yaml')
    print(f'Running against {base_url}')
    if wait_for_research:
        print('Research wait: ON (this will take several minutes and use API credits)')
    else:
        print('Research wait: OFF (run with --research to enable)')
    print()

    s = login(base_url)

    passed = 0
    failed = 0
    for scenario in scenarios:
        ok = run_scenario(s, base_url, scenario,
                          wait_for_research=wait_for_research, keep=keep)
        if ok:
            passed += 1
        else:
            failed += 1

    divider('=')
    print(f'RESULTS: {passed} passed  {failed} failed  ({len(scenarios)} scenarios)')
    if failed:
        print('Items marked [REVIEW] above require human judgment.')
        print('\nFAILED')
        sys.exit(1)
    else:
        print('Items marked [REVIEW] above require human judgment.')
        print('\nALL SCENARIOS PASSED')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default=DEFAULT_URL)
    parser.add_argument('--research', action='store_true',
                        help='Wait up to 90s per beer for research agent results')
    parser.add_argument('--keep', action='store_true',
                        help='Leave added beers in DB (labelled Test) for inspection')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()
    run_all(args.url, wait_for_research=args.research, keep=args.keep, verbose=args.verbose)
