import os
import re
import subprocess
import sys
import threading
from datetime import timedelta

from dotenv import load_dotenv
from flask import Flask, render_template, jsonify, request, abort, session

import db

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('CELLAR_SECRET_KEY', 'dev-insecure-key')
app.permanent_session_lifetime = timedelta(days=30)

STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')
REPO = os.path.dirname(__file__)

_publish_lock = threading.Lock()


def brewer_slug(name):
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


@app.template_filter('short_brewer')
def short_brewer(name):
    """Strip generic suffixes for display (Brewing, Brewery, Brasserie, Beer Co)."""
    return re.sub(r'\s+(Brewing|Brewery|Beer\s+Co\.?|Beer\s+Company)\s*$', '', name, flags=re.IGNORECASE).strip()


def resolve_image(beer):
    """Return the URL path to the best available local image for this beer."""
    # 1. Explicit image_url stored on the beer record
    if beer.get('image_url'):
        rel = beer['image_url'].lstrip('/')
        if os.path.exists(os.path.join(os.path.dirname(__file__), rel)):
            return beer['image_url']

    # 2. Beer-specific image by DB id
    for ext in ('jpg', 'jpeg', 'png', 'webp'):
        path = os.path.join(STATIC_DIR, 'images', 'beers', f"beer_{beer['id']}.{ext}")
        if os.path.exists(path):
            return f"/static/images/beers/beer_{beer['id']}.{ext}"

    # 3. Brewery default image
    slug = brewer_slug(beer['brewer'])
    for folder in ('breweries', 'brewers'):
        for ext in ('png', 'jpg', 'jpeg', 'svg', 'webp'):
            path = os.path.join(STATIC_DIR, 'images', folder, f"{slug}.{ext}")
            if os.path.exists(path):
                return f"/static/images/{folder}/{slug}.{ext}"

    # 4. Generic default
    return '/static/images/default.svg'


def enrich(beer):
    beer['image_path'] = resolve_image(beer)
    return beer


def check_auth():
    if not session.get('authed'):
        abort(403)


def _export_and_push(commit_msg):
    if not _publish_lock.acquire(blocking=False):
        return
    try:
        subprocess.run([sys.executable, 'export_static.py'], cwd=REPO)
        subprocess.run(['git', 'add', '-A'], cwd=REPO)
        subprocess.run(['git', 'commit', '--allow-empty', '-m', commit_msg], cwd=REPO)
        subprocess.run(['git', 'push'], cwd=REPO)
    finally:
        _publish_lock.release()


def _delete_background(name, brewer):
    _export_and_push(f'Remove {name} ({brewer})')


def _publish_background(beer_id, data):
    # Research runs immediately — no lock needed, it only writes to its own DB row.
    import research_agent
    research_agent.run(
        beer_id=beer_id,
        name=data['name'],
        brewer=data['brewer'],
        style=data.get('style'),
        year=data.get('year'),
        date_bottled=data.get('date_bottled'),
    )
    # Skip git operations for test/draft beers.
    if data.get('label') == 'Test':
        return

    # Git operations must be serialized to prevent push conflicts.
    _publish_lock.acquire()
    try:
        subprocess.run([sys.executable, 'export_static.py'], cwd=REPO)
        subprocess.run(['git', 'add', '-A'], cwd=REPO)
        subprocess.run(['git', 'commit', '--allow-empty', '-m',
                        f'Add {data["name"]} ({data["brewer"]})'], cwd=REPO)
        subprocess.run(['git', 'push'], cwd=REPO)
    finally:
        _publish_lock.release()


@app.route('/')
def index():
    beers = [enrich(b) for b in db.get_all_beers()]
    brewers = sorted({b['brewer'] for b in beers})
    return render_template('index.html', beers=beers, brewers=brewers)


@app.route('/api/beers')
def api_beers():
    return jsonify([enrich(b) for b in db.get_all_beers()])


@app.route('/api/beers/<int:beer_id>')
def api_beer(beer_id):
    beer = db.get_beer(beer_id)
    if not beer:
        abort(404)
    return jsonify(enrich(beer))


