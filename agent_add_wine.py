"""
Usage: python agent_add_wine.py '<json>'

Example:
  python agent_add_wine.py '{
    "name": "Brunello di Montalcino BIO",
    "producer": "Le Chiuse",
    "year": 2013,
    "region": "Tuscany",
    "varietal": "Sangiovese",
    "wine_type": "red",
    "quantity": 1,
    "drink_after": "2021-01-01",
    "drink_by": "2033-12-31",
    "grapeminds_id": 90458
  }'
"""

import json
import sys
import os
import difflib

sys.path.insert(0, os.path.dirname(__file__))
import db

if len(sys.argv) < 2:
    print("Usage: python agent_add_wine.py '<json>'")
    sys.exit(1)

data = json.loads(sys.argv[1])

required = ('name', 'producer')
for field in required:
    if not data.get(field):
        print(f"Error: '{field}' is required")
        sys.exit(1)

db.init_db()

# Check producer against existing entries
import sqlite3
con = sqlite3.connect(db.DB_PATH)
existing_producers = [r[0] for r in con.execute('SELECT DISTINCT producer FROM wines').fetchall()]
con.close()

input_producer = data['producer']
input_lower = input_producer.lower()

exact = next((p for p in existing_producers if p.lower() == input_lower), None)
if exact and exact != input_producer:
    print(f"Producer name corrected: '{input_producer}' -> '{exact}' (matched existing entry)")
    data['producer'] = exact
elif not exact and existing_producers and not data.get('force'):
    matches = difflib.get_close_matches(input_producer, existing_producers, n=1, cutoff=0.6)
    if matches:
        print(f"Error: producer '{input_producer}' looks like a near-miss for existing entry '{matches[0]}'.")
        print(f"If this is the same producer, use '{matches[0]}' exactly.")
        print(f"If it's genuinely a new producer, re-run with force=true in the JSON.")
        sys.exit(1)

wine_id = db.insert_wine(
    name=data['name'],
    producer=data['producer'],
    year=data.get('year'),
    region=data.get('region'),
    appellation=data.get('appellation'),
    varietal=data.get('varietal'),
    wine_type=data.get('wine_type'),
    quantity=data.get('quantity', 1),
    date_bottled=data.get('date_bottled'),
    drink_after=data.get('drink_after'),
    drink_by=data.get('drink_by'),
    research=data.get('research'),
    considerations=data.get('considerations'),
    image_url=data.get('image_url'),
    rating=data.get('rating'),
    rating_source=data.get('rating_source'),
    label=data.get('label'),
    grapeminds_id=data.get('grapeminds_id'),
    flavor_profile=data.get('flavor_profile'),
)

print(f"Added '{data['name']}' ({data['producer']}) with id={wine_id}")

# Rebuild static site
import subprocess
repo = os.path.dirname(__file__)
script = os.path.join(repo, 'export_static.py')
subprocess.run([sys.executable, script], check=True)

# Commit and push
subprocess.run(['git', 'add', '-A'], cwd=repo, check=True)
subprocess.run(['git', 'commit', '--allow-empty', '-m',
    f"Add {data['name']} ({data['producer']})"], cwd=repo, check=True)
subprocess.run(['git', 'push'], cwd=repo, check=True)
print("Committed and pushed.")
