"""Read the household grocery workbook into weekly shopping records.

Each month sheet holds several weekly blocks laid out side by side, one every
three columns. A block is one week:

    row 1            the week's date (grey header)
    rows 2 .. n      item name | listed price | (marker); cell colour = store
    Estimated        sum of the listed prices
    Grocery budget   the week's budget
    Variance         budget - estimated
    Actuals          what was really paid, one row per store (amount | store label)
    Total Actuals    sum of the actuals
    Savings          budget - total actuals
    (below that)     meal plans, recipes, notes -- not shopping data, ignored

`extract()` returns one record per week; build_seed.py turns those into trips.
"""
import re, calendar, datetime, collections, unicodedata
from xlsx import Workbook

SRC = '/home/iraete/Downloads/Groceries - Menu list.xlsx'

# Fill colours from the workbook's store legend (Aldi orange, BJ's green,
# Rt-17 Farmer's Market gold, HMart blue and their lighter/darker shades).
STORE_BY_COLOR = {
    'C6DEB5': "BJ's",  'E2EFDA': "BJ's",
    'FFE699': "Rt-17 Farmer's Market",
    'F4B183': 'Aldi',
    'B4C7E7': 'HMart', 'DAE3F3': 'HMart', '4474A0': 'HMart',
    '9DC3E6': 'HMart', '8FAADC': 'HMart',
}
# The store label typed beside an Actuals amount ("BJs Del", "farm 17", "AMZ FRSH").
STORE_BY_LABEL = [
    ('amz', 'Amazon Fresh'), ('amazon', 'Amazon Fresh'), ('costco', 'Costco'), ('forest', 'Forest Dairy'),
    ('bj', "BJ's"), ('farm', "Rt-17 Farmer's Market"), ('ald', 'Aldi'), ('hmart', 'HMart'),
]
STOP_LABELS = ('estimated', 'grocery budget', 'variance', 'actuals', 'total actuals', 'savings')

MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}


def is_gray(hexrgb):
    if not hexrgb:
        return False
    r, g, b = int(hexrgb[0:2], 16), int(hexrgb[2:4], 16), int(hexrgb[4:6], 16)
    return abs(r - g) < 16 and abs(g - b) < 16 and abs(r - b) < 16


def store_from_fill(hexrgb):
    """The legend store for a fill colour, or None for no/grey/unknown colours."""
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
    return best if bestd <= 5000 else None


def store_from_label(label, fill=None):
    """Canonical store for an Actuals row: its typed label first, else its colour."""
    low = (label or '').strip().lower()
    for key, store in STORE_BY_LABEL:
        if key in low:
            return store
    if fill and store_from_fill(fill):
        return store_from_fill(fill)
    return low.title() if low else None


