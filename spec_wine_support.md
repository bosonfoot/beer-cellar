# Spec: Wine Support in Beer Cellar App

## Context
The beer cellar app tracks bottles, aging windows, and tasting notes for beer. The user also has wines in their cellar and wants to evaluate whether wines can be added to the same app. This spec covers the research phase: what data sources exist, which are viable, and what a wine data model would look like.

---

## Key Differences: Wine vs. Beer

| Dimension | Beer | Wine |
|---|---|---|
| Rating scale | Untappd 0–5 | 100-point (Wine Spectator, Parker) or 20-point (Jancis Robinson) |
| Aging horizon | Months to ~10 years | Years to decades |
| Drinking window source | Research/style estimates | Professional critic scores (vintage-specific) |
| Identity | Brewery + beer name | Producer + wine name + vintage (all three required) |
| Volume unit | Cans/bottles, typically 750ml or 500ml | Bottles (750ml), magnums, etc. |

---

## API Options Evaluated

### ✅ Grapeminds Wine API — Selected: primary source
- **URL**: https://grapeminds.eu/developers
- **Base URL**: `https://api.grapeminds.eu/public/v1`
- **Auth**: `Authorization: Bearer <key>` header (key stored in `wine cellar API key.txt`, never committed to git)
- **Coverage**: 260,000+ wines
- **Cost**: Free tier — 250 requests/month (no credit card required); tiered paid plans above that. Sufficient for a personal cellar (one lookup per wine added).
- **Search endpoint**: `GET /wines/search?q=<query>&limit=N` — fuzzy full-text, min 3 chars, max 100 results
- **Wine detail endpoint**: `GET /wines/{id}` — returns producer, region, grapes, flavor profile, tasting notes, description, pairing
- **Drinking window endpoint**: `GET /drinking-periods/{id}` — returns `from` (years), `to` (years), prose statement, young/ripe descriptions, storage advice

