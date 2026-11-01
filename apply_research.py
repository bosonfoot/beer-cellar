"""
apply_research.py — Apply approved research changes from a research_review.py pass.

Writes each update to the live site (the master DB), then refreshes the local cache and
does ONE export + commit + push for the whole batch (not one per beer) so a review
pass doesn't spam the git history.

Usage:
  python apply_research.py '[{"id": 90, "drink_after": "2027-11", "drink_by": "2032-11", "research": "..."}, ...]'
  python apply_research.py updates.json
"""

import json
import os
import sys

import db
import remote

FIELDS = ['name', 'brewer', 'year', 'abv', 'quantity', 'date_bottled', 'drink_after', 'drink_by',
          'research', 'food_pairings', 'considerations', 'label']


def main():
    arg = sys.argv[1]
    if os.path.isfile(arg):
        with open(arg, encoding='utf-8') as f:
            updates = json.load(f)
    else:
        updates = json.loads(arg)
    if not updates:
        print('No updates given.')
        return

    remote.pull()
    names = []
    for u in updates:
        beer = db.get_beer(u['id'])
        if not beer:
            print(f'Skipping unknown beer id {u["id"]}')
            continue
        payload = {f: beer.get(f) for f in FIELDS}
        for f in ('drink_after', 'drink_by', 'research'):
            if u.get(f) is not None:
                payload[f] = u[f]
        remote.call('PUT', f'/api/beers/{u["id"]}', payload)
        names.append(beer['name'])
        print(f'Updated: {beer["name"]}')

    if not names:
        return

    remote.pull()
    msg = f'Update research for {len(names)} beers: ' + ', '.join(names[:5]) + ('...' if len(names) > 5 else '')
    remote.publish(msg)
    print(f'\nUpdated {len(names)} beers.')


if __name__ == '__main__':
    main()