# --------------------------------------------------------------------------
# Categories. Whole-word matching, and the most specific (longest) matching
# keyword wins, so "peanut butter" is Pantry although "butter" is Dairy, and
# "corned beef" is Meat although "corn" is Produce. A keyword ending in '*' is a
# stem (prefix match); every other keyword matches whole words, plural included.
# Ties go to the earlier category.
# --------------------------------------------------------------------------
CATEGORY_KEYWORDS = [
    ('Produce', """coleslaw chayote yuchoy yu-choy bokchoi bokchoy bok-choy oregano cherry cherries cherry-tomato
        lettuce romaine spinach arugula tomato tomaotes potato onion scallion carrot broccoli cabbage pepper zucchini
        cucumber mushroom celery garlic ginger banana apple pear grape berry berries strawberr* blueberr* raspberr*
        cranberr* cabag* eggpl* beefsteak-tomato snap-peas mango kiwi melon cantaloupe honeydew honey-dew pineapple lemon lime orange avocado okra oktra eggplant
        green-beans stringbean string-beans stringbeans sprout herbs dill cilantro parsley basil salad kale radish squash
        corn peach plum persimmon date fruit veggie vegetable shallot leek jalapeno chili yam sweet-potato
        lotus lotus-root burdock asparagus cauliflower artichoke beet turnip watermelon apricot fig guava papaya coconut
        peas bean-sprout endive chard kabocha rambutan muscat shine-muscat lychee longan pomelo daikon taro
        plantain enoki napa radicchio brussels clementine tangerine nectarine mandarin grapefruit""".split()),
    ('Dairy', """milk yogurt yoghurt cheese butter cream egg margarine ghee custard creamer half-and-half
        sour-cream ricotta mozzarella cheddar parmes* feta brie gouda havarti manchego cambozola pecorino reggiano
        stilton mascarpone burrata borgonzola gorgonzola oatmilk kefir chocolate-milk""".split()),
    ('Meat & Seafood', """knackwurst kielbasa luncheon-meat lil-smokies spam mahi longanisa longaniza chickn* beef pork
        chicken turkey ham bacon sausage sausuage salami prosciutto steak ribs brisket lamb veal duck shrimp prawn fish
        salmon tuna tilapia cod crab lobster scallop clam mussel oyster squid octopus anchov* sardine meatball meatloaf
        patties patty tenderloin bulgoki bulgogi soondae pork-belly croquette nugget wing drumstick loin chuck sirloin
        ground-meat deli pepperoni chorizo liverwurst seafood hamburger burger hotdog hot-dog fish-cake beefsteak honey-ham smoked-fish chicken-patty""".split()),
    ('Bakery', """pandesal bread bun roll bagel baguette croissant muffin tortilla wrap pita brioche ciabatta naan cake
        pastry donut doughnut biscuit scone crouton hoagie loaf focaccia challah waffle pancake cheesecake pepperidge hamburger-bun
        hot-dog-bun hotdog-bun""".split()),
    ('Frozen', """brazzi-bites empanada yakisoba kimbap frozen ice-cream popsicle freezer dumpling totinos pizza-roll
        gelato sorbet tater-tot fish-stick hashbrown hash-brown pierogi tamale pot-sticker potsticker gyoza arancini
        edamame edameme seafood-bites pizza""".split()),
    ('Beverages', """water juice soda cola coffee tea beer wine drink shake smoothie lemonade seltzer kombucha kamboucha
        cider espresso latte gatorade energy-drink sparkling coconut-water electrolyte starbuck* k-cup k-cups kcup
        veranda blonde-roast french-roast raisin-tea melon-tea chamomil* protein-shake tonic""".split()),
    ('Household', """qtip q-tip vitamin zyrtec tylenol advil pain-reliever one-a-day allergy medicine febreeze febreze
        downy refresh-plus eye-drop eyedrops optic-white towel paper tissue toilet tp napkin detergent soap dishsoap
        cleaner wipe sponge bleach trash bag foil wrap-film ziploc plastic battery bulb candle toothpaste toothbrush
        mouthwash floss shampoo conditioner deodorant razor lotion sanitizer disinfect swiffer laundry dish broom filter
        diaper shipping delivery fee grocery-bag tide bounce dryer-sheet purell body-wash scented-bead bath-freshener
        chopstick earthenware aloe-vera dog glucosamine metamucil nasal-spray crest colgate pataday flonase papertowel* thera-tears hair-brush body-roller""".split()),
]
PANTRY_KEYWORDS = """creme-brulee choco-pie swiss-miss vinegrette vinegret vinaigrette pasta rice noodle flour sugar salt
    pepper-corn spice oil vinegar sauce ketchup mustard mayo syrup honey jam jelly peanut-butter almond-butter nut-butter
    cereal oat granola cracker chip snack nut almond cashew walnut pecan raisin canned soup broth stock bean lentil
    chickpea garbanzo hummus humus olive pickle seaweed laver tofu miso soy sesame curry seasoning baking yeast
    cornstarch ramen ramyun stuffing gravy marinade dressing salsa tahini pesto tomato-paste tomato-sauce pasta-sauce
    marinara condensed evaporated mirin ssamjang oyster-sauce candy candies chocolate cookie biscotti pocky marshmallow
    popcorn pretzel protein bar powder mix kimchi orzo spaghetti penne farfalle farfelle fusili fusilli rotini
    macaroni linguine gochujang tapioca starch furikake evoo doritos cheetos hi-chew chew gum stroopwafel wafer
    praline mousse jello reese* keto cluster japchae banchan andes junk-food dried tortilla-chip potato-chip onion-chip
    kettle-chip garlic-powder onion-powder pancake-mix rice-cake soup-stock bone-broth chicken-broth chicken-bone-broth
    pork-&-beans pork-and-beans cream-soup mayonnaise pizza-sauce plantain-chip tortellini ravioli gnocchi breadcrumb* wrapper chestnut sunchip* crunch truffle yogies""".split()
