# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick start

**Local development:** Run the backend and frontend dev server in separate terminals:

```bash
# Terminal 1 — Backend API (http://localhost:5080)
dotnet run --project backend/GroceryTracker.Api

# Terminal 2 — Frontend (http://localhost:5173, proxies /api to backend)
cd frontend && npm install && npm run dev
```

The app creates a SQLite database automatically in `~/.local/share/GroceryTracker/` on first run (override with `DataDirectory` env var).

## Build, lint, test

**Frontend:**
- Development: `cd frontend && npm run dev`
- Build: `cd frontend && npm run build` (checks types + builds)
- Lint: `cd frontend && npm run lint` (Oxlint)
- Test: `cd frontend && npm test` (Vitest: offline outbox/drain, cost math, autocomplete ranking, quantities, recipes)

**Seed tools:** `cd tools/seed && python3 build_seed.py` regenerates the seed; for an old live database, `backfill_quantities.py --db …` (server stopped) then `merge_named_items.py --server …` (server running); tests: `python3 -m unittest test_backfill_quantities test_merge_named_items`.

**Backend:**
- Run: `dotnet run --project backend/GroceryTracker.Api`
- Build: `dotnet build` (from repo root; `GroceryTracker.slnx`)
- Test: `dotnet test` (from repo root; integration tests spin up real ASP.NET + temp SQLite per test)
- Publish (single deployable): `dotnet publish backend/GroceryTracker.Api -c Release`

## Architecture

**Stack:** React + TypeScript + Tailwind (frontend) | C# ASP.NET Core + EF Core (backend) | SQLite

**Key design decisions:**
- Single-user, home-network app — no login, no per-request auth (trusted network only)
- Local-first with optional sync/backup (download data as .xlsx from UI)
- Monorepo with shared deployment — one process serves API + built frontend
- Vite proxies `/api/*` to backend in dev; production build bundles both via `dotnet publish`
- Unknown `/api/*` routes return a 404 ProblemDetails — never the SPA's index.html (which a client would fail to parse silently)
- Inputs are checked before they reach the database (`Amounts`: money 0..$1,000,000 via `Amounts.ToCents`, `yyyy-MM-dd` dates, names ≤ 200 chars, known category ids) → 400 `/errors/validation`, never a 500 the outbox would retry forever. A 500 never echoes the exception text. Idempotent PUTs that race on a first insert retry once as an update (`InsertRace`).
- "Today" is the device's local date: the dashboard and trends take `?today=yyyy-MM-dd` (frontend `dates.ts` `localIsoDate`; never `toISOString()`, which is tomorrow on a US evening), falling back to the server's local date (`LocalDate`).

