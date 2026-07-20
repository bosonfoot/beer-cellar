"""
research_review.py — Re-research every beer in the cellar and report what changed.

Dry run only: never writes to the DB or touches git. Prints a diff report and
writes the same report to a markdown file for review.

Passes each beer's existing drink_after/drink_by/research to the research agent as
prior findings, so it only proposes a change when it finds something more authoritative
(see research_agent.py) instead of re-deriving a fresh guess every time.

Usage: python research_review.py [output_path]
"""

import sys
from datetime import date

from dotenv import load_dotenv

import db
import research_agent

load_dotenv()

OUTPUT = sys.argv[1] if len(sys.argv) > 1 else f'research_review_{date.today().isoformat()}.md'
TODAY = date.today().isoformat()[:7]  # YYYY-MM


def month(val):
    """Normalize a YYYY-MM or YYYY-MM-DD string to YYYY-MM so format-only diffs don't show up."""
    return val[:7] if val else None


def diff_beer(beer, new):
    changes = []
    for field, label in (('drink_after', 'Drink after'), ('drink_by', 'Drink by')):
        old_val, new_val = beer.get(field), new.get(field)
        if month(old_val) != month(new_val):
            changes.append((label, old_val, new_val))
    if (beer.get('research') or None) != (new.get('research') or None):
        changes.append(('Research note', beer.get('research'), new.get('research')))
    return changes


def flag_regressions(beer, new):
    """Cheap sanity checks independent of the model's own restraint — catch a dropped
    date or a drink_by that newly falls in the past when it didn't before."""
    flags = []
    for field, label in (('drink_after', 'drink_after'), ('drink_by', 'drink_by')):
        if beer.get(field) and not new.get(field):
            flags.append(f'dropped {label} (was {beer[field]}, search found nothing)')
    old_by, new_by = month(beer.get('drink_by')), month(new.get('drink_by'))
    if old_by and new_by and old_by >= TODAY > new_by:
        flags.append(f'drink_by moved from {beer["drink_by"]} to {new["drink_by"]} — now in the past (would flip to Past Peak)')
    return flags


def main():
    beers = [b for b in db.get_all_beers() if not b.get('date_imbibed') and b.get('label') != 'Test']
    print(f'Re-researching {len(beers)} beers (skipping imbibed/test)...\n')

    report_sections = []
    for i, beer in enumerate(beers, 1):
        print(f'[{i}/{len(beers)}] {beer["name"]} ({beer["brewer"]})')
        new = research_agent.fetch_research(
            beer['name'], beer['brewer'],
            year=beer.get('year'),
            date_bottled=beer.get('date_bottled'),
            considerations=beer.get('considerations'),
            existing_drink_after=beer.get('drink_after'),
            existing_drink_by=beer.get('drink_by'),
            existing_research=beer.get('research'),
        )
        if not new:
            print('  -> research failed, skipping')
            continue

        changes = diff_beer(beer, new)
        if not changes:
            print('  -> no change')
            continue

        regressions = flag_regressions(beer, new)
        print(f'  -> {len(changes)} field(s) changed' + (' — REGRESSION FLAGGED' if regressions else ''))

        section = [f'## {beer["name"]} ({beer["brewer"]}) — id {beer["id"]}']
        if regressions:
            section.append('**⚠ Possible regression:**')
            for r in regressions:
                section.append(f'- {r}')
        for label, old_val, new_val in changes:
            section.append(f'- **{label}**')
            section.append(f'  - was: {old_val or "_(none)_"}')
            section.append(f'  - now: {new_val or "_(none)_"}')
        report_sections.append('\n'.join(section))

    header = f'# Research review — {date.today().isoformat()}\n\n{len(report_sections)} of {len(beers)} beers have suggested changes.\n'
    report = header + '\n\n'.join(report_sections) if report_sections else header + '\nNo changes found.'

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(report)

    print(f'\nDone. Report written to {OUTPUT}')


if __name__ == '__main__':
    main()
