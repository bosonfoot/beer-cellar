import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'cellar.db')


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS beers (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL,
                year            INTEGER,
                brewer          TEXT NOT NULL,
                abv             REAL,
                quantity        INTEGER NOT NULL DEFAULT 1,
                date_bottled    TEXT,
                drink_after     TEXT,
                drink_by        TEXT,
                research        TEXT,
                food_pairings   TEXT,
                considerations  TEXT,
                image_url       TEXT,
                date_imbibed    TEXT,
                date_added      TEXT NOT NULL DEFAULT (date('now'))
            )
        ''')
        # forward-compatible migrations
        cols = [r[1] for r in conn.execute("PRAGMA table_info(beers)").fetchall()]
        migrations = [
            ('abv',             'ALTER TABLE beers ADD COLUMN abv REAL'),
            ('image_url',       'ALTER TABLE beers ADD COLUMN image_url TEXT'),
            ('date_imbibed',    'ALTER TABLE beers ADD COLUMN date_imbibed TEXT'),
            ('quantity',        'ALTER TABLE beers ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1'),
            ('year',            'ALTER TABLE beers ADD COLUMN year INTEGER'),
            ('untappd_rating',  'ALTER TABLE beers ADD COLUMN untappd_rating REAL'),
            ('imbibe_notes',    'ALTER TABLE beers ADD COLUMN imbibe_notes TEXT'),
            ('label',           'ALTER TABLE beers ADD COLUMN label TEXT'),
            ('parent_id',       'ALTER TABLE beers ADD COLUMN parent_id INTEGER'),
        ]
        for col, sql in migrations:
            if col not in cols:
                conn.execute(sql)

        conn.execute('''
            CREATE TABLE IF NOT EXISTS wines (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL,
                year            INTEGER,
                producer        TEXT NOT NULL,
                region          TEXT,
                appellation     TEXT,
                varietal        TEXT,
                wine_type       TEXT,
                quantity        INTEGER NOT NULL DEFAULT 1,
                date_bottled    TEXT,
                drink_after     TEXT,
                drink_by        TEXT,
                research        TEXT,
                considerations  TEXT,
                image_url       TEXT,
                date_imbibed    TEXT,
                date_added      TEXT NOT NULL DEFAULT (date('now')),
                rating          REAL,
                rating_source   TEXT,
                imbibe_notes    TEXT,
                label           TEXT,
                parent_id       INTEGER,
                grapeminds_id   INTEGER,
                flavor_profile  TEXT
            )
        ''')
        wine_cols = [r[1] for r in conn.execute("PRAGMA table_info(wines)").fetchall()]
        wine_migrations = []
        for col, sql in wine_migrations:
            if col not in wine_cols:
                conn.execute(sql)


def get_all_beers():
    with get_conn() as conn:
        rows = conn.execute('''
            SELECT * FROM beers
            ORDER BY
                CASE WHEN date_imbibed IS NOT NULL THEN 1 ELSE 0 END,
                CASE WHEN drink_after IS NULL THEN 1 ELSE 0 END,
                drink_after ASC
        ''').fetchall()
    return [dict(row) for row in rows]


def get_beer(beer_id):
    with get_conn() as conn:
        row = conn.execute('SELECT * FROM beers WHERE id = ?', (beer_id,)).fetchone()
        if not row:
            return None
        beer = dict(row)
        history = conn.execute(
            '''SELECT date_imbibed, imbibe_notes FROM beers
               WHERE parent_id = ? AND date_imbibed IS NOT NULL
               ORDER BY date_imbibed DESC''',
            (beer_id,)
        ).fetchall()
        beer['tasting_history'] = [dict(h) for h in history]
        return beer


def insert_beer(name, brewer, year=None, abv=None, quantity=1, date_bottled=None, drink_after=None,
                drink_by=None, research=None, food_pairings=None, considerations=None,
                image_url=None, untappd_rating=None, label=None):
    with get_conn() as conn:
        cursor = conn.execute('''
            INSERT INTO beers (name, year, brewer, abv, quantity, date_bottled, drink_after, drink_by,
                               research, food_pairings, considerations, image_url, untappd_rating, label)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (name, year, brewer, abv, quantity, date_bottled, drink_after, drink_by,
              research, food_pairings, considerations, image_url, untappd_rating, label))
        return cursor.lastrowid


def imbibe_beer(beer_id, notes=None):
    """Consume one bottle. If qty > 1, decrements qty and creates a new imbibed record.
    Returns the new record's id when a split occurs, else None."""
    with get_conn() as conn:
        beer = dict(conn.execute('SELECT * FROM beers WHERE id = ?', (beer_id,)).fetchone())
        if beer['quantity'] > 1:
            conn.execute('UPDATE beers SET quantity = quantity - 1 WHERE id = ?', (beer_id,))
            cursor = conn.execute(
                '''INSERT INTO beers (name, year, brewer, abv, quantity, date_bottled,
                       drink_after, drink_by, research, food_pairings, considerations,
                       image_url, untappd_rating, label, date_imbibed, imbibe_notes, parent_id)
                   VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,date('now'),?,?)''',
                (beer['name'], beer['year'], beer['brewer'], beer['abv'],
                 beer['date_bottled'], beer['drink_after'], beer['drink_by'],
                 beer['research'], beer['food_pairings'], beer['considerations'],
                 beer['image_url'], beer['untappd_rating'], beer['label'],
                 notes, beer_id)
            )
            return cursor.lastrowid
        else:
            conn.execute(
                "UPDATE beers SET date_imbibed = date('now'), imbibe_notes = ? WHERE id = ?",
                (notes, beer_id)
            )
            return None


