# Seed data generator

Regenerates `backend/GroceryTracker.Api/SeedData/seed-data.json` from the
household grocery spreadsheet (`Groceries - Menu list.xlsx`).

```bash
cd tools/seed
python3 build_seed.py        # stdlib only — no pip packages required
```

## How the workbook is read

`xlsx.py` is a minimal XLSX reader (zipfile + ElementTree) that returns each
cell's **value and fill colour** — the colour is what identifies the store, so
an off-the-shelf CSV export would lose it.

Each month worksheet holds several weekly trip tables laid out side by side,
one every three columns (`A/B`, `D/E`, `G/H`, …):

| Row        | Meaning                                          |
|------------|--------------------------------------------------|
| 1          | trip date (grey header)                          |
| 2 … n      | item name + price, cell colour = store           |
| `Estimated`| end of the item rows for that block              |
| `Grocery budget` | the week's budget                          |

`extract.py` turns those into one **Trip per (date, store)** — a single weekly
shop that spans BJ's, Aldi and the farmer's market becomes three trips, which
is what the app's data model expects.

Notable rules, all derived from the workbook itself:

- **Stores come from the legend sheet's colours**, including lighter/darker
  shades of the same hue (e.g. BJ's delivery rows). Anything unrecognised
  falls back to `Other`.
- **The `Estimated` row is found per block**, not per sheet — blocks in the
  same month end at different rows.
- **Whole blocks are dropped** when they are struck out in grey or contain
  `DELETED BY MISTAKE`. Individual grey rows inside a normal block are kept:
  they are real purchases whose store was simply never colour-coded.
- **Sheet names are authoritative for month/year.** Many sheets were copied
  from older ones and still carry stale 2021/2022 date serials, so blocks are
  re-anchored onto the sheet's own month, one per week, preserving their order
  and weekday.
- Trailing `(N)` is stripped from item names — the workbook's convention for
  quantity, where the price is already the line total. This keeps price
  history for "Water" joined up across trips.
- Non-positive prices (coupons, zero rows) and priceless rows are skipped.

Categories are inferred from item names by keyword, mapped onto the app's nine
built-in categories.

## Verification

Extraction is checked against the spreadsheet's own `Estimated` totals: 109 of
129 weeks match to the cent. The remainder are stale `SUM` ranges in the
workbook (e.g. February 2026 week 3 reports exactly double its item rows), not
extraction errors.
