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

**Layout:**
- `backend/GroceryTracker.Core/` — EF Core DbContext, migrations, entities, services
- `backend/GroceryTracker.Api/` — ASP.NET Minimal API endpoints, serves built frontend from `wwwroot`
- `backend/GroceryTracker.Api.Tests/` — WebApplicationFactory integration tests (hit real DB)
- `frontend/src/` — React app (main layout in `main.tsx`, routes in `app/`, screens in `screens/`, API client in `api/`, components in `components/`)

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
- Create EF Core migration: `dotnet ef migrations add [Name] --project backend/GroceryTracker.Core`
- Migrations run automatically at app startup

## Security & deployment notes

- **No auth** — this is by design for a single-household, home-network app. Do not expose to the public internet; run behind Tailscale/VPN or a reverse proxy with auth.
- **SQLite is the data** — the `.db` file is your entire database; EF Core writes `.bak` sidecars before migrations for safety.
- **Production:** Use Docker (`docker build -t grocery-tracker .` + docker run) or systemd (see `deploy/`). Single self-contained deployable via `dotnet publish` — no external runtime dependencies.
- **Port:** Kestrel binds `0.0.0.0:5080` by default (configurable in `appsettings.json` via `Kestrel:Endpoints` or `Kestrel__Endpoints__Http__Url` env var); `ASPNETCORE_URLS` won't override it.
- **Static assets:** When running published DLL manually, **run from inside the publish folder** so `wwwroot` resolves correctly.

## Key files

- `README.md` — project overview, deployment options, troubleshooting
- `Dockerfile` — single-stage build, publishes + containerizes
- `frontend/vite.config.ts` — Vite + React + Tailwind + PWA config, dev proxy setup
- `backend/GroceryTracker.Api/Program.cs` — service registration, middleware, route setup
- `backend/GroceryTracker.Core/Data/GroceryTrackerDbContext.cs` — EF Core DbContext, all entities
