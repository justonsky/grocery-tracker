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
- Test: `cd frontend && npm test` (Vitest: offline outbox/drain, cost math, autocomplete ranking)

**Backend:**
- Run: `dotnet run --project backend/GroceryTracker.Api`
- Build: `dotnet build` (from repo root)
- Test: `dotnet test` (integration tests spin up real ASP.NET + temp SQLite per test)
- Publish (single deployable): `dotnet publish backend/GroceryTracker.Api -c Release`

## Architecture

**Stack:** React + TypeScript + Tailwind (frontend) | C# ASP.NET Core + EF Core (backend) | SQLite

**Key design decisions:**
- Single-user, home-network app — no login, no per-request auth (trusted network only)
- Local-first with optional sync/backup (download data as .xlsx from UI)
- Monorepo with shared deployment — one process serves API + built frontend
- Vite proxies `/api/*` to backend in dev; production build bundles both via `dotnet publish`
- Unknown `/api/*` routes return a 404 ProblemDetails — never the SPA's index.html (which a client would fail to parse silently)

**Domain model (see entity comments in `GroceryTracker.Core/Entities/`):**
- `Trip` is both the shopping list and the record of the shop; `Status` is Planned → Shopping → Done. `TripItem` carries `EstimateCents`, `PriceCents` and `PricedAt`.
- A trip line's price locks 7 days after it was first entered (`TripService.PriceEditWindow`). The trip editor can't change a locked line (409 `/errors/price-locked`); the Items portal can, only with `ConfirmLocked: true`.
- `Item` and `Store` are household-wide (no `ProfileId`); prices, averages and item history pool every profile's purchases. Trips and spend stay per profile.
- `TrackedItem` + `Profile.TrackedItemsCustomized`: the dashboard grid is the 8 most recent items until a profile customizes it.
- `Profile.Theme` is a theme id; the catalogue and colors live in `frontend/src/app/themes.ts` + `index.css`.

**Offline/sync (frontend `src/offline/`, `app/ConnectivityProvider.tsx`, `app/SyncProvider.tsx`):**
- Writes go through `performOrQueue`: send now, or queue in IndexedDB on a network-class failure. Every queued op is an idempotent PUT/DELETE keyed by a client-generated id. Entities: trip, profile, category, tracked-items.
- The drain runs when the server becomes reachable and on every successful probe (~30s) while anything is queued.
- Each server has an instance id (stored in its DB). A device that sees a different one pauses all reads and holds writes until the user picks "Use this server" (`WrongServerBanner`).
- The Items portal (`/items`) is online-only — direct API calls, not queued.
- Trip saves replace the whole trip (last writer wins); lines carry ids so edits keep their `PricedAt`.

**Layout:**
- `backend/GroceryTracker.Core/` — EF Core DbContext, migrations, entities, services
- `backend/GroceryTracker.Api/` — ASP.NET Minimal API endpoints, serves built frontend from `wwwroot`
- `backend/GroceryTracker.Api.Tests/` — WebApplicationFactory integration tests (hit real DB)
- `frontend/src/` — React app (main layout in `main.tsx`, routes in `app/`, screens in `screens/`, API client in `api/`, components in `components/`, offline queue in `offline/`, trip cost math in `trips/`)
- Autocomplete fields use `components/ui/Combobox.tsx` (capped, ranked suggestions) — not native `<datalist>`, which can't limit a 1,000+ item catalogue

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
- Seed data (`GroceryTracker.Api/SeedData/seed-data.json`) loads only into an empty database; keep `SeedDataService` in step with entity changes

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
