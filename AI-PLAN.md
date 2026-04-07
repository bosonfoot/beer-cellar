# Beer Cellar — Product Spec

## Who this is for

A solo hobbyist who collects aging craft beers — primarily wild ales, lambics, and farmhouse saisons. These are bottles that sit in a cellar for years. The owner buys them, forgets the details, and needs help knowing which ones to drink now versus which ones to leave alone.

The app is for personal use. One owner, potentially shared with guests as a read-only link.

---

## The core problem

Aging beer has a drinking window. Open it too early and it's underdeveloped. Wait too long and it's past peak. The owner has 20–30 bottles at any time and can't remember which ones are urgent. The app should answer: **"What should I open tonight?"** at a glance.

---

## Core features

### 1. The cellar view

A list of all bottles in the cellar. At a glance, each bottle should show:
- Name and brewery
- How urgent it is to drink (or how long until it's ready)
- A label image if available

The default sort should surface the most time-sensitive bottles first. The owner should be able to filter and sort by different attributes.

### 2. Bottle detail

Tapping/clicking a bottle opens a detail view with everything known about it:
- Drinking window (when it's ready, when it peaks out)
- Vintage year, ABV, when it was bottled, how many bottles are in the cellar
- Research: style notes, aging guidance, source links
- Food pairings
- Other considerations (storage, rarity, production notes)
- When it was added to the cellar
- If already consumed: when it was opened and any tasting notes

### 3. Adding a bottle

Only the owner can add bottles (password protected). The add flow should:
- Let the owner search Untappd (or a similar beer database) to pre-fill details
- Fall back to manual entry if the beer isn't found
- Before saving, the agent doing the add should research the beer — look up the brewer's official notes, find the drinking window, write a summary of what makes this beer special. This research goes into the `research`, `food_pairings`, and `considerations` fields.

**On research:** For Floodland Brewing specifically, the brewer publishes precise bottling dates, drink windows, and tasting notes at their bottle log (floodlandbrewing.com/bottlelog). Other breweries may have similar resources. Untappd community check-ins are also a useful signal for how a beer is evolving.

**On drinking windows:** If the brewer gives an explicit window, use it. If not, infer from style, ABV, barrel aging, and community notes. A brett-conditioned farmhouse ale ages differently than a fruit lambic; factor in what you know about the category.

### 4. Consuming a bottle ("Happily Imbibed")

When the owner opens a bottle, they mark it as consumed. This:
- Records the date and optionally a tasting note
- Moves the bottle to the bottom of the cellar view (it's a historical record, not an active bottle)
- Does **not** require a password — the owner may hand their phone to a guest or log this casually. Only adding and deleting bottles requires auth.

There is no "undo" for consuming a bottle. Deletion is the only way to remove a record.

### 5. Status system

Every bottle has a status, computed from today's date. The statuses and their order of precedence:

- **Happily Imbibed** — bottle has been consumed (check this first)
- **Unknown** — no drinking window data available
- **Past Peak** — the drink-by date has passed
- **Drink Now** — we're inside the drinking window
- **Peak Approaching** — the window opens within 60 days
- **Aging** — still waiting

**Important nuance on sorting by urgency:** "Drink Now" and "Peak Approaching" both show a day count, but they measure different things. A "Drink Now" beer showing 30 days means *30 days left before it goes past peak*. A "Peak Approaching" beer showing 20 days means *20 days until it's ready*. These should not be interleaved when sorting — "Drink Now" bottles are categorically more urgent than "Peak Approaching" bottles, regardless of the day counts.

### 6. Quantity

Some bottles are owned in multiples (e.g., two bottles of the same beer). Track quantity and show it clearly. Consuming a bottle marks the entire entry — there's no per-bottle tracking.

---

## Non-obvious requirements

- **Brewer names should be consistent.** The brewer field is used for grouping and image lookup. Don't use foreign-language legal prefixes — "3 Fonteinen" not "Brouwerij 3 Fonteinen"; "Cantillon" not "Brasserie Cantillon." When adding a beer from a brewery already in the cellar, match the existing name exactly.

- **Dates on bottles aren't always bottling dates.** Some bottles print a best-before date rather than a bottling date. A date printed as `12/10/2034` is clearly a best-before, not when the beer was made. Use it as the drink-by date; leave the bottled date blank.

- **The drinking window is month-granular.** "Ready in April 2027" is the right level of precision — day-of-month doesn't matter for cellaring decisions.

---

## Beers to add

Research and add each of the following. For each one, find the drinking window, write up the research, food pairings, and any notable considerations. Use Untappd for ratings and label images. Check the brewer's own resources where available.

```
Floodland Brewing
  2021 Muscat
  2024 Sen XXVI
  Ill Fate
  Flowers of the Field
  Field Blend
  Winesap 2024
  MMXXII/MMXXIV True-Nature
  Nothing Ever Begins 2024
  2025 Monarchist
  I Want to Be Known
  MMXXIV Gruner Veltliner

De Garde Brewing
  The Unblended Armagandias (bottled 3/21)
  The Vintage 2018 — 2 bottles
  Temps & Poivre 2024
  Between Two Toms 2025

3 Fonteinen
  2018 Oude Geuze Cuvee Armand & Gaston
  Oude Geuze (bottled 2018-11-26, best before 2038-10-26)
  Langste Nacht 2019 Karwijzaad

Side Project Brewing
  Tete de Cuvee 2022
  Oude Fermier 2022

De Cam
  Kriek — note: the date on this bottle (12/10/2034) is the best-before, not the bottling date

Cantillon
  Saint Lamvinus 2023
  Saint Lamvinus 2024
  Sang Bleu 2025
  Magic Lambic 2025
  Ashanti 2025

Holy Mountain Brewing
  Vesper (2025 bottling) — 2 bottles
```

---

## What done looks like

- All 27 bottles in the cellar with researched drinking windows, notes, and food pairings
- The default view immediately communicates which bottles are most urgent
- Sorting by urgency keeps "Drink Now" bottles above "Peak Approaching" bottles
- Consumed bottles sink to the bottom
- The add flow makes it easy to look up a beer and let the agent fill in the research
- Works well on both desktop and mobile
