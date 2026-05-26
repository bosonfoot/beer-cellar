"""
Phase 2 export: generates the docs/ folder for GitHub Pages.

Run after any beer is added or removed:
  python export_static.py

Then commit and push:
  git add docs/ && git commit -m "update cellar" && git push
"""

import json
import os
import shutil

BASE = os.path.dirname(__file__)

def export():
    import db
    db.init_db()

    from app import enrich, enrich_wine

    docs = os.path.join(BASE, 'docs')
    docs_static = os.path.join(docs, 'static')
    os.makedirs(docs_static, exist_ok=True)

    # 1. Enrich beers and wines (adds image_path via resolve_image / resolve_wine_image)
    beers = [enrich(b) for b in db.get_all_beers()]
    wines = [enrich_wine(w) for w in db.get_all_wines()]

    # 2. Write cellar.json — strip leading / from image_path so paths are
    #    relative on GitHub Pages (e.g. static/images/... not /static/images/...)
    for b in beers:
        if b.get('image_path', '').startswith('/'):
            b['image_path'] = b['image_path'][1:]
    for w in wines:
        if w.get('image_path', '').startswith('/'):
            w['image_path'] = w['image_path'][1:]
    json_path = os.path.join(docs, 'cellar.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump({'beers': beers, 'wines': wines}, f, indent=2)
    print(f"Wrote {len(beers)} beers and {len(wines)} wines to docs/cellar.json")

    # 3. Copy style.css unchanged; patch app.js for static hosting
    shutil.copy(os.path.join(BASE, 'static', 'style.css'),
                os.path.join(docs_static, 'style.css'))

    with open(os.path.join(BASE, 'static', 'app.js'), encoding='utf-8') as f:
        app_js = f.read()
    # No fetch-replacement patch needed: fetchBeer/fetchWine helpers check window.READ_ONLY
    # and route to cellar.json automatically. We just need the data URLs to point there.
    with open(os.path.join(docs_static, 'app.js'), 'w', encoding='utf-8') as f:
        f.write(app_js)

    # 4. Copy images directory (merge, never delete — rmtree fails on Windows/OneDrive)
    src_img = os.path.join(BASE, 'static', 'images')
    dst_img = os.path.join(docs_static, 'images')
    shutil.copytree(src_img, dst_img, dirs_exist_ok=True)
    print(f"Copied static/images/ to docs/static/images/")

    # 5. Render Jinja2 template with enriched beer data
    from jinja2 import Environment, FileSystemLoader
    env = Environment(loader=FileSystemLoader(os.path.join(BASE, 'templates')))

    # Register the short_brewer filter (used in the template)
    import re
    def short_brewer(name):
        return re.sub(r'\s+(Brewing|Brewery|Beer\s+Co\.?|Beer\s+Company)\s*$', '', name, flags=re.IGNORECASE).strip()
    env.filters['short_brewer'] = short_brewer

    tmpl = env.get_template('index.html')
    rendered = tmpl.render(beers=beers, wines=wines, producers=[], read_only=True)

    # Patch data URLs → cellar.json, and inject READ_ONLY flag
    rendered = rendered.replace(
        "window.CELLAR_DATA_URL = window.CELLAR_DATA_URL || '/api/beers';",
        "window.CELLAR_DATA_URL = 'cellar.json';\n  window.READ_ONLY = true;",
    )
    rendered = rendered.replace(
        "window.CELLAR_WINES_URL = window.CELLAR_WINES_URL || '/api/wines';",
        "window.CELLAR_WINES_URL = 'cellar.json';",
    )
    # Fix static asset paths: /static/ → static/
    rendered = rendered.replace('href="/static/', 'href="static/')
    rendered = rendered.replace('src="/static/', 'src="static/')

    out_path = os.path.join(docs, 'index.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(rendered)
    print(f"Wrote docs/index.html")
    print("\nDone. To publish:")
    print("  git add docs/ && git commit -m 'update cellar' && git push")


if __name__ == '__main__':
    export()
