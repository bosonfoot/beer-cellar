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
import remote

if len(sys.argv) < 2:
    print("Usage: python agent_add_wine.py '<json>'")
    sys.exit(1)

data = json.loads(sys.argv[1])

required = ('name', 'producer')
for field in required:
    if not data.get(field):
        print(f"Error: '{field}' is required")
        sys.exit(1)

remote.pull()

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

payload = {k: data.get(k) for k in (
    'name', 'producer', 'year', 'region', 'appellation', 'varietal', 'wine_type',
    'date_bottled', 'drink_after', 'drink_by', 'research', 'considerations',
    'image_url', 'rating', 'rating_source', 'label', 'grapeminds_id', 'flavor_profile')}
payload.update(quantity=data.get('quantity', 1), skip_research=True)
wine_id = remote.call('POST', '/api/wines', payload)['id']

print(f"Added '{data['name']}' ({data['producer']}) with id={wine_id}")

remote.pull()
remote.publish(f"Add {data['name']} ({data['producer']})")
