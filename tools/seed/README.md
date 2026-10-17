# Seed data generator

Regenerates `backend/GroceryTracker.Api/SeedData/seed-data.json` from the
household grocery workbook (`Groceries - Menu list.xlsx`). Every week of the
workbook becomes one trip under the profile **Mom**.

```bash
cd tools/seed
python3 build_seed.py                       # reads extract.SRC (~/Downloads/Groceries - Menu list.xlsx)
python3 build_seed.py --source "Other.xlsx" # or a specific workbook
```

Stdlib only — no pip packages. The workbook is only ever read.

## How the workbook is laid out

`xlsx.py` is a minimal XLSX reader (zipfile + ElementTree) that returns each
cell's **value and fill colour** — the colour identifies the store, so a CSV
export would lose it. Each month sheet holds weekly blocks side by side, one
every three columns (`A/B/C`, `D/E/F`, …):

| Row | Meaning |
|-----|---------|
| 1 | the week's date (grey header) |
| 2 … n | item name · **listed price** (an estimate) · optional marker. Cell colour = store (Aldi orange, BJ's green, Rt-17 Farmer's Market gold, HMart blue) |
| `Estimated` | sum of the listed prices |
| `Grocery budget` | the week's budget (160) |
| `Variance` | budget − estimated |
| `Actuals` | what was really paid: one row per store, amount · store label (`BJs Del`, `farm 17`, `AMZ FRSH`, `Forest`…) |
| `Total Actuals` | sum of the actuals |
| `Savings` | budget − total actuals |
| below | meal plans, recipes, notes — not shopping data, ignored (as are the `*` markers, the unpriced dish names and the `ESSENTIALS` sheet) |

## How it maps onto the app

| Sheet | Seed / app |
|-------|------------|
| listed item price | `item.estimate` |
| Grocery budget | `trip.budget` |
| Actuals per store | what was paid (`item.price`, below) |
| Total Actuals | the trip's spend — equal to it, to the cent |
| Savings | the app's *budget left* |
| Estimated − Total Actuals | the app's *savings* |

### Paid prices

The sheet records what each **store** cost, not each item, so a store's actual
is spread over that store's items in proportion to their listed prices
(largest-remainder, exact to the cent). `ratio` = actual ÷ listed:

| Case | Result |
|------|--------|
| within ±10% (240 store-weeks, 147 of them exact) | the actual is spread over the items; all marked bought |
| more than +10% (22) | items keep their listed prices as paid, and the extra goes on one **"Unlisted purchases"** line (unplanned things were bought) |
| less than −10% (17) | the items are left unbought, and the store's actual goes on one "Unlisted purchases" line (not clear what was bought) |
| a store with items but no actual | its items are left unbought |
| an actual with no items (3) | one "Unlisted purchases" line for that store |

A week whose store actuals don't add up to Total Actuals is settled as a single
pool. "Unlisted purchases" is a normal item (category Other) — delete it on the
Items page if you'd rather not see it, which also removes that spend.

Items with no store colour belong to the one store the week paid for that has
no coloured items (an Amazon Fresh or Costco order), otherwise they have no
store. Neighbouring rows are *not* used: guessing a store from the row above
fitted the actuals worse.

### Status

- Total Actuals > 0 → `done`, bought lines marked picked up.
- No actuals, after the last week that has some → `planned` (estimates only).
- No actuals, before that → `done` with nothing bought (the sheet records $0
  spent), so it adds no spend or price history.

### Dates

The header date is used when it falls in the sheet's own month (81 weeks).
Many sheets (Dec 2025 → Aug 2026, and the first block of Sep–Nov 2025) were
copied from older ones and carry stale 2021/2022 dates; those blocks (48) are
placed one week from a block with a real date, or — when the whole sheet is
stale — on the usual shopping weekday (Saturday, from the real dates), one per
week, never leaving the sheet's month. These are best guesses.

### Categories

Items are matched against keyword lists with **whole-word** matching, and the
longest (most specific) keyword wins — so `peanut butter` is Pantry although
`butter` is Dairy, `corned beef` is Meat although `corn` is Produce, and
`chamomile tea` is a Beverage although `ham` is Meat. A keyword ending in `*`
is a stem. Tax, Tip and Driver Tip lines stay as items in category Other so
the week's spend reconciles with the sheet.