# Not groceries at all: fees and one-offs the sheet lists as lines.
OTHER_KEYWORDS = "tip driver-tip tax taxes sales-tax greeting-card brekkie pajamas".split()

CATEGORY_ORDER = [c for c, _ in CATEGORY_KEYWORDS] + ['Pantry', 'Other']


def _compile(keyword):
    words = keyword.replace('-', r'[\s-]?')
    stem = keyword.endswith('*')
    pattern = (keyword[:-1] if stem else words)
    if stem:
        return re.compile(r'(?<![a-z0-9])' + re.escape(pattern))
    return re.compile(r'(?<![a-z0-9])' + words.replace('&', r'(?:&|and)') + r'(?:s|es)?(?![a-z0-9])')


_RULES = []   # (score, category order index, regex)
for _order, (_cat, _keys) in enumerate(CATEGORY_KEYWORDS + [('Pantry', PANTRY_KEYWORDS), ('Other', OTHER_KEYWORDS)]):
    for _k in _keys:
        _RULES.append((len(_k.rstrip('*')), _order, _compile(_k), _cat))


def _fold(text):
    """Lowercase with accents removed, so "Crème Brulee" matches "creme brulee"."""
    return unicodedata.normalize('NFKD', text.lower()).encode('ascii', 'ignore').decode()


def categorize(name):
    n = ' ' + _fold(name).strip() + ' '
    best = None
    for score, order, rx, cat in _RULES:
        if rx.search(n):
            key = (score, -order)
            if best is None or key > best[0]:
                best = (key, cat)
    return best[1] if best else 'Other'


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


def _number(cell):
    return cell['v'] if cell and isinstance(cell['v'], float) else None


def _text(cell):
    return cell['v'].strip() if cell and isinstance(cell['v'], str) else ''


def assign_dates(year, month, header_dates, default_weekday):
    """One date per block of a month sheet.

    The header date is the real shopping date when it falls in the sheet's own
    month. Many sheets were copied from older ones and still carry stale 2021/2022
    serials; those blocks are placed one week from a block with a real date, or --
    when the whole sheet is stale -- on the usual shopping weekday, one per week.
    Returns [(date, 'sheet' | 'derived')].
    """
    first = datetime.date(year, month, 1)
    last = datetime.date(year, month, calendar.monthrange(year, month)[1])
    real = [d if d and (d.year, d.month) == (year, month) else None for d in header_dates]
    weekdays = collections.Counter(d.weekday() for d in real if d)
    weekday = weekdays.most_common(1)[0][0] if weekdays else default_weekday
    anchor = first + datetime.timedelta(days=(weekday - first.weekday()) % 7)

    out = [(d, 'sheet') if d else None for d in real]
    for i, entry in enumerate(out):
        if entry:
            continue
        prev = next((j for j in range(i - 1, -1, -1) if out[j]), None)
        nxt = next((j for j in range(i + 1, len(out)) if out[j]), None)
        if prev is not None:
            cand = out[prev][0] + datetime.timedelta(days=7 * (i - prev))
        elif nxt is not None:
            cand = out[nxt][0] - datetime.timedelta(days=7 * (nxt - i))
        else:
            cand = anchor + datetime.timedelta(days=7 * i)
        cand = min(max(cand, first), last)       # never leave the sheet's month
        out[i] = (cand, 'derived')
    return out


