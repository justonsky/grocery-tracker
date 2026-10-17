"""Fill in the quantities a database seeded before quantities existed is missing.

    python3 backfill_quantities.py --db ~/.local/share/GroceryTracker/grocerytracker.db           # dry run: report only
    python3 backfill_quantities.py --db ~/.local/share/GroceryTracker/grocerytracker.db --apply   # write (backs up first)

The v4 seed dropped the "(N)" quantities written in the workbook, so every seeded line is
"1 each" and a line for "Water (2)" averages as if one bottle cost both. This reads the same
workbook, finds each seeded line again (same profile, same trip date, same item name as the v4
seed wrote it) and sets its quantity and unit from the workbook — e.g. Water 2 each, Roast Beef
1 lb. Prices are not touched: they are already line totals.

Only lines still at the default 1 each are changed, so it is safe to run twice, and lines you
have edited since are left alone. Stop the server first (the database is in WAL mode), and run
it against a copy first if you like (--db accepts any path). Stdlib only.
"""
import argparse, collections, datetime, pathlib, sqlite3, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract  # noqa: E402

DEFAULT_MILLI, DEFAULT_UNIT = 1000, 'each'


def norm(name):
    return name.strip().lower()  # the app's NameNormalizer


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--db', required=True, help='path to grocerytracker.db')
    ap.add_argument('--source', help='the workbook (default: extract.SRC)')
    ap.add_argument('--profile', default='Mom', help='profile the seed created (default: Mom)')
    ap.add_argument('--apply', action='store_true', help='write the changes (default: report only)')
    args = ap.parse_args(argv)
    if args.source:
        extract.SRC = args.source

    weeks, _ = extract.extract()
    db_path = pathlib.Path(args.db).expanduser()
    if not db_path.exists():
        sys.exit(f'No database at {db_path}.')
    db = sqlite3.connect(db_path)
    columns = {row[1] for row in db.execute('PRAGMA table_info(TripItems)')}
    if 'QuantityMilli' not in columns:
        sys.exit('This database has no quantity columns yet. Start the new server once (it migrates the '
                 'database on startup), stop it, then run this again.')
    profile = db.execute('SELECT Id FROM Profiles WHERE Name = ?', (args.profile,)).fetchone()
    if not profile:
        sys.exit(f'No profile named {args.profile!r} in {args.db}.')

    # In each trip's own order, so two lines for the same item pair with the workbook rows in order.
    rows = db.execute('''
        SELECT t.Date, ti.Id, i.Name, ti.QuantityMilli, ti.Unit
        FROM TripItems ti JOIN Trips t ON t.Id = ti.TripId JOIN Items i ON i.Id = ti.ItemId
        WHERE t.ProfileId = ?
        ORDER BY t.Date, t.CreatedAt, ti.SortOrder''', (profile[0],)).fetchall()
    by_trip = collections.defaultdict(lambda: collections.defaultdict(list))
    for date, line_id, item, milli, unit in rows:
        by_trip[date][norm(item)].append((line_id, milli, unit))

    updates, missing, edited, renamed, repeated = [], [], 0, collections.Counter(), set()
    for week in weeks:
        lines = by_trip.get(week['date'], {})
        for name, found in lines.items():
            if len(found) > 1:
                repeated.add((week['date'], name))
        for src in week['lines']:
            old_name, _ = extract.clean_name_v4(src['raw'])  # how the v4 seed named it
            candidates = lines.get(norm(old_name), [])
            if not candidates:
                if src['quantity'] != 1 or src['unit'] != 'each':
                    missing.append((week['date'], src['raw']))
                continue
            # Every workbook row claims its seeded line (in order), even one that stays 1 each, so
            # "Water" and "Water (2)" in the same week each land on their own line.
            line_id, milli, unit = candidates.pop(0)
            if src['quantity'] == 1 and src['unit'] == 'each':
                continue
            if (milli, unit) != (DEFAULT_MILLI, DEFAULT_UNIT):
                edited += 1
                continue
            updates.append((round(src['quantity'] * 1000), src['unit'], line_id, src['raw']))
            if norm(old_name) != norm(src['name']):
                renamed[(old_name, src['name'])] += 1

    print(f'{len(updates)} lines to update ({sum(1 for u in updates if u[1] != "each")} by weight); '
          f'{edited} already set (by hand or an earlier run), left alone; {len(missing)} not found.')
    for milli, unit, _, raw in updates[:12]:
        print(f'   {raw!r:45} -> {milli / 1000:g} {unit}')
    if len(updates) > 12:
        print(f'   … and {len(updates) - 12} more')
    for date, raw in missing[:10]:
        print(f'   not found: {date} {raw!r}')
    if repeated:
        print(f'{len(repeated)} trips list the same item more than once; those lines were paired in the order the trip lists them.')
    if renamed:
        print('\nThese items still have the amount in their name. After applying, start the server and run\n'
              'merge_named_items.py --server http://<host>:5080 to merge or rename them:')
        for (old, new), n in renamed.most_common():
            print(f'   "{old}" -> could be merged into "{new}" ({n} lines)')

    if not args.apply:
        print('\nDry run — nothing written. Re-run with --apply to update the database.')
        return
    if not updates:
        print('\nNothing to change, so nothing was written (and no backup made).')
        return
    # Timestamped, so running it again never replaces the backup from before the first run.
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = db_path.with_name(f'{db_path.stem}.before-quantities-{stamp}.bak')
    with sqlite3.connect(backup) as copy:
        db.backup(copy)  # the sqlite backup API includes anything still in the WAL file
    db.executemany('UPDATE TripItems SET QuantityMilli = ?, Unit = ? WHERE Id = ? AND QuantityMilli = 1000 AND Unit = \'each\'',
                   [(m, u, i) for m, u, i, _ in updates])
    db.commit()
    print(f'\nUpdated {len(updates)} lines. Backup: {backup}')


if __name__ == '__main__':
    main()
