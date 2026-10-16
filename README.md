# Grocery Tracker

# Overview
This is a project for experimenting with Claude workflows and AI in general. It is a local-first application for logging grocery trips and items purchased, with data visualization capabilities. It is capable of tracking item prices over time across different grocery stores, with synchronization and back-up capabilities. 

This tool was built with the motivation of improving my mom's grocery shopping tracking and helping her see the many data points she has gathered from grocery trips over the years.

## IMPORTANT!
This application is meant to run on a trusted home network and should NOT be exposed on any public-facing server.

Stack: **React + Tailwind** (frontend), **C# / ASP.NET Core + EF Core** (backend),
**SQLite** (data store). One process serves both the API and the built frontend;
any device's browser on the same network connects to it — a self-hosted web app
(installable as a PWA) rather than native apps.

## Features

- **Profiles** — one per household member, each with its own color theme (22 to
  choose from, in Settings; **Market Fresh** is the default). Light/dark mode is
  a household setting.
- **Shopping lists and trips are one thing.** A trip starts as a list
  (*Planned*), becomes *Shopping* once you tick something off or enter a price,
  and is *Done* when you finish it. "Shop again" starts a new list from any past
  trip. Long lists are grouped by store; while shopping, ticked items collapse
  into "in the cart". The **Grocery Trips** tab lists them all.
- **Share a list as an image** — *Preview & share* groups the list by
  category, by store, or not at all, and each group can have its own background
  color (BJ's, Rt-17 Farmer's Market, Aldi and HMart start as light green, gold,
  orange and blue). Colors are saved for the household; export as PNG or JPG.
