import os
import re
from flask import Flask, render_template, jsonify, request, abort
import db

app = Flask(__name__)

STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')


def brewer_slug(name):
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


@app.template_filter('short_brewer')
def short_brewer(name):
    """Strip generic suffixes for display (Brewing, Brewery, Brasserie, Beer Co)."""
    return re.sub(r'\s+(Brewing|Brewery|Beer\s+Co\.?|Beer\s+Company)\s*$', '', name, flags=re.IGNORECASE).strip()


def resolve_image(beer):
    """Return the URL path to the best available local image for this beer."""
    # 1. Beer-specific image
    for ext in ('jpg', 'jpeg', 'png', 'webp'):
        path = os.path.join(STATIC_DIR, 'images', 'beers', f"beer_{beer['id']}.{ext}")
        if os.path.exists(path):
            return f"/static/images/beers/beer_{beer['id']}.{ext}"

    # 2. Brewer logo
    slug = brewer_slug(beer['brewer'])
    for ext in ('png', 'jpg', 'jpeg', 'svg', 'webp'):
        path = os.path.join(STATIC_DIR, 'images', 'brewers', f"{slug}.{ext}")
        if os.path.exists(path):
            return f"/static/images/brewers/{slug}.{ext}"

    # 3. Generic default
    return '/static/images/default.svg'


def enrich(beer):
    beer['image_path'] = resolve_image(beer)
    return beer


@app.route('/')
def index():
    beers = [enrich(b) for b in db.get_all_beers()]
    return render_template('index.html', beers=beers)


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
    data = request.get_json()
    if not data or not data.get('name') or not data.get('brewer'):
        abort(400)
    beer_id = db.insert_beer(
        name=data['name'],
        brewer=data['brewer'],
        abv=data.get('abv'),
        date_bottled=data.get('date_bottled'),
        drink_after=data.get('drink_after'),
        drink_by=data.get('drink_by'),
        research=data.get('research'),
        food_pairings=data.get('food_pairings'),
        considerations=data.get('considerations'),
        image_url=data.get('image_url'),
    )
    return jsonify({'id': beer_id}), 201


@app.route('/api/beers/<int:beer_id>/imbibe', methods=['POST'])
def api_imbibe_beer(beer_id):
    beer = db.get_beer(beer_id)
    if not beer:
        abort(404)
    data = request.get_json() or {}
    db.imbibe_beer(beer_id, notes=data.get('notes'))
    return jsonify(enrich(db.get_beer(beer_id)))


@app.route('/api/beers/<int:beer_id>', methods=['DELETE'])
def api_delete_beer(beer_id):
    beer = db.get_beer(beer_id)
    if not beer:
        abort(404)
    db.delete_beer(beer_id)
    return '', 204


if __name__ == '__main__':
    db.init_db()
    app.run(host='0.0.0.0', debug=True)
