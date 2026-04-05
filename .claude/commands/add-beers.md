# Add Beers from beers.md

Read `beers.md`. For each beer not already in the database, research and insert it using this fast workflow:

## Web Fetch Strategy

**Use `curl` (not WebFetch) for any site that may hang:**
```bash
curl --max-time 15 -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "URL"
```
WebFetch lacks a timeout and will hang indefinitely on slow servers. Use it only for Untappd (reliable). For everything else — Floodland bottle log, S3 images, unknown sites — use curl.

## Fast Research Workflow (time-box each beer to ~5 minutes)

### Step 1 — Identify the exact beer (1 fetch max)
Search Untappd: `https://untappd.com/search?q={brewery}+{beer+name}&type=beer`
- Gets you the exact Untappd URL + beer ID immediately
- If nothing found in 1 try, note "not on Untappd" and proceed with what you know
- **If multiple vintages/editions exist** (e.g. 2023 and 2025 versions of the same beer): STOP and ask the user to disambiguate before proceeding. Do not guess.

### Step 2 — Get data (1 fetch)
Fetch `https://untappd.com/b/{slug}/{id}` for: name, ABV, description, bottling date, image URL
- Image URL pattern: `assets.untappd.com/site/beer_logos/beer-{id}_{hash}_sm.jpeg`
- `_lg.jpeg` is always 403 — don't try it
- If image URL not found in page content, fetch it directly:
  ```bash
  curl --max-time 15 -sL -A "Mozilla/5.0" "https://untappd.com/b/{slug}/{id}" | grep -o 'beer_logos/beer-{id}[^"]*'
  ```

### Step 3 — Floodland beers only: get bottle log data AND image

**Extract all images from bottle log in one curl call:**
```bash
curl --max-time 15 -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  "https://www.floodlandbrewing.com/bottlelog/" \
  | grep -o 'efcheckout/floodlandbrewing/content/[^"]*'
```
This gives `path/Floodland-Brewing-{year}-{name}-image_set_1_img_1-{id}-large.webp` for each beer.
Full URL: `https://s3.amazonaws.com/{path}`

The bottle log is the **authoritative source** for Floodland drink windows (Adam Paysse's notes). It's also where the best label images come from — prefer these over Untappd thumbnails.

Always include this link in research: `[Floodland Brewing Bottle Log](https://www.floodlandbrewing.com/bottlelog/)`

### Step 4 — Get a good image (1 fetch, optional)
For small Untappd thumbnails (<5KB), try the photos page:
`https://untappd.com/b/{slug}/{id}/photos`
Look for `images.untp.beer/crop?width=1280` URLs — these are user check-in photos at 1280×1280.

### Step 5 — Download image and insert (per beer, one at a time)
```bash
# Download image
curl --max-time 15 -sL -A "Mozilla/5.0" -o "static/images/beers/beer_{id}.{ext}" "{image_url}"

# Insert beer (get the assigned id first, then download image)
python agent_add_beer.py '{...}'
```

**Insert each beer immediately after researching it** — don't batch up research then insert later. Iterative progress is better.

## Rules
- If a fetch returns wrong data or fails: try ONE alternate source, then move on — don't retry
- If curl hits `--max-time`, skip image fetch and use brewer logo fallback
- Insert each beer as soon as its data is ready — don't wait until all are researched. Iterative progress is preferred.
- After all beers inserted, run: `python -c "import app, db; db.init_db(); print('OK')"`
- Flag any beers that are past their drink_by date

## Year field rules
- Always populate `year` if there is any year information available — from the beer name, Untappd, or the bottle log.
- For blend beers with dual vintages (e.g. "MMXXIII/MMXXIV", "2022-2023 Blend"): use the **later** vintage year. The name already communicates the blend; the year field is for sorting and display.
- Roman numerals in Floodland names encode the year: MMXXI=2021, MMXXII=2022, MMXXIII=2023, MMXXIV=2024, MMXXV=2025.
- If the only year clue is the bottling date, use the bottling year as a fallback rather than leaving it blank.

## Python for downloading images (fallback if curl unavailable)
```python
import urllib.request
headers = {'User-Agent': 'Mozilla/5.0'}
req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req, timeout=10) as r:
    data = r.read()
open(dest, 'wb').write(data)
```