def extract():
    """Weekly records from every month sheet.

    Each week: sheet, date, date_source, budget, estimated (the sheet's own cell),
    total_actuals, sheet_savings, actuals {store: amount}, lines [{name, category,
    price, store}] where price is the *listed* (estimated) price and store is None
    when the cell has no store colour.
    """
    wb = Workbook(SRC)
    weeks = []
    skipped = collections.Counter()
    sheets = []

    for sheet_name, path in wb.sheets:
        ym = sheet_month(sheet_name)
        if not ym:
            continue                      # 'ESSENTIALS', the old legend: not a month
        year, month = ym
        cells = wb.read_sheet(path)
        maxr = max(r for r, _ in cells)
        maxc = max(c for _, c in cells)

        blocks = []
        for c0 in range(1, maxc + 1, 3):          # blocks start every 3 columns
            hdr = cells.get((1, c0))
            if not hdr or not isinstance(hdr['v'], float):
                continue                          # 'SUMMER MENU' / empty
            block = {'header': excel_date(hdr['v']), 'budget': None, 'estimated': None,
                     'total_actuals': None, 'sheet_savings': None, 'actuals': {}, 'lines': []}

            est_row = None
            actuals_from = None
            for r in range(2, maxr + 1):
                label = _text(cells.get((r, c0))).lower()
                amount = _number(cells.get((r, c0 + 1)))
                if label.startswith('estimated'):
                    est_row, block['estimated'] = r, amount
                elif label.startswith('grocery budget'):
                    block['budget'] = amount
                elif label == 'actuals':
                    actuals_from = r
                elif label == 'total actuals':
                    block['total_actuals'] = amount
                    if actuals_from is not None:
                        for ar in range(actuals_from, r):
                            amt = _number(cells.get((ar, c0 + 1)))
                            tag = cells.get((ar, c0 + 2))
                            store = store_from_label(_text(tag), tag['fill'] if tag else None)
                            if amt and store:
                                block['actuals'][store] = round(block['actuals'].get(store, 0) + amt, 2)
                elif label == 'savings':
                    block['sheet_savings'] = amount

            stop = est_row if est_row else maxr + 1
            rows, gray_rows, deleted = [], 0, False
            for r in range(2, stop):
                nc, pc = cells.get((r, c0)), cells.get((r, c0 + 1))
                raw = _text(nc)
                if not raw:
                    if _number(pc):
                        skipped['unnamed_price'] += 1   # a price in a row with no item name
                    continue
                if 'deleted' in raw.lower():
                    deleted = True
                    continue
                if raw.lower() in STOP_LABELS:
                    continue
                fill = nc['fill']
                if is_gray(fill):
                    gray_rows += 1
                price = _number(pc)
                if price is None:
                    skipped['no_price'] += 1      # a dish name, a note, an unpriced item
                    continue
                price = round(price, 2)
                if price <= 0:
                    skipped['nonpositive'] += 1
                    continue
                name, _qty = clean_name(raw)       # "(N)" is a quantity: the price is the line total
                if not name:
                    continue
                rows.append({'name': name, 'category': categorize(name), 'price': price,
                             'store': store_from_fill(fill), 'gray': is_gray(fill)})
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
            block['lines'] = rows
            blocks.append(block)
        sheets.append((sheet_name, year, month, blocks))

    # The usual shopping weekday, from every real (in-month) header date.
    weekdays = collections.Counter()
    for _name, year, month, blocks in sheets:
        for b in blocks:
            if (b['header'].year, b['header'].month) == (year, month):
                weekdays[b['header'].weekday()] += 1
    default_weekday = weekdays.most_common(1)[0][0] if weekdays else 5

    for sheet_name, year, month, blocks in sheets:
        dated = assign_dates(year, month, [b['header'] for b in blocks], default_weekday)
        for block, (date, source) in zip(blocks, dated):
            if not block['lines']:
                continue
            weeks.append({
                'sheet': sheet_name, 'date': date.isoformat(), 'date_source': source,
                'budget': block['budget'], 'estimated': block['estimated'],
                'total_actuals': block['total_actuals'], 'sheet_savings': block['sheet_savings'],
                'actuals': block['actuals'], 'lines': block['lines'],
            })

    weeks.sort(key=lambda w: w['date'])
    return weeks, skipped


if __name__ == '__main__':
    weeks, skipped = extract()
    lines = [l for w in weeks for l in w['lines']]
    print('weeks:', len(weeks), ' lines:', len(lines), ' skipped:', dict(skipped))
    print('date range:', weeks[0]['date'], '->', weeks[-1]['date'])
    print('dates from the sheet:', sum(1 for w in weeks if w['date_source'] == 'sheet'),
          ' derived:', sum(1 for w in weeks if w['date_source'] == 'derived'))
    print('categories:', collections.Counter(l['category'] for l in lines).most_common())
    print('stores:', collections.Counter(l['store'] for l in lines).most_common())
