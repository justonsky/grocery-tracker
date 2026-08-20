"""Extract grocery trips from the XLSX workbook into seed JSON."""
import json, re, calendar, datetime, collections
from xlsx import Workbook

SRC = '/home/iraete/Downloads/Groceries - Menu list.xlsx'

STORE_BY_COLOR = {
    'C6DEB5': "BJ's",  'E2EFDA': "BJ's",
    'FFE699': "Rt-17 Farmer's Market",
    'F4B183': 'Aldi',
    'B4C7E7': 'HMart', 'DAE3F3': 'HMart', '4474A0': 'HMart',
    '9DC3E6': 'HMart', '8FAADC': 'HMart',
}
OTHER = 'Other'
STOP_LABELS = ('estimated', 'grocery budget', 'variance', 'actuals', 'total actuals', 'savings')

MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}


def is_gray(hexrgb):
    if not hexrgb:
        return False
    r, g, b = int(hexrgb[0:2], 16), int(hexrgb[2:4], 16), int(hexrgb[4:6], 16)
    return abs(r - g) < 16 and abs(g - b) < 16 and abs(r - b) < 16


def nearest_store(hexrgb):
    if hexrgb in STORE_BY_COLOR:
        return STORE_BY_COLOR[hexrgb]
    if hexrgb is None or is_gray(hexrgb):
        return None
    r, g, b = int(hexrgb[0:2], 16), int(hexrgb[2:4], 16), int(hexrgb[4:6], 16)
    best, bestd = None, 1e9
    for hx, store in STORE_BY_COLOR.items():
        r2, g2, b2 = int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)
        d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2
        if d < bestd:
            best, bestd = store, d
    return best if bestd <= 5000 else OTHER


CATEGORY_RULES = [
    ('Produce', ['coleslaw','chayote','yuchoy','yu choy','bokchoi','oregano','cherries','cherry tomato',
        'lettuce','romaine','spinach','arugula','tomato','potato','onion','scallion','carrot',
        'broccoli','cabbage','pepper','zucchini','cucumber','mushroom','bokchoy','bok choy','celery',
        'garlic','ginger','banana','apple','pear','grape','berry','berries','mango','kiwi','melon',
        'cantaloupe','honey dew','pineapple','lemon','lime','orange','avocado','okra','eggplant',
        'green beans','stringbean','string beans','sprouts','herbs','dill','cilantro','parsley','basil',
        'salad','kale','radish','squash','corn','peach','plum plum','persimmon','date','fruit','veggie',
        'vegetable','shallot','leek','jalapeno','chili','yam','sweet potato','lotus root','asparagus',
        'cauliflower','artichoke','beet','turnip','watermelon','strawberr','blueberr','raspberr',
        'cherry','apricot','fig','guava','papaya','coconut','peas','bean sprout','endive','chard']),
    ('Dairy', ['milk','yogurt','yoghurt','cheese','butter','cream','egg','margarine','ghee','custard',
        'creamer','half and half','sour cream','ricotta','mozzarella','cheddar','parmes','feta','brie',
        'gouda','havarti','manchego','cambozola','pecorino','reggiano','stilton','mascarpone']),
    ('Meat & Seafood', ['knackwurst','kielbasa','luncheon meat','lil smokies','spam','mahi',
        'longanisa','longaniza','chickn','beef','pork','chicken','turkey','ham','bacon','sausage','salami','prosciutto',
        'steak','ribs','brisket','lamb','veal','duck','shrimp','prawn','fish','salmon','tuna','tilapia',
        'cod','crab','lobster','scallop','clam','mussel','oyster','squid','octopus','anchov','sardine',
        'meatball','patties','patty','tenderloin','bulgoki','bulgogi','soondae','pork belly','croquette',
        'nugget','wing','drumstick','loin','chuck','sirloin','ground meat','deli','pepperoni','chorizo']),
    ('Bakery', ['pandesal','bread','bun','roll','bagel','baguette','croissant','muffin','tortilla','wrap','pita',
        'brioche','ciabatta','naan','cake','pastry','donut','doughnut','biscuit','scone','crouton',
        'hoagie','loaf','focaccia','challah','waffle','pancake']),
    ('Frozen', ['brazzi bites','empanada','yakisoba','kimbap',
        'frozen','ice cream','popsicle','freezer','dumpling','totinos','pizza roll','gelato',
        'sorbet','tater tot','fish stick']),
    ('Beverages', ['water','juice','soda','cola','coffee','tea','beer','wine','drink','shake','smoothie',
        'lemonade','seltzer','kombucha','cider','espresso','latte','gatorade','energy drink','sparkling']),
    ('Household', ['qtip','q-tip','vitamin','zyrtec','tylenol','advil','pain reliever','one-a-day',
        'allergy','medicine','febreeze','febreze','downy','refresh plus','eye drop','optic white',
        'towel','paper','tissue','toilet','tp ','napkin','detergent','soap','cleaner','wipe',
        'sponge','bleach','trash','bag','foil','wrap film','ziploc','plastic','battery','bulb','candle',
        'toothpaste','toothbrush','mouthwash','floss','shampoo','conditioner','deodorant','razor',
        'lotion','sanitizer','disinfect','swiffer','laundry','dish','broom','filter','diaper','shipping',
        'delivery','fee','grocery bag']),
]

