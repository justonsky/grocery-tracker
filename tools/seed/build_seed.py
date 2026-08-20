"""Build the deployable seed-data.json from the extracted workbook data."""
import json, collections
from extract import extract

CATEGORIES = ['Produce','Dairy','Meat & Seafood','Bakery','Pantry','Frozen','Beverages','Household','Other']
LIST_WEEKS = 8          # most recent weeks turned into planning lists

trips, weeks, skipped = extract()

# Collapse duplicate item lines within one trip (same item bought twice in a
# single store visit) into separate lines - keep them, they are real purchases.
for cat in {i['category'] for t in trips for i in t['items']}:
    assert cat in CATEGORIES, cat

# A trip and a grocery list are the same record. Every completed shop below is a
# trip whose items are ticked off and priced; the weekly budget from the
# spreadsheet rides along on the trip it belongs to.
budget_by_date = {w['date']: w['budget'] for w in weeks}
out_trips = []
for t in trips:
    out_trips.append({
        'name': None,
        'date': t['date'],
        'budget': budget_by_date.get(t['date']),
        'stores': [t['store']],
        'items': [{
            'name': i['name'],
            'category': i['category'],
            'store': t['store'],
            'checked': True,
            'price': i['price'],
        } for i in t['items']],
    })

# One upcoming trip that has not been shopped yet, built from the most recent
# week's basket: nothing ticked off, no prices, budget set. This is what the
# estimated-cost and over-budget UI reads from on a fresh install.
planned = weeks[-1]
seen, planned_items = set(), []
for it in planned['items']:
    key = it['name'].strip().lower()
    if key in seen:
        continue
    seen.add(key)
    planned_items.append({
        'name': it['name'],
        'category': it['category'],
        'store': it['store'] if it['store'] in planned['stores'] else None,
        'checked': False,
        'price': None,
    })
if planned_items:
    out_trips.append({
        'name': 'Weekly stock-up',
        'date': planned['date'],
        'budget': planned['budget'],
        'stores': planned['stores'],
        'items': planned_items,
    })

seed = {
    'version': 2,
    'source': 'Groceries - Menu list.xlsx',
    'profiles': [{
        'name': 'Juston',
        'trips': out_trips,
    }],
}

out = '../../../../../../home/iraete/Development/grocery-tracker/backend/GroceryTracker.Api/SeedData/seed-data.json'
import os, pathlib
target = pathlib.Path('/home/iraete/Development/grocery-tracker/backend/GroceryTracker.Api/SeedData')
target.mkdir(parents=True, exist_ok=True)
path = target / 'seed-data.json'
path.write_text(json.dumps(seed, indent=1, ensure_ascii=False))

print('wrote', path, f'{path.stat().st_size/1024:.0f} KB')
print('profiles:', len(seed['profiles']))
print('trips:', len(out_trips), 'items:', sum(len(t['items']) for t in out_trips))
print('with budgets:', sum(1 for t in out_trips if t['budget']))
print('planned (unbought) trips:', sum(1 for t in out_trips if any(not i['checked'] for i in t['items'])))
print('distinct items:', len({i['name'].lower() for t in trips for i in t['items']}))
print('distinct stores:', sorted({t['store'] for t in trips}))
print('date range:', trips[0]['date'], '->', trips[-1]['date'])
