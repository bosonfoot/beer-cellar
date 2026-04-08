import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.parse

import requests

BASE_URL = "https://untappd.com"
TIMEOUT = 15

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

IMAGES_DIR = os.path.join(os.path.dirname(__file__), "static", "images", "beers")


def _parse_abv(text):
    m = re.search(r'(\d+\.?\d*)\s*%', text)
    return float(m.group(1)) if m else None


def _parse_rating(text):
    m = re.search(r'(\d+\.\d+)', text)
    return float(m.group(1)) if m else None


def search_beers(query, brewery=""):
    """Search Untappd directly. Returns list of dicts with name, brewer, style,
    abv, rating, label_url, untappd_id, slug."""
    q = query
    if brewery:
        q += " " + brewery
    url = f"{BASE_URL}/search?q={urllib.parse.quote(q)}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        if resp.status_code != 200:
            return []
        html = resp.text
    except Exception:
        return []

    results = []
    # Each beer result is in a <li class="beer-item ..."> block
    for item in re.finditer(r'class="beer-item[^"]*"[^>]*>(.*?)</li>', html, re.DOTALL):
        block = item.group(1)

        # Beer URL → slug + id
        url_m = re.search(r'href="/b/([a-z0-9\-]+)/(\d+)"', block)
        if not url_m:
            continue
        slug = url_m.group(1)
        untappd_id = int(url_m.group(2))

        # Name
        name_m = re.search(r'class="name"[^>]*>.*?<a[^>]*>([^<]+)</a>', block, re.DOTALL)
        name = name_m.group(1).strip() if name_m else None

        # Brewer
        brewer_m = re.search(r'class="brewery"[^>]*>.*?<a[^>]*>([^<]+)</a>', block, re.DOTALL)
        brewer = brewer_m.group(1).strip() if brewer_m else None

        # Style
        style_m = re.search(r'class="style"[^>]*>([^<]+)<', block)
        style = style_m.group(1).strip() if style_m else None

        # ABV
        abv_m = re.search(r'class="abv"[^>]*>\s*([\d.]+)%', block)
        abv = float(abv_m.group(1)) if abv_m else None

        # Rating
        rating_m = re.search(r'data-rating="([\d.]+)"', block)
        rating = float(rating_m.group(1)) if rating_m else None

        # Label image
        img_m = re.search(r'a class="label"[^>]*>.*?<img src="([^"]+)"', block, re.DOTALL)
        label_url = img_m.group(1) if img_m else None

        if name:
            results.append({
                "untappd_id": untappd_id,
                "slug": slug,
                "name": name,
                "brewer": brewer,
                "style": style,
                "abv": abv,
                "rating": rating,
                "label_url": label_url,
                "description": None,
                "image_url": None,
            })

    return results[:8]


def get_beer(untappd_id, slug):
    """Fetch full details for one beer. Downloads label to disk. Returns dict or None."""
    url = f"{BASE_URL}/b/{slug}/{untappd_id}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        if resp.status_code != 200:
            return None
        html = resp.text
    except Exception:
        return None

    result = {
        "untappd_id": untappd_id,
        "slug": slug,
        "name": None,
        "brewer": None,
        "style": None,
        "abv": None,
        "rating": None,
        "description": None,
        "label_url": None,
        "image_url": None,
    }

    # JSON-LD — name, description, rating, brewer
    ld_m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
    if ld_m:
        try:
            ld = json.loads(ld_m.group(1))
            result["name"] = ld.get("name")
            result["description"] = ld.get("description")
            rv = (ld.get("aggregateRating") or {}).get("ratingValue")
            if rv:
                result["rating"] = float(rv)
            result["brewer"] = (ld.get("brand") or {}).get("name")
            # Untappd JSON-LD often bakes the brewery name into the beer name
            # (e.g. "Brouwerij Boon Geuze Mariage Parfait"). Strip it.
            if result["name"] and result["brewer"]:
                prefix = result["brewer"] + " "
                if result["name"].startswith(prefix):
                    result["name"] = result["name"][len(prefix):]
        except (json.JSONDecodeError, AttributeError):
            pass

    # Style from <meta name="description">
    # Format: "Beer Name by Brewery is a Style which has a rating of X.X..."
    meta_m = re.search(r'<meta name="description" content="([^"]+)"', html)
    if meta_m:
        meta = meta_m.group(1)
        style_m = re.search(r' is a ([^w][^h][^i][^c][^h].+?) which has', meta)
        if not style_m:
            # Fallback: grab text after "is a " up to " with" or period
            style_m = re.search(r' is an? (.+?)(?:\s+which|\s+with|\.)', meta)
        if style_m:
            result["style"] = style_m.group(1).strip()

    # ABV from raw HTML
    abv_m = re.search(r'(\d+\.?\d*)\s*%\s*ABV', html)
    if abv_m:
        result["abv"] = float(abv_m.group(1))

    # Label image — beer_logos hash pattern is most reliable
    logo_m = re.search(r'beer_logos/beer-(\d+)_([a-f0-9]+)_sm\.jpeg', html)
    if logo_m:
        result["label_url"] = (
            f"https://assets.untappd.com/site/beer_logos/"
            f"beer-{logo_m.group(1)}_{logo_m.group(2)}_sm.jpeg"
        )

    if not result["name"]:
        return None

    # Download label image
    if result.get("label_url"):
        local = _download_label(untappd_id, result["label_url"])
        if local:
            result["image_url"] = local

    return result


def _download_label(untappd_id, label_url):
    os.makedirs(IMAGES_DIR, exist_ok=True)
    local_filename = f"beer_{untappd_id}.jpeg"
    local_path = os.path.join(IMAGES_DIR, local_filename)
    if os.path.exists(local_path):
        return f"/static/images/beers/{local_filename}"
    try:
        resp = requests.get(label_url, headers=HEADERS, timeout=TIMEOUT, stream=True)
        if resp.status_code == 200:
            with open(local_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            return f"/static/images/beers/{local_filename}"
    except Exception:
        pass
    return None
