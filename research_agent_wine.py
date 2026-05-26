"""
research_agent_wine.py — Grapeminds API client for wine drinking-window research.

Called after a wine is added via the web UI or CLI. Fetches detail + drinking period
from Grapeminds, maps fields to the wines table, and writes them to the DB.

Drinking periods are AI-generated on first request. If not yet available, the API returns
{"error": "...", "generating": true} — the client retries up to 3 times, 30s apart.
"""

import json
import os
import time

import requests
from dotenv import load_dotenv

import db

load_dotenv()

GRAPEMINDS_BASE = 'https://api.grapeminds.eu/public/v1'
ARTICLE_PREFIXES = ('Le ', 'La ', 'Les ', 'Il ', 'I ', 'Gli ', 'De ', 'Du ')


def get_api_key():
    key = os.environ.get('GRAPEMINDS_API_KEY')
    if not key:
        raise RuntimeError(
            'GRAPEMINDS_API_KEY is not set. '
            'Add it to .env from "wine cellar API key.txt".'
        )
    return key


def _auth_headers():
    return {'Authorization': f'Bearer {get_api_key()}'}


def _strip_articles(query):
    for prefix in ARTICLE_PREFIXES:
        if query.lower().startswith(prefix.lower()):
            return query[len(prefix):]
    return query


def search_wines(query, limit=10):
    """Search Grapeminds for wines matching query. Returns list of result dicts."""
    headers = _auth_headers()
    stripped = _strip_articles(query.strip())

    try:
        r = requests.get(
            f'{GRAPEMINDS_BASE}/wines/search',
            params={'q': stripped, 'limit': limit},
            headers=headers,
            timeout=15,
        )
        r.raise_for_status()
        results = r.json().get('data', [])

        # If stripped query found nothing, retry with original
        if not results and stripped != query.strip():
            r2 = requests.get(
                f'{GRAPEMINDS_BASE}/wines/search',
                params={'q': query.strip(), 'limit': limit},
                headers=headers,
                timeout=15,
            )
            r2.raise_for_status()
            results = r2.json().get('data', [])

        return results
    except Exception as e:
        print(f'[research_wine] search error: {type(e).__name__}: {e}')
        return []


def get_wine_detail(grapeminds_id):
    """Fetch full wine detail by Grapeminds wine ID. Returns data dict or None."""
    try:
        r = requests.get(
            f'{GRAPEMINDS_BASE}/wines/{grapeminds_id}',
            headers=_auth_headers(),
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get('data')
    except Exception as e:
        print(f'[research_wine] detail error for id {grapeminds_id}: {type(e).__name__}: {e}')
        return None


def get_drinking_period(grapeminds_id, max_retries=3, retry_delay=30):
    """Fetch drinking period, retrying if the API is still generating it.
    Returns period dict on success, None if unavailable after all retries."""
    headers = _auth_headers()
    for attempt in range(max_retries):
        try:
            r = requests.get(
                f'{GRAPEMINDS_BASE}/drinking-periods/{grapeminds_id}',
                headers=headers,
                timeout=15,
            )
            data = r.json()
            if data.get('generating'):
                if attempt < max_retries - 1:
                    print(f'[research_wine] drinking period generating, retry in {retry_delay}s '
                          f'(attempt {attempt + 1}/{max_retries})')
                    time.sleep(retry_delay)
                    continue
                print(f'[research_wine] drinking period still generating after {max_retries} attempts')
                return None
            if r.status_code == 200:
                return data
            print(f'[research_wine] drinking period HTTP {r.status_code}')
            return None
        except Exception as e:
            print(f'[research_wine] drinking period error: {type(e).__name__}: {e}')
            return None
    return None


def map_to_db(wine_detail, period, vintage_year):
    """Map Grapeminds API response to wines table columns."""
    result = {}

    if wine_detail:
        producer = wine_detail.get('producer') or {}
        result['name'] = wine_detail.get('display_name') or ''
        result['producer'] = producer.get('name') or producer.get('display_name') or ''
        region = wine_detail.get('region') or {}
        result['region'] = region.get('name')
        grapes = wine_detail.get('grapes') or []
        result['varietal'] = ', '.join(g['name'] for g in grapes if g.get('name')) or None
        result['wine_type'] = wine_detail.get('color')
        result['grapeminds_id'] = wine_detail.get('id')
        fp = wine_detail.get('flavor_profile')
        result['flavor_profile'] = json.dumps(fp) if fp else None

    if period and vintage_year:
        from_years = period.get('from')
        to_years = period.get('to')
        if from_years is not None:
            result['drink_after'] = f'{vintage_year + from_years}-01-01'
        if to_years is not None:
            result['drink_by'] = f'{vintage_year + to_years}-12-31'
        result['research'] = period.get('statement')
        parts = []
        if period.get('young'):
            parts.append(f'Young: {period["young"]}')
        if period.get('ripe'):
            parts.append(f'Ripe: {period["ripe"]}')
        if period.get('storage'):
            parts.append(f'Storage: {period["storage"]}')
        result['considerations'] = '\n'.join(parts) or None

    return result


def run(wine_id, grapeminds_id, vintage_year):
    """Fetch drinking period for a wine and update the DB. Called from background thread."""
    if not grapeminds_id:
        print(f'[research_wine] wine {wine_id} has no grapeminds_id, skipping')
        return

    print(f'[research_wine] Starting research for wine {wine_id}, grapeminds_id={grapeminds_id}')

    try:
        get_api_key()
    except RuntimeError as e:
        print(f'[research_wine] {e}')
        return

    detail = get_wine_detail(grapeminds_id)
    period = get_drinking_period(grapeminds_id)

    if not period:
        print(f'[research_wine] No drinking period available for wine {wine_id}')

    mapped = map_to_db(detail, period, vintage_year)

    db.update_wine_research(
        wine_id,
        drink_after=mapped.get('drink_after'),
        drink_by=mapped.get('drink_by'),
        research=mapped.get('research'),
        considerations=mapped.get('considerations'),
    )
    print(f'[research_wine] DB updated for wine {wine_id}: '
          f'drink_after={mapped.get("drink_after")}, drink_by={mapped.get("drink_by")}')
