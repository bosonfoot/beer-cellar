"""
DEPRECATED: Use agent_imbibe_beer.py instead to mark a beer as consumed
while keeping it in the database history.

This script permanently deletes a beer — only use if a beer was added by mistake.

Usage: python agent_remove_beer.py <id>
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import db

if len(sys.argv) < 2:
    print("Usage: python agent_remove_beer.py <id>")
    sys.exit(1)

beer_id = int(sys.argv[1])
beer = db.get_beer(beer_id)

if not beer:
    print(f"No beer found with id={beer_id}")
    sys.exit(1)

db.delete_beer(beer_id)
print(f"Removed '{beer['name']}' (id={beer_id})")
