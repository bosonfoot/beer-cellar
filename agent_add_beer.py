"""
Usage: python agent_add_beer.py '<json>'

Example:
  python agent_add_beer.py '{
    "name": "2021 Floodland Muscat",
    "brewer": "Floodland Brewing",
    "date_bottled": "2021-06-01",
    "drink_after": "2024-01-01",
    "drink_by": "2028-12-31",
    "research": "...",
    "food_pairings": "...",
    "considerations": "..."
  }'
"""

import json
import sys
import os
import difflib

sys.path.insert(0, os.path.dirname(__file__))
import db

if len(sys.argv) < 2:
    print("Usage: python agent_add_beer.py '<json>'")
    sys.exit(1)

data = json.loads(sys.argv[1])

required = ('name', 'brewer')
for field in required:
    if not data.get(field):
        print(f"Error: '{field}' is required")
        sys.exit(1)

db.init_db()

# Check brewer against existing entries
import sqlite3
con = sqlite3.connect(db.DB_PATH)
existing_brewers = [r[0] for r in con.execute('SELECT DISTINCT brewer FROM beers').fetchall()]
con.close()

input_brewer = data['brewer']
input_lower = input_brewer.lower()

# Exact match (case-insensitive) — snap to existing casing
exact = next((b for b in existing_brewers if b.lower() == input_lower), None)
if exact and exact != input_brewer:
    print(f"Brewer name corrected: '{input_brewer}' -> '{exact}' (matched existing entry)")
    data['brewer'] = exact
elif not exact and existing_brewers:
    # Fuzzy match — warn if suspiciously close
    matches = difflib.get_close_matches(input_brewer, existing_brewers, n=1, cutoff=0.6)
    if matches:
        print(f"Error: brewer '{input_brewer}' looks like a near-miss for existing entry '{matches[0]}'.")
        print(f"If this is the same brewery, use '{matches[0]}' exactly.")
        print(f"If it's genuinely a new brewery, re-run with force=true in the JSON to bypass this check.")
        sys.exit(1)

# Allow bypassing the fuzzy check for confirmed new breweries
# (add "force": true to the JSON payload)

# Brewery image fallback — if no beer-specific image, use brewery default
image_url = data.get('image_url')
if not image_url:
    defaults_path = os.path.join(os.path.dirname(__file__), 'brewery_defaults.json')
    if os.path.exists(defaults_path):
        with open(defaults_path) as f:
            brewery_defaults = json.load(f)
        image_url = brewery_defaults.get(data['brewer'])
        if image_url:
            print(f"Using brewery default image for '{data['brewer']}'")

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
    image_url=image_url,
    untappd_rating=data.get('untappd_rating'),
)

print(f"Added '{data['name']}' with id={beer_id}")

# Rebuild static site
import subprocess
repo = os.path.dirname(__file__)
script = os.path.join(repo, 'export_static.py')
subprocess.run([sys.executable, script], check=True)

# Commit and push
subprocess.run(['git', 'add', '-A'], cwd=repo, check=True)
subprocess.run(['git', 'commit', '--allow-empty', '-m',
    f"Add {data['name']} ({data['brewer']})"], cwd=repo, check=True)
subprocess.run(['git', 'push'], cwd=repo, check=True)
print("Committed and pushed.")
