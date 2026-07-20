"""
apply_research.py — Apply approved research changes from a research_review.py pass.

Writes each update to the DB, then does ONE export + commit + push for the whole
batch (not one per beer) so a review pass doesn't spam the git history.

Usage:
  python apply_research.py '[{"id": 90, "drink_after": "2027-11", "drink_by": "2032-11", "research": "..."}, ...]'
  python apply_research.py updates.json
"""

import json
import os
import subprocess
import sys

import db

REPO = '.'


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

    names = []
    for u in updates:
        beer = db.get_beer(u['id'])
        if not beer:
            print(f'Skipping unknown beer id {u["id"]}')
            continue
        db.update_beer_research(
            u['id'],
            drink_after=u.get('drink_after'),
            drink_by=u.get('drink_by'),
            research=u.get('research'),
        )
        names.append(beer['name'])
        print(f'Updated: {beer["name"]}')

    if not names:
        return

    subprocess.run([sys.executable, 'export_static.py'], cwd=REPO, check=True)
    subprocess.run(['git', 'add', '-A'], cwd=REPO, check=True)
    msg = f'Update research for {len(names)} beers: ' + ', '.join(names[:5]) + ('...' if len(names) > 5 else '')
    subprocess.run(['git', 'commit', '-m', msg], cwd=REPO, check=True)
    subprocess.run(['git', 'push'], cwd=REPO, check=True)
    print(f'\nCommitted and pushed {len(names)} updates.')


if __name__ == '__main__':
    main()