**Domain model (see entity comments in `GroceryTracker.Core/Entities/`):**
- `TripItem.QuantityMilli` (thousandths, default 1000) + `Unit` (`each|lb|oz|kg|g`): price stays the line total. Anything that averages or charts prices must go through `Quantities.Summarize` (per item, or per pound for weights; an item's dominant price unit wins, the rest are excluded and counted). `TripItemInput.Quantity/Unit` null = keep the line's (older queued saves). Frontend: `trips/quantity.ts`, `components/QuantityField.tsx`.
- `Trip` is both the shopping list and the record of the shop; `Status` is Planned → Shopping → Done. `TripItem` carries `EstimateCents`, `PriceCents` and `PricedAt`.
- A trip line's price locks 7 days after it was first entered (`TripService.PriceEditWindow`). A trip save keeps locked lines exactly as stored (changes to them, or leaving them out, are ignored — so a queued offline save that crossed the lock still applies everything else), and a trip with locked lines keeps its date. Only the Items portal can correct a locked line, and only with `ConfirmLocked: true` (else 409 `/errors/price-locked`); deleting a locked line, or an item with locked lines, likewise needs `?confirmLocked=true`. A line sent without an id only claims a locked line of the same name when it carries the same price (an older client re-sending it); otherwise it's a new line.
- A line's store comes back in the trip's own spelling (`TripStore.Name`), and the editor compares store names case-insensitively.
- `Item` and `Store` are household-wide (no `ProfileId`); prices, averages and item history pool every profile's purchases. Trips and spend stay per profile.
- `TrackedItem` + `Profile.TrackedItemsCustomized`: the dashboard grid is the 8 most recent items until a profile customizes it.
- `Profile.Theme` is a theme id (default `fresh` = "Market Fresh"; `nocturne` is the old purple look, still selectable); the catalogue and colors live in `frontend/src/app/themes.ts` + `index.css`.
- Household settings (`AppSettings` key/value rows, `SettingsService`): `ThemeMode`, `ChartScheme` (`fresh|citrus|berry`; applied as `data-chart` on `<html>` by `useTheme`, so every chart follows it) and `GroupColors` — the share card's group backgrounds, a JSON map of `store:<slug>`/`category:<slug>` → `#rrggbb` or `none` (grouping and default store colors in `frontend/src/trips/shareGroups.ts`). Settings writes are online-only, not queued.
- Dashboard (`DashboardService`): spend today/month/year (counting only shopped trips — done, or with a price; a planned list isn't a trip yet, and History likewise lists shopped trips only), `MonthBudget`/`MonthBudgetSpent` (budgets of this month's trips and what those trips cost → the Budget-left card), and `MonthlySpend` (12 calendar months, zero-filled → `MonthlySpendChart`).
- Recipes (`Recipe`, `RecipeItem`, `TripRecipe`; `RecipeService`, `/api/v1/recipes`): household-wide, items are the shared `Item`s (deleting an item drops it from recipes; merging repoints). Photos are files in `<DataDirectory>/recipe-photos/` (`RecipePhotoStore`, never the DB; the URL's `?v=` version only ever grows — it's cached as immutable — and the DTOs show 0 when there's no photo), limits in `RecipeLimits` (1600px, 5 MB) enforced by reading the image header; over the limit → 413 `/errors/photo-too-large`, and the frontend's `PhotoCropper` crops/shrinks first. A trip's planned meals are `TripInput.RecipeIds` (null = leave alone, unknown ids dropped); its item lines are ordinary lines, so deleting a recipe leaves them. Recipe edits/photos are online-only; the list is cached for offline use on trips. Removing a planned meal in the trip editor drops its unbought lines no other meal needs (`lineKeysToDrop`). Meals are added from the trip editor's toolbar ("+ Add recipe" beside "Fill estimates from averages"; pinned to the top on a phone, together with the totals while shopping); `RecipePicker` asks which store the items go to, starting on the last store picked on that trip, else the trip's first — never "any store" when the trip has stores.
- Receipt import (`ReceiptService`, `/api/v1/receipts`, entities `Receipt`/`ReceiptLine`/`ItemAlias`): `IReceiptReader` is `AnthropicReceiptReader` (Messages API, image + forced tool `record_receipt` → `ReceiptReading`; a second `record_choices` call picks among ~20 fuzzy candidates from `ItemNameMatcher`) or `FixtureReceiptReader` (`Receipts:Reader=fixture`, JSON in `backend/GroceryTracker.Api.Tests/ReceiptFixtures/`, chosen by the `X-Receipt-Fixture` header / `?receiptFixture=` in the app — tests and demos only). Opt-in: household setting `ReceiptImport` + a configured key (`Receipts:ApiKey`/`ANTHROPIC_API_KEY`); reads are rate-limited (`Receipts:ReadsPerHour`, default 30 → 429 `/errors/too-many-receipts`). The photo is a file in `<DataDirectory>/receipts/` only while the receipt is a draft (deleted on apply/discard; drafts expire after 7 days). The server never edits trips: the review (`components/receipts/ReceiptImport.tsx`) pairs lines with the editor's unbought lines (`receipts/merge.ts` `pairWithPlanned`) and merges into the draft (`mergeReceipt`), and `apply` only records `ItemAlias` rows (store + `ReceiptKeys.KeyFor`: item code, else normalized text) so the next receipt matches. Item merge repoints aliases; item delete cascades. Aliases are editable on the item page (`POST /items/{id}/aliases`, `PUT /item-aliases/{id}` — store, label, code, or move to another item; same store + key → 409 `/errors/alias-conflict`).
- Trends (`TrendsService`, `GET /profiles/{id}/trends?range=30d|90d|180d|365d|all`): computed per request, nothing stored; item `AveragePrice` is per `PriceUnit` via `Quantities.Summarize`. One narrow read of priced lines (index `Trip(ProfileId, Date)`), names looked up once per item, grouping in memory. "Recent" = last third of the period (min 14 days); rising/gone-quiet compare it with the rest; `NotGroceries` (tax, tips, unlisted purchases) are excluded from item rankings only. UI: `screens/Trends.tsx` + `components/TrendsInfographic.tsx` (the export is a fixed-width copy rendered only while saving).
- Backup (`ExportService`): sheets Profiles, Trips (per-trip totals, same math as `TripService`), Trip Items (per line, with quantity/unit/unit price), Recipes (when any), and Items (catalogue, per-unit prices) when `?includeItems=true`. Keep it in step when trip/line fields change. A file backup must include `<DataDirectory>/recipe-photos/`.
- Navigation (`app/AppShell.tsx`): desktop top nav Home · History · Grocery Trips · Items · Recipes; phone bottom tabs use short labels (Trips), and Settings / light-dark / Switch profile live in the phone header's profile menu.

**Offline/sync (frontend `src/offline/`, `app/ConnectivityProvider.tsx`, `app/SyncProvider.tsx`):**
- Writes go through `performOrQueue`: send now, or queue in IndexedDB on a network-class failure (and always queue while the server is unrecognised, or while a known server's first check is pending). Every queued op is an idempotent PUT/DELETE keyed by a client-generated id. Entities: trip, profile, category, tracked-items.
- The drain runs when the server becomes reachable and on every successful probe (~30s) while anything is queued.
- Each server has an instance id (stored in its DB). A device that sees a different one pauses all reads and holds writes until the user picks "Use this server" (`WrongServerBanner`).
- Unsaved edits: `app/useUnsavedChangesGuard.ts` (needs the data router in `main.tsx`; `useBlocker`) raises a "Leave this page?" confirm on tab switches, Back and links, plus the browser's own prompt on close/reload. The trip editor (dirty = form differs from the last loaded/saved copy) and the Items portal's item details use it; Settings is a dialog over the page (`app/settingsLink.ts`), so opening it never prompts.
- App updates: the service worker is `registerType: 'prompt'` and registered by `app/useAppUpdate.ts`, which also checks for a new build every 30 min and when the app returns to the foreground. A downloaded build waits for the `UpdateBanner`'s Reload — never an automatic reload — and that reload comes back to the same profile and page (`app/updateResume.ts`, a one-shot sessionStorage stash; any other reload still lands on the picker).
- The Items portal (`/items`), recipe edits/photos, Trends and the backup are online-only — direct API calls, not queued.
- Trip saves replace the whole trip (last writer wins); lines carry ids so edits keep their `PricedAt`.
- A queued trip save is what the trip is until it syncs (`trips/pendingTrips.ts`): the trip and Trips/History queries overlay waiting outbox ops, so an offline-saved trip is listed and reopens as saved. Blocked ops are re-checked on every drain; PUT/DELETE give up after 10 s (then queue).

**Layout:**
- `backend/GroceryTracker.Core/` — EF Core DbContext, migrations, entities, services
- `backend/GroceryTracker.Api/` — ASP.NET Minimal API endpoints, serves built frontend from `wwwroot`
- `backend/GroceryTracker.Api.Tests/` — WebApplicationFactory integration tests (hit real DB)
- `frontend/src/` — React app (main layout in `main.tsx`, routes in `app/`, screens in `screens/`, API client in `api/`, components in `components/`, offline queue in `offline/`, trip cost math and quantities in `trips/`, recipe helpers in `recipes.ts`)
- `tools/seed/` — workbook → seed generator and quantity backfill (Python, stdlib); `tools/icon/` — app icon generator
- Autocomplete fields use `components/ui/Combobox.tsx` (capped, ranked suggestions) — not native `<datalist>`, which can't limit a 1,000+ item catalogue

**Design system (`frontend/src/index.css` — keep screens on these, no hard-coded hex):**
- Tokens as Tailwind colours: `bg-bg`, `bg-surface`, `text-text` (`/60` for secondary), `border-divider` (hairline), `border-control` (inputs), `bg-chip`; `accent` (+ `text-on-accent`, scale `accent-100..900` that inverts in dark mode, so `bg-accent-800 text-accent-200` is always a tinted chip); `highlight` (coral: `bg-highlight text-on-highlight`, tint `bg-highlight-bg text-highlight-ink`) — at most one per screen; `danger`; charts `var(--chart-1..4)` (colourblind-checked; `data-chart="citrus|berry"` swaps schemes, and the generic themes defer to `--scheme-N` so a chosen scheme beats their own chart colours).
- Classes: `.btn` + `.btn-primary|.btn-highlight|.btn-secondary|.btn-ghost|.btn-danger`, `.btn-sm`, `.btn-icon` (44px); `.card` + `.elev-sm|md|lg`, `.card-kicker|title|meta`; `.tag` + `.tag-accent|highlight|neutral|outline`; `.input`, `.field label`, `.seg`/`.seg-opt`; `.nav*`/`.tab-*`; `.table`; `.dialog*`.
- Theme blocks: `:root`/`.dark` hold the shared tokens; `fresh`/`nocturne` are hand-set palettes; the other 20 themes are a hue + chroma pair expanded in OKLCH (warm hues get a teal highlight via `--th-hl`). Titles are Bricolage Grotesque 700, body Figtree; prices use `tabular-nums`.
- `AppShell`'s root is a `.group` (the sync-strip padding), so any `group-hover:` inside the app fires whenever the page is hovered — name your group (`group/card` + `group-hover/card:`), as the recipe cards do.
- Icons are inline stroke SVG (no emoji or glyph icons); the app icon is `tools/icon/` → `frontend/public`.

**Frontend state management:**
- TanStack Query (with localStorage persistence via `query-sync-storage-persister`)
- React Router v7 for navigation
- Tailwind v4 for styling

## Common workflows

**Adding a new backend endpoint:**
1. Create a service in `GroceryTracker.Core/Services/` if needed
2. Add endpoint in `backend/GroceryTracker.Api/Endpoints/` (organized per feature)
3. Wire up in `Program.cs` (already done for common services)
4. Test via integration tests in `GroceryTracker.Api.Tests/`

**Adding a frontend page:**
1. Create screen component in `frontend/src/screens/`
2. Add route in `frontend/src/app/` (Router setup)
3. Create API client methods in `frontend/src/api/` (with TanStack Query hooks)
4. Use components from `frontend/src/components/`

**Database schema changes:**
- Modify entity in `GroceryTracker.Core/`
- Create EF Core migration: `dotnet ef migrations add [Name] --project backend/GroceryTracker.Core --startup-project backend/GroceryTracker.Api` (needs the `dotnet-ef` tool, version matching EF Core 10.0.x)
- Migrations run automatically at app startup; write data backfills (`migrationBuilder.Sql`) into the same migration and check them against a copy of a real database
- Seed data (`GroceryTracker.Api/SeedData/seed-data.json`, format v4: one trip per workbook week under profile "Mom"; item `estimate` = the sheet's listed price, `price` = paid, trip `status`/`total`/`estimatedTotal`/`savings`) loads only into an empty database; regenerate it with `python3 tools/seed/build_seed.py [--source workbook.xlsx]` and keep `SeedDataService` and the tools in `tools/seed/` in step with entity changes (rules and verification: `tools/seed/README.md`)

## Security & deployment notes

- **No auth** — this is by design for a single-household, home-network app. Do not expose to the public internet; run behind Tailscale/VPN or a reverse proxy with auth.
- **SQLite is the data** — the `.db` file is your entire database; `Program.cs` copies it to `grocerytracker.db.bak` before applying pending migrations. Replacing the database gives the server a new instance id (devices then show the wrong-server banner once).
- **Production:** Use Docker (`docker build -t grocery-tracker .` + docker run) or systemd (see `deploy/`). Single self-contained deployable via `dotnet publish` — no external runtime dependencies.
- **Port:** Kestrel binds `0.0.0.0:5080` by default (configurable in `appsettings.json` via `Kestrel:Endpoints` or `Kestrel__Endpoints__Http__Url` env var); `ASPNETCORE_URLS` won't override it.
- **Static assets:** When running published DLL manually, **run from inside the publish folder** so `wwwroot` resolves correctly.

## Key files

- `README.md` — project overview, deployment options, troubleshooting
- `Dockerfile` — single-stage build, publishes + containerizes
- `frontend/vite.config.ts` — Vite + React + Tailwind + PWA config, dev proxy setup
- `backend/GroceryTracker.Api/Program.cs` — service registration, middleware, route setup
- `backend/GroceryTracker.Core/Data/GroceryTrackerDbContext.cs` — EF Core DbContext, all entities

## Testing UI changes

Check every UI change at desktop (~1280px) and phone (~390px) widths, and as both a brand-new profile and an existing one with history. Serve a published build on a scratch `DataDirectory` (an empty one gets the seed data) rather than the real database. A page reload returns to the profile picker by design, so navigate within the app.
