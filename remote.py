"""
Client for the live Azure site, which is the MASTER database.

Scripts change data through the site's API, then call pull() to refresh the local
cache (the SQLite file at db.DB_PATH) and publish() to update GitHub Pages.
Needs CELLAR_PASSWORD in .env.
"""

import os
import subprocess
import sys

import requests
from dotenv import load_dotenv

import db

load_dotenv()

BASE_URL = os.environ.get('CELLAR_REMOTE_URL', 'https://lincoln-beer-cellar.azurewebsites.net')
REPO = os.path.dirname(os.path.abspath(__file__))

_session = None


def _login():
    global _session
    if _session is None:
        password = os.environ.get('CELLAR_PASSWORD')
        if not password:
            sys.exit('CELLAR_PASSWORD not set (expected in .env)')
        s = requests.Session()
        r = s.post(BASE_URL + '/api/auth', json={'password': password}, timeout=60)
        if not r.ok:
            sys.exit(f'Login to {BASE_URL} failed ({r.status_code})')
        _session = s
    return _session


def call(method, path, payload=None):
    """Call the live site's API and return the parsed JSON."""
    r = _login().request(method, BASE_URL + path, json=payload, timeout=120)
    if not r.ok:
        sys.exit(f'{method} {path} failed: {r.status_code} {r.text[:200]}')
    return r.json() if r.content else None


def _replace_table(conn, table, rows):
    columns = [c[1] for c in conn.execute(f'PRAGMA table_info({table})')]
    conn.execute(f'DELETE FROM {table}')
    for row in rows:
        keys = [k for k in columns if k in row]
        conn.execute(
            f'INSERT INTO {table} ({",".join(keys)}) VALUES ({",".join("?" * len(keys))})',
            [row[k] for k in keys],
        )


def pull():
    """Replace the local cache with the live site's beers and wines."""
    beers = requests.get(BASE_URL + '/api/beers', timeout=60).json()
    wines = requests.get(BASE_URL + '/api/wines', timeout=60).json()
    db.init_db()
    with db.get_conn() as conn:
        _replace_table(conn, 'beers', beers)
        _replace_table(conn, 'wines', wines)
    print(f'Local cache refreshed from {BASE_URL}: {len(beers)} beers, {len(wines)} wines')


def publish(message):
    """Rebuild GitHub Pages from the live site, then commit and push."""
    def git(*args, check=True):
        return subprocess.run(['git', *args], cwd=REPO, check=check)

    git('pull', '-q', '--ff-only')
    env = dict(os.environ, CELLAR_SOURCE_URL=BASE_URL)
    subprocess.run([sys.executable, 'export_static.py'], cwd=REPO, env=env, check=True)
    # The export also copies static/app.js, which holds an unreleased login-prompt change.
    # Keep the published copy as it is until that change is deliberately released.
    git('checkout', '--', 'docs/static/app.js')
    git('add', 'docs/cellar.json', 'docs/index.html', 'docs/static/images', 'static/images')
    if git('diff', '--cached', '--quiet', check=False).returncode == 0:
        print('Nothing to publish.')
        return
    git('commit', '-m', message)
    git('push')
    print('Committed and pushed.')
