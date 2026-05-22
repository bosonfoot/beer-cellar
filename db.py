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
