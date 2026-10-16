"""Tests for backfill_quantities.py against a tiny database (no workbook needed).

    cd tools/seed && python3 -m unittest test_backfill_quantities
"""
import contextlib, io, pathlib, sqlite3, tempfile, unittest
from unittest import mock

import backfill_quantities
import extract

SCHEMA = '''
CREATE TABLE Profiles (Id TEXT PRIMARY KEY, Name TEXT);
CREATE TABLE Trips (Id TEXT PRIMARY KEY, ProfileId TEXT, Date TEXT, CreatedAt TEXT);
CREATE TABLE Items (Id TEXT PRIMARY KEY, Name TEXT);
CREATE TABLE TripItems (Id TEXT PRIMARY KEY, TripId TEXT, ItemId TEXT, SortOrder INTEGER, QuantityMilli INTEGER DEFAULT 1000, Unit TEXT DEFAULT 'each');
'''


def week(date, *raws):
    lines = []
    for raw in raws:
        name, qty, unit = extract.clean_name(raw)
        lines.append({'name': name, 'raw': raw, 'quantity': qty, 'unit': unit})
    return {'date': date, 'lines': lines}


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db_path = pathlib.Path(self.dir.name) / 'grocerytracker.db'
        db = sqlite3.connect(self.db_path)
        db.executescript(SCHEMA)
        db.execute("INSERT INTO Profiles VALUES ('p', 'Mom')")
        db.execute("INSERT INTO Trips VALUES ('t1', 'p', '2026-08-01', '2026-08-01')")
        # The v4 seed named "Water (2)" just "Water", and "1 lb Roast Beef" as written.
        for item_id, name in [('water', 'Water'), ('beef', '1 lb Roast Beef'), ('milk', 'Milk')]:
            db.execute('INSERT INTO Items VALUES (?, ?)', (item_id, name))
        for line_id, item_id, order in [('l1', 'water', 0), ('l2', 'water', 1), ('l3', 'beef', 2), ('l4', 'milk', 3)]:
            db.execute('INSERT INTO TripItems (Id, TripId, ItemId, SortOrder) VALUES (?, ?, ?, ?)', (line_id, 't1', item_id, order))
        db.commit()
        db.close()
        self.weeks = [week('2026-08-01', 'Water', 'Water (2)', '1 lb Roast Beef', 'Milk')]

    def tearDown(self):
        self.dir.cleanup()

    def run_backfill(self, *extra):
        out = io.StringIO()
        with mock.patch.object(extract, 'extract', return_value=(self.weeks, {})), contextlib.redirect_stdout(out):
            backfill_quantities.main(['--db', str(self.db_path), *extra])
        return out.getvalue()

    def lines(self):
        with sqlite3.connect(self.db_path) as db:
            return dict((r[0], (r[1], r[2])) for r in db.execute('SELECT Id, QuantityMilli, Unit FROM TripItems'))

    def backups(self):
        return sorted(p.name for p in pathlib.Path(self.dir.name).glob('*.bak'))

    def test_dry_run_changes_nothing(self):
        out = self.run_backfill()
        self.assertIn('2 lines to update', out)
        self.assertEqual(self.lines()['l2'], (1000, 'each'))
        self.assertEqual(self.backups(), [])

    def test_apply_sets_quantities_on_the_right_lines(self):
        self.run_backfill('--apply')
        lines = self.lines()
        # "Water" then "Water (2)": the second Water line gets the 2, the first stays 1.
        self.assertEqual(lines['l1'], (1000, 'each'))
        self.assertEqual(lines['l2'], (2000, 'each'))
        self.assertEqual(lines['l3'], (1000, 'lb'))
        self.assertEqual(lines['l4'], (1000, 'each'))
        self.assertEqual(len(self.backups()), 1)

    def test_running_again_changes_nothing_and_keeps_the_first_backup(self):
        self.run_backfill('--apply')
        first = self.backups()
        out = self.run_backfill('--apply')
        self.assertIn('0 lines to update', out)
        self.assertIn('nothing was written', out)
        self.assertEqual(self.backups(), first)

    def test_a_line_edited_by_hand_is_left_alone(self):
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE TripItems SET QuantityMilli = 3000 WHERE Id = 'l2'")
        out = self.run_backfill('--apply')
        self.assertIn('1 already set', out)
        self.assertEqual(self.lines()['l2'], (3000, 'each'))

    def test_an_unmigrated_database_gets_a_clear_message(self):
        with sqlite3.connect(self.db_path) as db:
            db.executescript('DROP TABLE TripItems; CREATE TABLE TripItems (Id TEXT, TripId TEXT, ItemId TEXT, SortOrder INTEGER);')
        with self.assertRaises(SystemExit) as stop:
            self.run_backfill()
        self.assertIn('Start the new server once', str(stop.exception))


if __name__ == '__main__':
    unittest.main()