**Drinking windows — important implementation note:** Windows are AI-generated on first request. If not yet available, the API returns `{"error": "...", "generating": true}`. This is intentional documented behavior — the client must **retry after ~30 seconds**. In practice, windows were ready within one retry in testing. The research agent must implement a retry loop (same pattern as beer's research agent polling).

**Ratings**: ❌ Not available from Grapeminds — must come from manual entry or a second source.

**Real-world test results** (May 2026):
| Wine | Found? | Tasting Notes | Flavor Profile | Drinking Window |
|---|---|---|---|---|
| Freycinet Vineyard Pinot Noir (Tasmania) | ✅ | None | None | 2–8 years (after retry) |
| Le Chiuse Brunello di Montalcino BIO | ✅ | None | None | 8–20 years (after retry) |
| Gode, Brunello di Montalcino, Vigna Montosoli | ✅ (see note) | None | None | 10–25 years (after retry) |
| Boscarelli Vino Nobile di Montepulciano Riserva | ✅ | None | Sweetness/acidity/tannins/body/finish scores | 6–20 years (after retry) |
| Market Vineyards, Derivative Red Wine, Columbia Valley 2021 | ❌ not in DB | — | — | — |

**Note on Le Gode**: The wine is in the database but the producer is stored as "Gode" — the "Le" prefix is dropped. Searching "Le Gode" returns no match; searching "Gode" finds it immediately. This is a producer name normalization quirk. The browser disambiguation step handles this gracefully (user sees "Gode, Brunello di Montalcino, Vigna Montosoli" in the results list and confirms), but the research agent should be aware that exact name matching will miss wines like this. Consider stripping common article prefixes (Le, La, Les, Il, I, De) before searching, or always showing the top N results for user confirmation rather than auto-selecting on an exact match.

**Takeaway**: Grapeminds has solid coverage including boutique Italian producers. Tasting notes and descriptions are largely absent across all wines tested; drinking windows are reliably generated after a short retry. The flavor profile scores (when present) are a useful bonus. Plan for a manual-entry fallback only for truly obscure wines and for absent tasting notes.

---

### ✅ Wine-Searcher API — Optional: ratings source
- **URL**: https://www.wine-searcher.com/trade/api
- **Coverage**: Aggregates scores from Wine Spectator, Robert Parker, Jancis Robinson (all on 100-point scale)
- **Drinking windows**: ❌ Not available
- **Cost**: 100 free calls/day (trial); $250/month for 500 calls/day in production
- **Verdict**: Best source for professional critic scores. Expensive for production, but 100/day may cover a personal cellar. Treat as optional enhancement — add wine works without it.

### ⚠️ Liv-ex API — Best quality, enterprise only
- Enterprise pricing; purpose-built for fine wine. Not worth it for a personal app.

### ⚠️ CellarTracker — No real API
- Export-only (CSV/XML). Useful for one-time bulk import if the user already has an account.

### ❌ Vivino — No public API (TOS violation to scrape)
### ❌ Wine.com API — Deprecated 2017

---

## Recommended Data Strategy

1. **Grapeminds** (free tier) — primary: wine identity, drinking window, flavor profile
2. **Manual entry fallback** — for wines not found in Grapeminds, or when tasting notes are absent
3. **Wine-Searcher** (optional, later) — augment with 100-point critic scores if desired

**Rating scale**: Store on a **100-point scale**. Also store `rating_source` (e.g., "Wine Spectator") since scores from different critics aren't directly comparable even after normalization.

---

## Proposed Wine Data Model

New `wines` table (see DB design decision below). Fields:

Shared with beer pattern (same semantics):
- `id`, `name`, `year` (vintage), `quantity`, `date_bottled`, `drink_after`, `drink_by`
- `date_imbibed`, `imbibe_notes`, `tasting_history` (via parent_id FK, same split-on-imbibe pattern as beer)
- `image_url`, `label`, `parent_id`, `date_added`

Wine-specific:
- `producer` — winery/estate name (maps to `brewer` concept)
- `region` — e.g., "Tuscany", "Napa Valley"
- `appellation` — e.g., "Brunello di Montalcino", "Pauillac" (often part of the wine name in Italian/French wines)
- `varietal` — e.g., "Sangiovese", "Cabernet Sauvignon" (may be multiple; store as comma-separated or JSON)
- `wine_type` — red / white / rosé / sparkling / dessert
- `rating` — numeric, 100-point scale
- `rating_source` — e.g., "Wine Spectator", "Robert Parker"
- `grapeminds_id` — store the Grapeminds wine ID to avoid re-lookups
- `flavor_profile` — JSON blob of Grapeminds scores (sweetness, acidity, tannins, alcohol, body, finish) when available
- `research` — prose drinking window statement from Grapeminds (maps to `research` field in beer)
- `considerations` — young/ripe descriptions, storage advice (maps to `considerations` in beer)

---

## UX Decision: Top-Level Section Switcher

Beers and wines will **not** be mixed in a single view. The page will have a top-level switcher (tab or toggle) showing either the Beer section or the Wine section — never both at once.

- Each section has its own column set
  - Beer: Name, Year, Brewer, ABV, Untappd Rating, Drink After, Drink By, Days Left, Status
  - Wine: Name, Vintage, Producer, Region, Varietal, Wine Type, Rating, Drink After, Drink By, Days Left, Status
- Each section has its own Add flow wired to the appropriate data source
- Filters and sort apply only within the active section
- The beer section is entirely unchanged from today's behavior
- Section switcher state persists via localStorage

---

## App Title Change

When wine support ships, rename the application from **"Beer Cellar"** to **"Lincoln's Cellar"**. This affects:
- The `<title>` tag and header in `index.html` / `templates/index.html`
- The header count line, which should update to show both sections:
  `XX beers (YY bottles) · ZZ wines (WW bottles)`
  Each count reflects only the active/non-imbibed entries in that section, same as the current beer count behavior.
- Any other hardcoded "Beer Cellar" strings in the codebase

The title change is a **public-facing change** and must ship as part of the same release as wine support, not before.

---

## Publish / Verification Gate

The entire wine feature — including the title rename — must be **fully verified locally before any commit touches the public GitHub Pages site** (`docs/`). Specifically:

- All backend changes (new `wines` table, API endpoints, research agent) can be committed dark as they have no effect on the public static site
- The `docs/` export must NOT be regenerated and pushed until:
  1. All automated tests pass (`test_battery.py` wine section, `test_research_agent_wine.py`)
  2. The browser UI checklist has been run via `/verify`
  3. The 5 seed wines are in the local DB and visible in the wine section
  4. The title shows "Lincoln's Cellar" and the counts show both beers and wines
- Use the same dark/hidden commit pattern already established for this project

---

## DB Design Decision: Two Tables

**Two separate tables** (`beers` and `wines`) rather than one combined table with a `type` column:
- Wine-specific columns would sit NULL on every beer row in a combined table, and vice versa
- Separate tables keep queries, migrations, and research agents independent
- No regression risk to existing beer functionality
- Shared patterns (quantity, imbibe tracking, tasting history, images) are implemented identically in both tables

---

## Implementation Notes

### Adding wines without a Grapeminds match (first-class requirement)

Not every wine will be in Grapeminds. Adding a wine that isn't found must be a smooth, supported path — not an error state. The user should be able to add any wine with just the fields they know, and fill in the rest (drinking window, region, varietal, etc.) later via the edit flow.

**Minimum required fields to add a wine:**
- Wine name
- Producer
- Vintage (year)
- Quantity

All other fields (region, appellation, varietal, wine_type, rating, drink_after, drink_by, research/notes) are optional at add time and editable later.

**CLI skill behavior when Grapeminds returns no match:**
- Inform the user no match was found
- Prompt to confirm they want to add it manually with the fields parsed from their input
- Insert with available fields; leave wine-specific fields blank

**Browser UI behavior when Grapeminds returns no match:**
- Show "No results found" in the disambiguation step with a clear "Add manually" option
- The manual form pre-fills producer, year, and wine name from the structured input fields
- All optional fields are editable inline; the user doesn't need to fill them in to save

### CLI: `add-wine` skill
Mirror the existing `add-beer` Claude Code skill. The `add-wine` skill should:
- Accept a run-on sentence input (e.g. `market vineyards derivative red wine columbia valley 2021`)
- Extract the year (4-digit number) and pass the rest to Grapeminds fuzzy search
- Present top matches for confirmation, or confirm manual entry if no match found
- Fetch full detail + drinking window (with retry if `generating: true`) when a match is selected
- Insert into the `wines` table with whatever fields are available
- Follow the same commit/push conventions as `add-beer`

### Browser: Wine Add Flow with Disambiguation
The browser-based Add Wine flow should present **search results as a disambiguation step** when the query returns multiple matches — same concept as the beer add flow's Step 2 (results list). This is especially important for wine because:
- Many wines share a name across vintages and producers
- Grapeminds search is fuzzy, so partial matches are common
- The user needs to confirm the correct wine before the research step runs

Flow: Enter name + producer (+ optional vintage) → Show top N matches from Grapeminds with producer/region/color → User selects or chooses "Add manually" → Fetch full detail + drinking window → Confirm and save.

### Research Agent: `research_agent_wine.py`
New file mirroring `research_agent.py` structure:
- Calls `GET /wines/search` to find the wine
- Calls `GET /wines/{id}` for full detail
- Calls `GET /drinking-periods/{id}` with retry loop if `generating: true` (poll up to ~3 times, 30s apart)
- Maps Grapeminds fields to `wines` table columns
- Falls back gracefully if wine not found (leaves window fields blank for manual entry)
- API key loaded from environment variable `GRAPEMINDS_API_KEY` (set from `wine cellar API key.txt`, never committed)

### API Key Security
- `wine cellar API key.txt` must be added to `.gitignore`
- In production, expose as env var `GRAPEMINDS_API_KEY` in `.env` (already gitignored)

---

## Seed Data: Wines to Enter on Plan Completion

As the final step of plan execution, these five wines should be automatically inserted into the `wines` table using the `add-wine` skill or equivalent script.

| Wine | Vintage | Grapeminds ID | Quantity | Notes |
|---|---|---|---|---|
| Freycinet Vineyard, Pinot Noir | 2024 | 316863 | 1 | Tasmania; 2–8 yr window |
| Le Chiuse, Brunello di Montalcino BIO | 2013 | 90458 | 1 | Tuscany; 8–20 yr window |
| Gode, Brunello di Montalcino, Vigna Montosoli | 2016 | 308558 | 1 | Brunello di Montalcino; 10–25 yr window |
| Boscarelli, Vino Nobile di Montepulciano Riserva | 2017 | 62624 | 1 | Tuscany; 6–20 yr window |
| Market Vineyards, Derivative Red Wine, Columbia Valley | 2021 | ❌ not in Grapeminds | 1 | Manual entry; red blend; Washington State |

For the first four, fetch fresh detail + drinking window by Grapeminds ID (windows are pre-generated, no retry delay expected). For Market Vineyards Derivative, insert via manual entry with the fields below:
- Producer: Market Vineyards
- Wine name: Derivative Red Wine
- Region: Columbia Valley
- Wine type: red
- Vintage: 2021
- Drinking window: set manually (suggest leaving blank for user to fill in, or research separately)

---

## Test Strategy

Tests should run automatically as part of plan execution — no manual steps required beyond starting the local server.

### 1. Research Agent (`research_agent_wine.py`) — automated script

Write a `test_research_agent_wine.py` that exercises the agent directly:

- **Happy path**: Search for "Boscarelli Vino Nobile Riserva" → assert a result is returned, `drink_after` and `drink_by` are populated, `region` is Tuscany
- **Retry path**: Call `/drinking-periods/{id}` on a wine whose window hasn't been generated yet; mock `generating: true` on the first call and assert the agent retries and succeeds on the second
- **Producer name normalization**: Search "Le Gode Vigna Montosoli" → assert that Gode (id 308558) is returned despite the "Le" prefix mismatch
- **Not found / manual fallback**: Search "Market Vineyards Derivative Columbia Valley" → assert Grapeminds returns no match, agent returns a graceful empty result (no exception), and the caller receives a clear signal to fall back to manual entry
- **API key missing**: Run with `GRAPEMINDS_API_KEY` unset → assert a clear error is raised at startup, not mid-request

#### CLI skill input parsing — run-on sentence style

The `add-wine` skill receives input as a single unstructured string, e.g.:
> `market vineyards derivative red wine columbia valley 2021`

The skill must parse this into structured fields before searching. Test cases covering the range of real inputs:

| Input string | Expected parse |
|---|---|
| `market vineyards derivative red wine columbia valley 2021` | producer: Market Vineyards, name: Derivative Red Wine, region: Columbia Valley, year: 2021 |
| `2013 le chiuse brunello di montalcino` | producer: Le Chiuse, name: Brunello di Montalcino, year: 2013 |
| `gode vigna montosoli brunello 2016` | producer: Gode, name: Vigna Montosoli Brunello, year: 2016 |
| `freycinet pinot noir 2024` | producer: Freycinet, name: Pinot Noir, year: 2024 |
| `boscarelli vino nobile montepulciano riserva 2017` | producer: Boscarelli, name: Vino Nobile di Montepulciano Riserva, year: 2017 |

Note: exact parsing accuracy matters less than search result quality — the research agent should pass the full string (or lightly cleaned version) to Grapeminds and rely on its fuzzy matching, then surface the top results for user confirmation. The parser's job is mainly to extract the year (4-digit number) and pass the remainder as the search query.

### 2. API endpoints — extend `test_battery.py`

Add a `wines` section to the existing test battery mirroring the beer tests:

- `POST /api/wines` → 201, returns wine record with all fields
- `GET /api/wines` → 200, list includes the added wine
- `GET /api/wines/{id}` → 200, correct fields including `tasting_history: []`
- `PUT /api/wines/{id}` → 200, field update persists
- `POST /api/wines/{id}/imbibe` (qty=1) → beer imbibed, `date_imbibed` set, `tasting_history` still empty
- `POST /api/wines/{id}/imbibe` (qty=2) → split: original qty becomes 1, new imbibed record created with `parent_id`, original's `tasting_history` has one entry
- `DELETE /api/wines/{id}` → 204, subsequent GET returns 404
- Auth: all mutating endpoints return 403 without a valid session

### 3. Browser UI — manual checklist (run via `/verify` skill after implementation)

- [ ] Section switcher is visible on page load; clicking "Wine" switches the view, "Beer" returns to beer — beer data unchanged
- [ ] Wine table shows wine-specific columns (Vintage, Producer, Region, Varietal, Wine Type, Rating)
- [ ] Add Wine flow: typing a partial name shows disambiguation results from Grapeminds; selecting one fills in all metadata; drinking window appears after research completes
- [ ] Add Wine → "Add manually" path works with no Grapeminds lookup (test with Market Vineyards Derivative — confirm it's not found in Grapeminds and the manual form pre-fills producer/region/year from the structured fields)
- [ ] Imbibe a wine with qty=1: record moves to bottom, shows "Happily Imbibed" badge, tasting notes saved
- [ ] Imbibe a wine with qty=2: qty decrements to 1, new imbibed row appears, modal shows "Previous Tastings" section
- [ ] Wine modal shows flavor profile scores when present (e.g. Boscarelli)
- [ ] Section switcher state persists on page reload (localStorage)
- [ ] Beer section: open it after all wine operations and confirm zero regressions

### 4. Seed data verification

After running the seed script (see above), assert:
- All 5 wines appear in `GET /api/wines`
- The 4 Grapeminds-sourced wines each have `drink_after` and `drink_by` populated (not null) and `region` populated
- Market Vineyards Derivative has `producer`, `wine_type`, `region`, and `year` populated; `drink_after`/`drink_by` may be null (manual entry)
- Wine section switcher shows all 5 wines in the UI

---

## Resolved Implementation Details (from gap analysis)

### Grapeminds API response shapes (confirmed in testing)

**`GET /wines/search?q=...&limit=N`**
```json
{
  "data": [
    { "id": 62624, "display_name": "Boscarelli, Vino Nobile di Montepulciano Riserva",
      "color": "red", "residual_sugar": null,
      "producer_name": "Boscarelli", "producer_title": null, "producer_display_name": "Boscarelli" }
  ],
  "meta": { "query": "...", "count": 2 }
}
```

**`GET /wines/{id}`**
```json
{
  "data": {
    "id": 62624, "display_name": "...", "color": "red", "type": "wine", "sub_type": "still",
    "residual_sugar": null,
    "producer": { "id": 3789, "name": "Boscarelli", "title": null, "display_name": "Boscarelli" },
    "region": { "id": 190, "name": "Tuscany", "country": "it", "language": "en" },
    "grapes": [ { "id": 152398, "name": "Sangiovese (Prugnolo Gentile)" } ],
    "description": null, "pairing": null, "tasting_notes": null,
    "flavor_profile": { "sweetness": 1, "acidity": 7, "tannins": 8, "alcohol": 7, "body": 7, "finish": 8 }
  }
}
```

**`GET /drinking-periods/{id}`** — success:
```json
{
  "id": 13638, "wine_id": 62624, "lang": "en",
  "from": 6, "to": 20,
  "statement": "...", "young": "...", "ripe": "...", "storage": "..."
}
```
**`GET /drinking-periods/{id}`** — not yet generated:
```json
{ "error": "Drinking period not found for the specified language.", "generating": true }
```

### Field mappings: Grapeminds → `wines` table

| Grapeminds field | DB column | Notes |
|---|---|---|
| `data.producer.name` | `producer` | |
| `data.display_name` | `name` | Full display name including appellation |
| `data.region.name` | `region` | |
| `data.grapes[].name` joined by `, ` | `varietal` | Comma-separated TEXT |
| `data.color` | `wine_type` | red / white / rosé / sparkling |
| `data.id` | `grapeminds_id` | INTEGER, nullable (NULL for manual-entry wines) |
| `data.flavor_profile` | `flavor_profile` | JSON text blob, nullable |
| `drinking_period.statement` | `research` | Maps to same `research` field as beer |
| `drinking_period.young + ripe + storage` | `considerations` | Concatenated with labels |
| `vintage + drinking_period.from` | `drink_after` | e.g. 2016 + 10 = `2026-01-01` |
| `vintage + drinking_period.to` | `drink_by` | e.g. 2016 + 25 = `2041-12-31` |

**`drink_after`/`drink_by` calculation**: Grapeminds returns integer year offsets (`from`, `to`). Add to vintage year. Use `YYYY-01-01` for `drink_after` and `YYYY-12-31` for `drink_by` to match the existing date format in the beers table.

### Retry logic for `generating: true`
- Max 3 attempts, 30 seconds between each
- On third failure: insert wine with NULL `drink_after`, `drink_by`, `research`, `considerations`; log a warning
- Implementation: plain `time.sleep(30)` loop in `research_agent_wine.py` (same threading model as `_publish_background` in app.py — called from a daemon thread, so blocking sleep is fine)

### DB schema decisions
- `year` column (not `vintage`) — mirrors beer table; displayed as "Vintage" in the UI
- `varietal`: TEXT, comma-separated, nullable
- `grapeminds_id`: INTEGER, nullable (NULL = manual-entry wine); no UNIQUE constraint (same wine could theoretically be added twice)
- `flavor_profile`: TEXT (JSON blob), nullable
- Migration: same `init_db()` forward-compatible migration pattern as beers — add migrations list to `db.py`

### API endpoints
Wine endpoints mirror beer exactly: `/api/wines`, `/api/wines/{id}`, `/api/wines/{id}/imbibe`, `/api/wines/{id}/research`. Imbibe returns `{"wine": {...}, "imbibed_record": {...}}` matching the beer pattern.

### Imbibe behavior
Identical to beer: `imbibe_wine()` function in `db.py` mirrors `imbibe_beer()`. Split-on-imbibe works the same way. `tasting_history` is fetched via `parent_id` FK in `get_wine()`.

### Research agent
- File: `research_agent_wine.py` (new file, mirrors `research_agent.py` structure)
- Auth: `Authorization: Bearer {key}` header; key from `GRAPEMINDS_API_KEY` env var (loaded from `.env`)
- Producer name normalization: if search returns 0 results, strip leading articles (`Le`, `La`, `Les`, `Il`, `I`, `Gli`, `De`, `Du`) and retry once
- No-match return value: `None` — caller treats this as the signal to fall back to manual entry

### CLI skill
- File: `.claude/commands/add-wines.md` (mirrors `.claude/commands/add-beers.md`)
- Input parsing: extract the 4-digit year; pass the full remaining string to Grapeminds fuzzy search. Do NOT attempt to parse producer vs. wine name — rely on Grapeminds disambiguation and user confirmation. The parse table in the test strategy section describes *expected search quality*, not pre-search parsing.

### Export / static site
- `export_static.py` updated to also query and export `wines` table
- `docs/cellar.json` restructured to `{"beers": [...], "wines": [...]}` — both sections present on the public site
- Frontend JS reads `cellar.json.beers` and `cellar.json.wines` separately for each section

### Section switcher
- Visual style: **tabs** in the header (Beer | Wine), replacing or adjacent to the current title
- Active tab tracked in `localStorage` key `cellar_section`; defaults to `beer` if unset or if the stored value is invalid

### Disambiguation results list layout
Each result shows the wine name on one line, then `Producer · Region · Color` on a second line. Year is not shown (Grapeminds results are not vintage-specific; the year comes from the user's input and is the same across all results). Example:
```
Gode, Brunello di Montalcino, Vigna Montosoli
Gode · Brunello di Montalcino · Red
```

### Status badge for wines with no drinking window
Use a new **"Not Set"** badge (distinct from the existing "Unknown" badge used for beers). "Unknown" implies the window can't be determined; "Not Set" signals it simply hasn't been researched yet and can be filled in later. Add `badge-not-set` CSS class alongside the existing badge classes.

### Frontend column sort keys
Wine table `data-col` values: `name`, `year` (vintage), `producer`, `region`, `varietal`, `wine_type`, `rating`, `drink_after`, `drink_by`, `days_left`. Numeric sort: `year`, `rating`, `days_left`.

### Flavor profile display
Show in the wine modal as a simple labeled list when present (e.g. "Acidity 7 · Tannins 8 · Body 7 · Finish 8"). No bar chart needed. CSS class `.flavor-profile`.

### App title
Hardcoded in `templates/index.html` `<title>` and header `<h1>`. Change "Beer Cellar" → "Lincoln's Cellar" in the same commit that first exports wine support to `docs/`.

### Database migration ownership
`db.py` `init_db()` — add `wines` table creation and forward-compatible migration list, same pattern as `beers`.

---

## Open Implementation Questions

1. **Varietal storage**: Resolved — comma-separated TEXT. *(Resolved.)*
2. **Drinking window for manual-entry wines**: Leave blank at add time; user fills in via edit. *(Resolved.)*
3. **Flavor profile display**: Labeled inline list in modal. *(Resolved.)*