def update_beer_research(beer_id, drink_after=None, drink_by=None, research=None):
    with get_conn() as conn:
        conn.execute(
            'UPDATE beers SET drink_after=?, drink_by=?, research=? WHERE id=?',
            (drink_after, drink_by, research, beer_id)
        )


def update_beer(beer_id, name, brewer, year, abv, quantity, date_bottled,
                drink_after, drink_by, research, food_pairings, considerations, label):
    with get_conn() as conn:
        conn.execute('''
            UPDATE beers SET name=?, brewer=?, year=?, abv=?, quantity=?,
                date_bottled=?, drink_after=?, drink_by=?, research=?,
                food_pairings=?, considerations=?, label=?
            WHERE id=?
        ''', (name, brewer, year, abv, quantity, date_bottled,
              drink_after, drink_by, research, food_pairings, considerations, label, beer_id))


def update_image_url(beer_id, image_url):
    with get_conn() as conn:
        conn.execute('UPDATE beers SET image_url = ? WHERE id = ?', (image_url, beer_id))


def delete_beer(beer_id):
    with get_conn() as conn:
        conn.execute('DELETE FROM beers WHERE id = ?', (beer_id,))


# ── Wines ─────────────────────────────────────────────────────────────────────

def get_all_wines():
    with get_conn() as conn:
        rows = conn.execute('''
            SELECT * FROM wines
            ORDER BY
                CASE WHEN date_imbibed IS NOT NULL THEN 1 ELSE 0 END,
                CASE WHEN drink_after IS NULL THEN 1 ELSE 0 END,
                drink_after ASC
        ''').fetchall()
    return [dict(row) for row in rows]


def get_wine(wine_id):
    with get_conn() as conn:
        row = conn.execute('SELECT * FROM wines WHERE id = ?', (wine_id,)).fetchone()
        if not row:
            return None
        wine = dict(row)
        history = conn.execute(
            '''SELECT date_imbibed, imbibe_notes FROM wines
               WHERE parent_id = ? AND date_imbibed IS NOT NULL
               ORDER BY date_imbibed DESC''',
            (wine_id,)
        ).fetchall()
        wine['tasting_history'] = [dict(h) for h in history]
        return wine


def insert_wine(name, producer, year=None, region=None, appellation=None, varietal=None,
                wine_type=None, quantity=1, date_bottled=None, drink_after=None,
                drink_by=None, research=None, considerations=None, image_url=None,
                rating=None, rating_source=None, label=None, grapeminds_id=None,
                flavor_profile=None):
    with get_conn() as conn:
        cursor = conn.execute('''
            INSERT INTO wines (name, year, producer, region, appellation, varietal, wine_type,
                               quantity, date_bottled, drink_after, drink_by, research,
                               considerations, image_url, rating, rating_source, label,
                               grapeminds_id, flavor_profile)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (name, year, producer, region, appellation, varietal, wine_type,
              quantity, date_bottled, drink_after, drink_by, research,
              considerations, image_url, rating, rating_source, label,
              grapeminds_id, flavor_profile))
        return cursor.lastrowid


def imbibe_wine(wine_id, notes=None):
    """Consume one bottle. If qty > 1, decrements qty and creates a new imbibed record.
    Returns the new record's id when a split occurs, else None."""
    with get_conn() as conn:
        wine = dict(conn.execute('SELECT * FROM wines WHERE id = ?', (wine_id,)).fetchone())
        if wine['quantity'] > 1:
            conn.execute('UPDATE wines SET quantity = quantity - 1 WHERE id = ?', (wine_id,))
            cursor = conn.execute(
                '''INSERT INTO wines (name, year, producer, region, appellation, varietal,
                       wine_type, quantity, date_bottled, drink_after, drink_by, research,
                       considerations, image_url, rating, rating_source, label,
                       grapeminds_id, flavor_profile, date_imbibed, imbibe_notes, parent_id)
                   VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,date('now'),?,?)''',
                (wine['name'], wine['year'], wine['producer'], wine['region'],
                 wine['appellation'], wine['varietal'], wine['wine_type'],
                 wine['date_bottled'], wine['drink_after'], wine['drink_by'],
                 wine['research'], wine['considerations'], wine['image_url'],
                 wine['rating'], wine['rating_source'], wine['label'],
                 wine['grapeminds_id'], wine['flavor_profile'],
                 notes, wine_id)
            )
            return cursor.lastrowid
        else:
            conn.execute(
                "UPDATE wines SET date_imbibed = date('now'), imbibe_notes = ? WHERE id = ?",
                (notes, wine_id)
            )
            return None


def update_wine_research(wine_id, drink_after=None, drink_by=None, research=None,
                         considerations=None):
    with get_conn() as conn:
        conn.execute(
            'UPDATE wines SET drink_after=?, drink_by=?, research=?, considerations=? WHERE id=?',
            (drink_after, drink_by, research, considerations, wine_id)
        )


def update_wine(wine_id, name, producer, year, region, appellation, varietal, wine_type,
                quantity, date_bottled, drink_after, drink_by, research, considerations,
                rating, rating_source, label):
    with get_conn() as conn:
        conn.execute('''
            UPDATE wines SET name=?, producer=?, year=?, region=?, appellation=?, varietal=?,
                wine_type=?, quantity=?, date_bottled=?, drink_after=?, drink_by=?,
                research=?, considerations=?, rating=?, rating_source=?, label=?
            WHERE id=?
        ''', (name, producer, year, region, appellation, varietal, wine_type,
              quantity, date_bottled, drink_after, drink_by, research, considerations,
              rating, rating_source, label, wine_id))


def delete_wine(wine_id):
    with get_conn() as conn:
        conn.execute('DELETE FROM wines WHERE id = ?', (wine_id,))