PANTRY_HINTS = ['creme brulee','crème brulee','choco pie','swiss miss','vinegrette','vinaigrette',
    'pasta','rice','noodle','flour','sugar','salt','pepper corn','spice','oil','vinegar',
    'sauce','ketchup','mustard','mayo','syrup','honey','jam','jelly','peanut butter','cereal','oat',
    'granola','cracker','chip','snack','nut','almond','cashew','walnut','pecan','raisin','can ','canned',
    'soup','broth','stock','bean','lentil','chickpea','garbanzo','hummus','humus','olive','pickle',
    'seaweed','laver','tofu','miso','soy','sesame','curry','seasoning','baking','yeast','cornstarch',
    'ramen','ramyun','stuffing','gravy','marinade','dressing','salsa','tahini','pesto','tomato paste',
    'condensed','evaporated','mirin','ssamjang','oyster sauce','candy','chocolate','cookie','biscotti',
    'pocky','marshmallow','popcorn','pretzel','protein','bar','powder','mix','kimchi']


def categorize(name):
    n = ' ' + name.lower().strip() + ' '
    for cat, keys in CATEGORY_RULES:
        for k in keys:
            if k in n:
                return cat
    for k in PANTRY_HINTS:
        if k in n:
            return 'Pantry'
    return 'Other'


QTY_RE = re.compile(r'\s*\((\d+)\)\s*$')


def clean_name(raw):
    name = re.sub(r'\s+', ' ', str(raw)).strip()
    qty = 1
    m = QTY_RE.search(name)
    if m:
        qty = int(m.group(1))
        name = QTY_RE.sub('', name).strip()
    name = name.strip(' -–—,')
    return name, qty


def sheet_month(name):
    parts = name.strip().split()
    if len(parts) == 2 and parts[0].lower() in MONTHS and parts[1].isdigit():
        return int(parts[1]), MONTHS[parts[0].lower()]
    return None


def excel_date(serial):
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(serial))


