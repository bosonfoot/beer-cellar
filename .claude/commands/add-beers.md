# Add Beers from beers.md

Read `beers.md`. For each beer not already in the database, research and insert it using this workflow:

## Web Fetch Strategy

- **Untappd search page**: JS-rendered — use **WebSearch** to find the beer ID, not a fetch
- **Untappd beer page** (`untappd.com/b/{slug}/{id}`): use **WebFetch** (reliable, renders JS)
- **Floodland bottle log, S3 images, unknown sites**: use **curl** — WebFetch may hang
  ```bash
  curl --max-time 15 -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "URL"
  ```

## Fast Research Workflow (time-box each beer to ~5 minutes)

### Step 1 — Find the beer on Untappd (WebSearch)
Search: `"{brewery}" "{beer name}" site:untappd.com`
- Get the exact URL: `untappd.com/b/{slug}/{id}` — the numeric ID is what matters
- If multiple vintages/editions exist (e.g. 2023 vs 2025): **STOP and ask the user** before proceeding
- If not on Untappd: note it and proceed with what you know

### Step 2 — Fetch beer data (WebFetch on the beer page)
Fetch `https://untappd.com/b/{slug}/{id}` for: name, ABV, description, rating, and **image URL**.

**Image URL — this is critical:** look for the pattern `beer_logos/beer-{id}_{hash}_sm.jpeg`
- The hash is a short alphanumeric string (e.g. `7dc60`) embedded in the page — it's only visible via WebFetch (not curl)
- Full URL: `https://assets.untappd.com/site/beer_logos/beer-{id}_{hash}_sm.jpeg`
- `_lg.jpeg` is always 403 — only use `_sm.jpeg`
- Do NOT use `next.untappd.com/og/beer/{id}` — that returns a social card composite, not label art
- If no `beer_logos` URL is found: check `untappd.com/b/{slug}/{id}/photos` for user photos (`images.untp.beer/crop?width=1280`)

### Step 3 — Floodland beers only: bottle log data AND image
```bash
curl --max-time 15 -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  "https://www.floodlandbrewing.com/bottlelog/" \
  | grep -o 'efcheckout/floodlandbrewing/content/[^"]*'
```
Returns `path/Floodland-Brewing-{year}-{name}-image_set_1_img_1-{id}-large.webp` per beer.
Full URL: `https://s3.amazonaws.com/{path}`

The bottle log is authoritative for Floodland drink windows (Adam Paysse's notes). Prefer its images over Untappd thumbnails. Always include this link in research: `[Floodland Brewing Bottle Log](https://www.floodlandbrewing.com/bottlelog/)`

### Step 4 — Download image
```bash
curl --max-time 15 -sL -A "Mozilla/5.0" -o "static/images/beers/beer_{untappd_id}.{ext}" "{image_url}"
```
- Name the file using the **Untappd ID**, not the DB id (e.g. `beer_4009.jpeg`)
- If no image found after one retry: omit `image_url` — `agent_add_beer.py` will fall back to the brewery default in `brewery_defaults.json`

### Step 5 — Insert (one beer at a time)
```bash
python agent_add_beer.py '{
  "name": "...",
  "brewer": "...",
  "year": 2024,
  "abv": 6.0,
  "quantity": 1,
  "date_bottled": "YYYY-MM-DD",
  "drink_after": "YYYY-MM-DD",
  "drink_by": "YYYY-MM-DD",
  "image_url": "/static/images/beers/beer_{untappd_id}.jpeg",
  "untappd_rating": 3.9,
  "research": "...",
  "food_pairings": "...",
  "considerations": "..."
}'
```

`agent_add_beer.py` automatically:
1. Snaps brewer name casing to match existing DB entries
2. Blocks near-miss brewer names (e.g. "Brouwerij 3 Fonteinen" → error, use "3 Fonteinen")
3. Falls back to `brewery_defaults.json` image if no `image_url` given
4. Rebuilds the static site (`export_static.py`)
5. Commits and pushes to GitHub

**Insert each beer immediately after researching it** — don't batch.

### Step 6 — Update beers.md
Mark each inserted beer in `beers.md` with `✓ added` on the same line, or add a new line if it came from the chat.

## Brewer name rules
- Match existing DB entries exactly — query `SELECT DISTINCT brewer FROM beers` if unsure
- Drop foreign-language prefixes: "Brouwerij", "Brasserie", "Cervecería" etc.
- Keep English "Brewing" / "Brewing Co." if it's genuinely part of the name

## Year field rules
- Always populate `year` if any year info is available
- Dual vintages (e.g. "MMXXIII/MMXXIV"): use the **later** year
- Roman numerals: MMXXI=2021, MMXXII=2022, MMXXIII=2023, MMXXIV=2024, MMXXV=2025
- If only the bottling date is known, use the bottling year

## Other rules
- Flag any beers past their `drink_by` date
- If a fetch fails or returns wrong data: try ONE alternate source, then move on