- **Estimates and savings** — give each item an estimate (or fill them all from
  the household's average prices), enter what you actually paid, and see
  subtotals per store plus estimated savings against your estimate and budget.
- **Price lock** — a price becomes read-only in the trip editor 7 days after it
  was entered (and that trip's date is then fixed too), so history and averages
  stop shifting. The Items page can still
  correct it, with an explicit confirmation.
- **Shared item catalogue** — items and stores are household-wide; prices,
  averages and price history combine everyone's purchases. Spend totals stay
  per profile.
- **Dashboard** — spend today/this month/this year, the latest trip, and a grid
  of tracked items: your 8 most recent purchases by default, or your own picks
  (Edit → add/remove, or reset to automatic).
- **Item price history** — a chart with date/price axes and hover read-outs,
  filterable by date range (presets or custom); every statistic recalculates for
  the range.
- **Items page** — rename items or change their category, add or delete items,
  fix their purchase records (price, store, which trip), and merge duplicates
  ("milk" into "whole milk"), optionally only the records from one store.
- **Works offline** — see [Offline and sync](#offline-and-sync).
- **Backup** — download everything as an .xlsx from Settings (see
  [Backups](#backups)).

## Offline and sync

Each device keeps a cached copy of what it last saw, so screens still render
without a connection. Changes made offline (trips, profiles, categories,
dashboard grids, themes) wait in a queue on the device and are sent, in order,
once the home server is reachable again — automatically, and retried about
every 30 seconds while anything is waiting. The sync pill in the header shows
what's pending or needs attention.

The Items page edits the server directly and is read-only while offline.

Each server has an identity. If a device reaches a server that isn't the one it
last used — typically because the server was reinstalled or its database
replaced — a banner asks before anything is loaded from or sent to it: **Use
this server** adopts it and reloads the device's data.

Known limitation: a trip is saved as a whole, so the last save wins. Editing the
same trip on two devices (or in the trip editor while fixing its records on the
Items page) keeps whichever is saved last.

## Look and feel

**Market Fresh** is the default design: fresh green for primary actions, coral
for the one thing on a screen that needs attention (the next step, a saving, an
over-budget warning), quiet white cards, Bricolage Grotesque for titles and
numbers, Figtree for text, and 44px touch targets on phones. Price charts use
colorblind-checked series colors (teal, coral-red, violet, gold), with each
purchase dot colored by store. The app icon is a watercolor tote of produce;
regenerate the PNGs with `tools/icon/build_icons.sh` (needs Chrome). The 21 other
themes are listed in Settings and recolor the whole app, charts included.

The dashboard shows today / this month / this year, a **Budget left** card
(this month's trip budgets minus what those trips cost; it turns red as **Over
budget**, and only appears when a trip this month has a budget) and a **Spending
by month** chart of the last 12 months, with a link to **Shopping trends**. In Settings, **Chart colors** switches the
price charts and the monthly chart between Fresh, Citrus (blue-led) and Berry
(violet-led) for the whole household.

## Shopping trends

`/trends` (linked from the dashboard and History) analyses one profile's bought
items over 30 days, 3 or 6 months, a year or all time: **most bought** (trips an
item was on), **biggest spend**, **buying more lately** (last third of the period
vs the earlier part: at least 2 recent purchases and 1.5× the earlier rate, or new),
**gone quiet** (3+ purchases earlier, none lately — a guess from absence, so any
row can be hidden on this device) and spend by category. *Export image* saves it
as a PNG. Tax, tips and "Unlisted purchases" count toward spend but aren't ranked
as items. It is computed when you open the page, from one indexed read — about
15 ms for a quarter and 100 ms for ten years of weekly shopping.

## Quantities and weights

Each trip line has a quantity and a unit: **each** (a count) or a weight (**lb, oz, kg,
g**). Type `2`, `0.75`, `3/4` or `1 1/2`; blank means 1. The line's price is still what
the whole line cost, so totals, spend and budgets are unchanged. Averages, price charts,
the dashboard grid and "Fill estimates from averages" work per item, or **per pound** for
things bought by weight (12 oz and 0.75 lb are the same amount): fill estimates sets
average × quantity. An item bought both ways (by the pack and by the pound) uses
whichever way most of its purchases were; the others are listed on its page as not
comparable.

`tools/seed/backfill_quantities.py --db <path>` fills in the workbook's quantities for a
database seeded before this existed (dry run by default; `--apply` writes, after a backup).

## Recipes

The **Recipes** tab (after Items) is a gallery of the household's recipes, shared by
every profile. A recipe is a name, an optional description and photo, and one or
more items from the shared catalogue (with an optional amount like "2 cups").
A photo card shows the picture with a thin name bar that grows on hover to show the
first 100 characters of the description; a card without one shows the title and, on
hover, the description. Opening a card shows the items with their household average
prices and an estimated cost, and offers edit, change photo, share (export a PNG or
copy the text), delete and **Create shopping list**.

On a trip, **+ Add recipe** (next to **+ Add item**) adds a recipe's items (never
twice) and lists the meal under **Planned meals**, its photo behind it. Taking a meal
off removes its unbought items, except ones another planned meal still needs. Trends
shows **Popular meals** and **Meals gone quiet**.

Photos are stored as files in the data folder (`recipe-photos/`), up to 1600×1600px
and 5 MB. A larger photo opens the in-app crop editor first (move, zoom, 4:3 / square /
16:9) and only the cropped result is uploaded. On phones, Settings, light/dark and
Switch profile are in the profile menu at the top right.

## Project layout

```
backend/
  GroceryTracker.Core/       # entities, EF Core DbContext + migrations, services
  GroceryTracker.Api/        # ASP.NET Core Minimal API host (serves the API + built frontend)
  GroceryTracker.Api.Tests/  # WebApplicationFactory integration tests
frontend/                    # Vite + React + TypeScript + Tailwind SPA
deploy/                      # example systemd unit
Dockerfile
```

## Local development

Run the API and the frontend dev server side by side — Vite proxies `/api/*`
to the backend (see `frontend/vite.config.ts`).

```bash
# Terminal 1 — backend, http://localhost:5080
dotnet run --project backend/GroceryTracker.Api

# Terminal 2 — frontend, http://localhost:5173
cd frontend && npm install && npm run dev
```

The SQLite database is created automatically on first run (EF Core migrations
apply at startup) under your OS's local app data directory, e.g.
`~/.local/share/GroceryTracker/grocerytracker.db` on Linux. Override the
location with the `DataDirectory` environment variable.

### Tests

```bash
cd backend && dotnet test               # API integration tests
cd frontend && npm test && npm run lint # unit tests (offline queue, cost math, autocomplete) + lint
```

Run the backend tests after every backend change — they spin up the real
ASP.NET Core pipeline against a fresh temp SQLite file per test, so they catch
migration and query-translation issues (not just logic bugs).

### Seed data

A fresh, empty database is filled from
`backend/GroceryTracker.Api/SeedData/seed-data.json` on first start (the
household's spreadsheet history; regenerate it with `tools/seed/`, see its
README). The file (format v4) is one trip per week under the profile "Mom":
the sheet's listed prices as estimates, what was paid per store, each week's
budget and status, and informational totals and savings. Seeding never runs once any
profile exists. Turn it off with `SeedData:Enabled=false`,
or point `SeedData:Path` at another file.

## Production deployment

The `GroceryTracker.Api` project publishes as a single self-contained
deployable: `dotnet publish` builds the React app and copies its output into
the publish directory's `wwwroot`, so one process serves everything.

### Option A — Docker

```bash
docker build -t grocery-tracker .
docker run -d --name grocery-tracker \
  -p 5080:5080 \
  -v grocery-tracker-data:/data \
  grocery-tracker
```

### Option B — systemd (bare metal / VM)

```bash
dotnet publish backend/GroceryTracker.Api -c Release -o /opt/grocery-tracker
sudo useradd --system --no-create-home grocerytracker
sudo cp deploy/grocery-tracker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now grocery-tracker
```

Either way, the app listens on `http://0.0.0.0:5080` by default (see
`backend/GroceryTracker.Api/appsettings.json`) — reachable from any device on
the same network, not just the host machine.

**Two gotchas if you run the published DLL manually** (`dotnet publish` + `dotnet
GroceryTracker.Api.dll`, outside Docker/systemd — both of which already set the
right working directory for you):
- **Run it from inside the publish folder.** The app resolves `wwwroot`
  relative to the process's working directory, not the DLL's location — `cd`
  into the publish output first (`cd /opt/grocery-tracker && dotnet
  GroceryTracker.Api.dll`), not `dotnet /opt/grocery-tracker/GroceryTracker.Api.dll`
  from somewhere else, or static assets 404.
- **`ASPNETCORE_URLS` won't override the port.** `appsettings.json`'s explicit
  `Kestrel:Endpoints` configuration takes precedence over it. To change the
  bind address, edit `appsettings.json` (or `appsettings.Production.json`) or
  set `Kestrel__Endpoints__Http__Url` instead.

### Security note

There is no login and no per-request auth — this matches the original design
(a single-user, single-household app) and keeps the whole thing simple. That
means **anyone who can reach port 5080 can read and modify the data.**

- Only run this on a network you trust (home LAN, or behind a tailnet like
  Tailscale) — never expose it directly to the public internet.
- If you need it reachable outside your LAN, put it behind a tailnet or a
  reverse proxy with its own auth, rather than opening the port on a router.

### Backups

The SQLite file *is* the data — there's no separate backup service. Two ways
to get a copy:
- **Settings → Download my data (.xlsx)** in the app itself. The workbook has a
  **Profiles** sheet; **Trips**, one row per trip with its status, budget,
  estimated and actual spend, savings, budget left and completion date; and
  **Trip Items**, one row per item with its estimate, price, when the price was
  entered and whether it's locked. Tick *Include the item catalogue* to add an
  **Items** sheet: every item with its purchase count and average, last, lowest
  and highest price. (`GET /api/v1/export/data.xlsx?includeItems=true`)
- Copy the file directly from wherever `DataDirectory` points (the volume
  mount in Docker, or `/var/lib/grocery-tracker` in the systemd example).
  The app also copies it to `grocerytracker.db.bak` before applying any
  schema migration on startup.

Replacing the database (restoring a backup, or starting fresh to re-seed) gives
the server a new identity, so each device shows the "isn't the server this
device last used" banner once — choose **Use this server**.