def extract():
    wb = Workbook(SRC)
    trips = []
    weeks = []          # weekly budget/estimate rows
    skipped = collections.Counter()

    for sheet_name, path in wb.sheets:
        ym = sheet_month(sheet_name)
        if not ym:
            continue                      # 'Legends and Example'
        year, month = ym
        cells = wb.read_sheet(path)
        maxr = max(r for r, _ in cells)
        maxc = max(c for _, c in cells)

        blocks = []
        for c0 in range(1, maxc + 1, 3):          # blocks start every 3 columns
            hdr = cells.get((1, c0))
            if not hdr or not isinstance(hdr['v'], float):
                continue                          # 'SUMMER MENU' / empty
            weekday = excel_date(hdr['v']).weekday()

            # find this block's Estimated / budget rows
            est_row = budget = estimate = None
            for r in range(2, maxr + 1):
                lab = cells.get((r, c0))
                if lab and isinstance(lab['v'], str):
                    low = lab['v'].strip().lower()
                    if low.startswith('estimated'):
                        est_row = r
                        val = cells.get((r, c0 + 1))
                        estimate = val['v'] if val and isinstance(val['v'], float) else None
                    elif low.startswith('grocery budget'):
                        val = cells.get((r, c0 + 1))
                        budget = val['v'] if val and isinstance(val['v'], float) else None
            stop = est_row if est_row else maxr + 1

            rows, gray_rows, deleted = [], 0, False
            for r in range(2, stop):
                nc = cells.get((r, c0))
                pc = cells.get((r, c0 + 1))
                if not nc or not isinstance(nc['v'], str) or not nc['v'].strip():
                    continue
                raw = nc['v'].strip()
                if 'deleted' in raw.lower():
                    deleted = True
                    continue
                if raw.lower() in STOP_LABELS:
                    continue
                fill = nc['fill']
                if is_gray(fill):
                    gray_rows += 1
                if not pc or not isinstance(pc['v'], float):
                    skipped['no_price'] += 1
                    continue
                price = round(float(pc['v']), 2)
                if price <= 0:
                    skipped['nonpositive'] += 1
                    continue
                store = nearest_store(fill) or OTHER
                name, qty = clean_name(raw)
                if not name:
                    continue
                rows.append({'name': name, 'qty': qty, 'price': price,
                             'store': store, 'category': categorize(name),
                             'gray': is_gray(fill)})
            # "Tables in gray" / DELETED BY MISTAKE -> drop the whole block,
            # but a few uncoloured rows inside a normal block are real purchases.
            if deleted:
                skipped['deleted_block'] += 1
                rows = []
            elif rows and sum(1 for x in rows if x['gray']) >= max(3, 0.8 * len(rows)):
                skipped['gray_block'] += 1
                rows = []
            for x in rows:
                x.pop('gray', None)
            if rows:
                blocks.append({'weekday': weekday, 'rows': rows,
                               'budget': budget, 'estimate': estimate})

        if not blocks:
            continue

        # Sheet-name month is authoritative; serials are stale template copies.
        # Re-anchor blocks onto the sheet's month, one per week, preserving order.
        wd = collections.Counter(b['weekday'] for b in blocks).most_common(1)[0][0]
        first = datetime.date(year, month, 1)
        offset = (wd - first.weekday()) % 7
        anchor = first + datetime.timedelta(days=offset)
        last_day = calendar.monthrange(year, month)[1]

        for i, blk in enumerate(blocks):
            d = anchor + datetime.timedelta(days=7 * i)
            if d.day > last_day or d.month != month:
                d = datetime.date(year, month, last_day)
            iso = d.isoformat()

            by_store = collections.OrderedDict()
            for row in blk['rows']:
                by_store.setdefault(row['store'], []).append(row)
            for store, items in by_store.items():
                trips.append({
                    'date': iso, 'store': store,
                    'items': [{'name': it['name'], 'category': it['category'],
                               'price': it['price']} for it in items],
                })
            weeks.append({
                'date': iso, 'sheet': sheet_name,
                'budget': blk['budget'], 'estimate': blk['estimate'],
                'stores': list(by_store.keys()),
                'items': [{'name': it['name'], 'category': it['category'],
                           'store': it['store']} for it in blk['rows']],
            })

    trips.sort(key=lambda t: (t['date'], t['store']))
    weeks.sort(key=lambda w: w['date'])
    return trips, weeks, skipped


if __name__ == '__main__':
    trips, weeks, skipped = extract()
    print('trips:', len(trips))
    print('items:', sum(len(t['items']) for t in trips))
    print('weeks:', len(weeks))
    print('skipped:', dict(skipped))
    print('date range:', trips[0]['date'], '->', trips[-1]['date'])
    print('stores:', collections.Counter(t['store'] for t in trips).most_common())
    print('categories:', collections.Counter(
        i['category'] for t in trips for i in t['items']).most_common())
    json.dump({'trips': trips, 'weeks': weeks}, open('raw.json', 'w'), indent=1)
