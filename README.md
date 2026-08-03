# Grocery Tracker

# Overview
This is a project for experimenting with Claude workflows and AI in general. It is a local-first application for logging grocery trips and items purchased, with data visualization capabilities. It is capable of tracking item prices over time across different grocery stores, with synchronization and back-up capabilities. 

This tool was built with the motivation of improving my mom's grocery shopping tracking and helping her see the many data points she has gathered from grocery trips over the years.

## IMPORTANT!
This application is meant to run on a trusted home network and should NOT be exposed on any public-facing server.

Stack: **React + Tailwind** (frontend), **C# / ASP.NET Core + EF Core** (backend),
**SQLite** (data store). One process serves both the API and the built frontend;
any device's browser on the same network connects to it. See
`docs`-equivalent context in the original architecture plan for the reasoning
behind this deployment model (self-hosted web app rather than native apps).

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
cd backend && dotnet test
```

Run this after every backend change — the integration tests spin up the real
ASP.NET Core pipeline against a fresh temp SQLite file per test, so they catch
migration and query-translation issues (not just logic bugs).

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
- **Settings → Download my data (.xlsx)** in the app itself.
- Copy the file directly from wherever `DataDirectory` points (the volume
  mount in Docker, or `/var/lib/grocery-tracker` in the systemd example).
  EF Core also writes a `.bak` sidecar next to it automatically before
  applying any schema migration.