@app.route('/api/beers', methods=['POST'])
def api_add_beer():
    check_auth()
    data = request.get_json()
    if not data or not data.get('name') or not data.get('brewer'):
        abort(400)
    beer_id = db.insert_beer(
        name=data['name'],
        brewer=data['brewer'],
        year=data.get('year'),
        abv=data.get('abv'),
        quantity=data.get('quantity', 1),
        date_bottled=data.get('date_bottled'),
        drink_after=data.get('drink_after'),
        drink_by=data.get('drink_by'),
        research=data.get('research'),
        food_pairings=data.get('food_pairings'),
        considerations=data.get('considerations'),
        image_url=data.get('image_url'),
        untappd_rating=data.get('untappd_rating'),
        label=data.get('label'),
    )
    beer = enrich(db.get_beer(beer_id))
    t = threading.Thread(target=_publish_background, args=(beer_id, data), daemon=True)
    t.start()
    return jsonify(beer), 201


@app.route('/api/beers/<int:beer_id>/imbibe', methods=['POST'])
def api_imbibe_beer(beer_id):
    check_auth()
    beer = db.get_beer(beer_id)
    if not beer:
        abort(404)
    data = request.get_json() or {}
    new_id = db.imbibe_beer(beer_id, notes=data.get('notes'))
    active = enrich(db.get_beer(beer_id))
    result = {'beer': active}
    if new_id:
        result['imbibed_record'] = enrich(db.get_beer(new_id))
    if beer.get('label') != 'Test':
        msg = f'Imbibe {beer["name"]} ({beer["brewer"]})'
        t = threading.Thread(target=_export_and_push, args=(msg,), daemon=True)
        t.start()
    return jsonify(result)


@app.route('/api/beers/<int:beer_id>', methods=['PUT'])
def api_update_beer(beer_id):
    check_auth()
    beer = db.get_beer(beer_id)
    if not beer:
        abort(404)
    data = request.get_json()
    if not data or not data.get('name') or not data.get('brewer'):
        abort(400)
    db.update_beer(
        beer_id,
        name=data['name'],
        brewer=data['brewer'],
        year=data.get('year'),
        abv=data.get('abv'),
        quantity=data.get('quantity', 1),
        date_bottled=data.get('date_bottled'),
        drink_after=data.get('drink_after'),
        drink_by=data.get('drink_by'),
        research=data.get('research'),
        food_pairings=data.get('food_pairings'),
        considerations=data.get('considerations'),
        label=data.get('label'),
    )
    return jsonify(enrich(db.get_beer(beer_id)))


@app.route('/api/beers/<int:beer_id>/research', methods=['POST'])
def api_research_beer(beer_id):
    check_auth()
    beer = db.get_beer(beer_id)
    if not beer:
        abort(404)
    t = threading.Thread(
        target=_publish_background,
        args=(beer_id, {'name': beer['name'], 'brewer': beer['brewer'],
                        'style': None, 'year': beer.get('year'),
                        'date_bottled': beer.get('date_bottled')}),
        daemon=True,
    )
    t.start()
    return jsonify({'ok': True})


@app.route('/api/beers/<int:beer_id>', methods=['DELETE'])
def api_delete_beer(beer_id):
    check_auth()
    beer = db.get_beer(beer_id)
    if not beer:
        abort(404)
    db.delete_beer(beer_id)
    t = threading.Thread(target=_delete_background, args=(beer['name'], beer['brewer']), daemon=True)
    t.start()
    return '', 204


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.route('/api/auth', methods=['GET'])
def api_auth_check():
    if session.get('authed'):
        return jsonify({'authed': True})
    abort(403)


@app.route('/api/auth', methods=['POST'])
def api_auth_login():
    data = request.get_json() or {}
    password = os.environ.get('CELLAR_PASSWORD', '')
    if not password or data.get('password') != password:
        abort(403)
    session.permanent = True
    session['authed'] = True
    return jsonify({'ok': True})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'ok': True})


# ── Untappd lookup ────────────────────────────────────────────────────────────

@app.route('/api/lookup')
def api_lookup():
    check_auth()
    q = request.args.get('q', '').strip()
    brewery = request.args.get('brewery', '').strip()
    if not q:
        return jsonify([])
    import untappd_client
    results = untappd_client.search_beers(q, brewery)
    return jsonify(results)


@app.route('/api/lookup/<int:untappd_id>')
def api_lookup_beer(untappd_id):
    check_auth()
    slug = request.args.get('slug', '')
    if not slug:
        abort(400)
    import untappd_client
    beer = untappd_client.get_beer(untappd_id, slug)
    if not beer:
        abort(404)
    return jsonify(beer)


if __name__ == '__main__':
    db.init_db()
    app.run(host='0.0.0.0', debug=True)
