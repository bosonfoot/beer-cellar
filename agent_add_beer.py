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
)

print(f"Added '{data['name']}' with id={beer_id}")
