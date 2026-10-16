"""Build the deployable seed-data.json from the household grocery workbook.

    python3 build_seed.py                       # reads the workbook named in extract.SRC
    python3 build_seed.py --source "My.xlsx"    # or a specific workbook

Every week of the workbook becomes one trip under the profile "Mom". The sheet's
own figures map onto the app's schema like this:

    listed item price          -> item estimate
    Grocery budget             -> trip budget
    Actuals (per store)        -> what was paid: each store's actual is spread over
                                  that store's items in proportion to their listed
                                  prices, so the trip's spend is the sheet's Total
                                  Actuals
    Savings (budget - actuals) -> the app's "budget left"

How a store's actual is matched to its listed items (ratio = actual / listed):
    within +-10%   spread over the items          (items marked bought)
    more than +10% items at their listed prices, and the extra goes on one
                   "Unlisted purchases" line      (unplanned things were bought)
    less than -10% the items are left unbought, and the store's actual goes on one
                   "Unlisted purchases" line      (it's not clear what was bought)
    no actual      the store's items are left unbought
    actual, no items   one "Unlisted purchases" line for that store
A week whose store actuals don't add up to Total Actuals is treated as one pool.

Weeks with no actuals: after the last week that has some, a planned list;
before it, a finished trip with nothing bought (the sheet records $0 spent).
"""
import argparse, json, pathlib
from decimal import Decimal, ROUND_HALF_UP

CATEGORIES = ['Produce','Dairy','Meat & Seafood','Bakery','Pantry','Frozen','Beverages','Household','Other']
VERSION = 4
PROFILE = 'Mom'
UNLISTED = 'Unlisted purchases'
TOLERANCE = 0.10          # how far a store's actual may stray from its listed prices
RECONCILE = 0.02          # store actuals must add up to Total Actuals within this

TARGET = (pathlib.Path(__file__).resolve().parents[2]
          / 'backend' / 'GroceryTracker.Api' / 'SeedData' / 'seed-data.json')


def cents(amount):
    return int((Decimal(str(amount)) * 100).quantize(Decimal(1), ROUND_HALF_UP))


def money(c):
    return round(c / 100, 2)


