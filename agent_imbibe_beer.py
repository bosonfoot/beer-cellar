"""
Mark a beer as "Happily Imbibed" — keeps it in the database but moves it to
the bottom of the cellar view and marks it as consumed.

Usage: python agent_imbibe_beer.py <id>

Example:
  python agent_imbibe_beer.py 3
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import db

if len(sys.argv) < 2:
    print("Usage: python agent_imbibe_beer.py <id>")
    sys.exit(1)

beer_id = int(sys.argv[1])
beer = db.get_beer(beer_id)

if not beer:
    print(f"No beer found with id={beer_id}")
    sys.exit(1)

if beer['date_imbibed']:
    print(f"'{beer['name']}' was already imbibed on {beer['date_imbibed']}")
    sys.exit(0)

db.imbibe_beer(beer_id)
print(f"Happily Imbibed: '{beer['name']}' (id={beer_id})")