### Quantities

`clean_name` reads how much was bought from the name, and the price stays the line total:
`Water (2)`, `(2 pks)`, `(3 bags)`, `(5 bunches)` → that many each; `Onions (Red, 2)` → 2 of
"Onions (Red)"; `(1.5 lbs)`, `(3/4 lb)` and a pound weight in the name (`1 lb Roast Beef`,
`Bananas - 3 lbs`) → that weight. A singular `(6 pack)`, an ounce size (`Purell 8 oz`) and a
count (`Eggs - 18 ct`) describe the product and stay in the name. Lines carry `quantity` and
`unit` only when they aren't 1 each (738 lines, 30 by weight, in the current workbook).

`backfill_quantities.py --db <grocerytracker.db>` applies the same quantities to a database
seeded from the v4 file (which dropped them): it finds each line by profile, trip date and the
v4 item name (pairing repeated items in the order the trip lists them), only changes lines
still at 1 each, and with `--apply` writes a timestamped backup first (none when there is nothing
to change). Stop the server first; the database must already have been migrated by the new
server. Tests: `python3 -m unittest test_backfill_quantities`.

The backfill moves the amount onto each line but leaves items whose names still carry it
("Premium Fuji Apples (2 pks)", "1 lb Dietz & Watson Roast Beef"). Then, with the server running,
`merge_named_items.py --server http://<host>:5080` (dry run; `--apply` to do it) merges each into
the item with the clean name, or renames it when there is none — through the server's own merge
and rename, so recipes, dashboard pins and receipt names follow. It only touches items whose
records all carry the amount already. Tests: `python3 -m unittest test_merge_named_items`.

### Other rules

- **Stores** come from the legend colours (including lighter/darker shades) and
  the Actuals labels; "Forest" is *Forest Dairy*.
- **Whole blocks are dropped** when struck out in grey or marked
  `DELETED BY MISTAKE` (5). Individual grey rows in a normal block are kept —
  they are real purchases whose store was never colour-coded.
- Non-positive prices (coupons), unpriced rows and unnamed priced rows are skipped.
- Where the sheet's own `Estimated` cell disagrees with its rows (20 weeks with
  stale `SUM` ranges), the rows win.

## File format (version 4)

```jsonc
{
 "version": 4,
 "source": "Groceries - Menu list.xlsx",
 "profiles": [{ "name": "Mom", "trips": [{
   "name": null, "date": "2024-01-06", "budget": 160.0,
   "stores": ["BJ's", "Rt-17 Farmer's Market", "Aldi", "HMart"],
   "items": [{ "name": "Water", "category": "Beverages", "store": "Aldi",
               "checked": true, "price": 3.56, "estimate": 3.56 }],
   "status": "done", "total": 192.53, "estimatedTotal": 195.77, "savings": 3.24
 }] }]
}
```

v4 changes from v3: one trip **per week** (was one per store and day), with the
week's stores listed and a store on each line; `estimate` is the sheet's listed
price and `price` the paid price (they were equal); `status` can be `planned` or
`done`; and `store` is `null` for lines with no known store (never `"Other"`).

`total`, `estimatedTotal` and `savings` are computed by `add_stats()` the way
the app does: spend is the sum of prices, the estimate the sum of estimates, and
savings the sum of `estimate − price` over lines that have both (`null` if none).
`SeedDataService` uses `status`, `estimate`, `price`, `checked` and `store`; the
three totals are informational, and a `total` more than half a cent off the item
prices only logs a warning. Older files still load (the status is inferred when
missing).

## Verification

Run on the current workbook (129 weeks, 2,450 listed lines, 42 unlisted lines):

- app spend $16,776.05 = the sheet's Total Actuals, week by week to the cent;
- every trip's budget = the sheet's Grocery budget;
- 109 of 129 weeks' listed prices sum to the sheet's own `Estimated` cell (the
  rest are stale `SUM` ranges in the workbook, not extraction errors);
- no line is priced outside ±11% of its estimate except "Unlisted purchases";
- trip dates are unique and sorted; the planned weeks all fall after the last
  week with actuals.