def spread(total, weights):
    """Split `total` cents over `weights` in proportion, summing exactly (largest remainder)."""
    whole = sum(weights)
    shares = [total * w // whole for w in weights]
    order = sorted(range(len(weights)), key=lambda i: (total * weights[i]) % whole, reverse=True)
    for i in order[:total - sum(shares)]:
        shares[i] += 1
    return shares


def line(src, checked, price_cents=None, estimate=True):
    return {
        'name': src['name'], 'category': src['category'], 'store': src['store'],
        'checked': checked, 'price': None if price_cents is None else money(price_cents),
        'estimate': src['price'] if estimate else None,
    }


def unlisted(store, price_cents):
    return {'name': UNLISTED, 'category': 'Other', 'store': store, 'checked': True,
            'price': money(price_cents), 'estimate': None}


def settle_pool(store, actual, group, out, stats):
    """Turn one store's listed lines + recorded actual into trip lines."""
    listed = sum(cents(l['price']) for l in group)
    actual_c = cents(actual) if actual else 0
    if actual_c <= 0:
        out.extend(line(l, False) for l in group)        # not shopped / not recorded
        return
    if not group:
        out.append(unlisted(store, actual_c))
        stats['unlisted_only'] += 1
        return
    ratio = actual_c / listed
    if 1 - TOLERANCE <= ratio <= 1 + TOLERANCE:
        shares = spread(actual_c, [cents(l['price']) for l in group])
        out.extend(line(l, True, share) for l, share in zip(group, shares))
        stats['spread_exact' if actual_c == listed else 'spread'] += 1
    elif ratio > 1 + TOLERANCE:
        out.extend(line(l, True, cents(l['price'])) for l in group)
        out.append(unlisted(store, actual_c - listed))
        stats['extra'] += 1
    else:
        out.extend(line(l, False) for l in group)
        out.append(unlisted(store, actual_c))
        stats['under'] += 1


def build_trip(week, last_actual_date, stats):
    lines = [dict(l) for l in week['lines']]
    total = cents(week['total_actuals']) if week['total_actuals'] else 0
    out = []

    if total <= 0:
        status = 'planned' if week['date'] > last_actual_date else 'done'
        out = [line(l, False) for l in lines]
        stats['planned' if status == 'planned' else 'done_unbought'] += 1
    else:
        status = 'done'
        actuals = {s: a for s, a in week['actuals'].items() if a}
        # Items with no store colour belong to the one store the week paid for
        # that has no coloured items (an Amazon Fresh or Costco order).
        coloured = {l['store'] for l in lines if l['store']}
        missing = [s for s in actuals if s not in coloured]
        if len(missing) == 1:
            for l in lines:
                if not l['store']:
                    l['store'] = missing[0]
                    stats['store_inferred'] += 1

        reconciles = actuals and abs(sum(actuals.values()) - week['total_actuals']) <= RECONCILE
        if reconciles:
            groups = {}
            for l in lines:
                groups.setdefault(l['store'], []).append(l)
            for store in list(groups) + [s for s in actuals if s not in groups]:
                settle_pool(store, actuals.get(store), groups.get(store, []), out, stats)
        else:
            stats['one_pool'] += 1
            settle_pool(None, week['total_actuals'], lines, out, stats)

    stores = []
    for l in out:
        if l['store'] and l['store'] not in stores:
            stores.append(l['store'])
    return {
        'name': None, 'date': week['date'], 'budget': week['budget'], 'stores': stores,
        'items': out, 'status': status,
    }


def add_stats(seed):
    """total / estimatedTotal / savings on every trip, as the app would compute them."""
    for t in (t for p in seed['profiles'] for t in p['trips']):
        items = t['items']
        prices = [cents(i['price']) for i in items if i['price'] is not None]
        estimates = [cents(i['estimate']) for i in items if i['estimate'] is not None]
        both = [cents(i['estimate']) - cents(i['price'])
                for i in items if i['price'] is not None and i['estimate'] is not None]
        t['total'] = money(sum(prices))
        t['estimatedTotal'] = money(sum(estimates))
        t['savings'] = money(sum(both)) if both else None
    return seed


def build():
    from extract import extract
    weeks, skipped = extract()
    for w in weeks:
        for l in w['lines']:
            assert l['category'] in CATEGORIES, l

    last_actual_date = max(w['date'] for w in weeks if w['total_actuals'])
    stats = {k: 0 for k in ('planned', 'done_unbought', 'store_inferred', 'one_pool', 'spread',
                            'spread_exact', 'extra', 'under', 'unlisted_only')}
    trips = [build_trip(w, last_actual_date, stats) for w in weeks]
    seed = {
        'version': VERSION,
        'source': 'Groceries - Menu list.xlsx',
        'profiles': [{'name': PROFILE, 'trips': trips}],
    }
    return seed, weeks, skipped, stats


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--source', help='the workbook to read (default: extract.SRC)')
    args = parser.parse_args()
    if args.source:
        import extract
        extract.SRC = args.source

    seed, weeks, skipped, stats = build()
    add_stats(seed)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(seed, indent=1, ensure_ascii=False), encoding='utf-8')

    trips = [t for p in seed['profiles'] for t in p['trips']]
    spent = sum(cents(t['total']) for t in trips)
    recorded = sum(cents(w['total_actuals']) for w in weeks if w['total_actuals'])
    print('wrote', TARGET, f'{TARGET.stat().st_size/1024:.0f} KB')
    print('profile:', PROFILE, '| trips:', len(trips), '| lines:', sum(len(t['items']) for t in trips),
          '| budgets:', sum(1 for t in trips if t['budget']))
    print('status:', {s: sum(1 for t in trips if t['status'] == s) for s in ('planned', 'shopping', 'done')},
          '| of the done trips, nothing bought:', stats['done_unbought'])
    print('spent', money(spent), 'vs sheet Total Actuals', money(recorded), '(difference', money(spent - recorded), ')')
    print('store settlements:', {k: v for k, v in stats.items() if k not in ('planned', 'done_unbought')})
    print('unlisted-purchase lines:', sum(1 for t in trips for i in t['items'] if i['name'] == UNLISTED))
    print('dates from the sheet:', sum(1 for w in weeks if w['date_source'] == 'sheet'),
          '| derived:', sum(1 for w in weeks if w['date_source'] == 'derived'),
          '| range:', weeks[0]['date'], '->', weeks[-1]['date'])
    print('skipped rows:', dict(skipped))


if __name__ == '__main__':
    main()
