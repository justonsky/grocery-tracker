# Single-image deploy: builds the React app and the .NET API together, then
# ships just the ASP.NET Core runtime + published output. Kestrel serves both
# the API and the built frontend from the same process (see Program.cs).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Node is only needed at build time — GroceryTracker.Api.csproj's
# PublishFrontend target runs `npm run build` during `dotnet publish`.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY backend/ backend/
COPY frontend/ frontend/

WORKDIR /src/backend
RUN dotnet publish GroceryTracker.Api/GroceryTracker.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# The SQLite file is the user's only copy of their data — keep it on a
# named volume so it survives image rebuilds/redeploys.
ENV DataDirectory=/data
VOLUME /data

# Matches appsettings.json's Kestrel binding (0.0.0.0:5080) — intentionally
# LAN-reachable, not loopback-only. See README for the security tradeoff.
EXPOSE 5080
ENTRYPOINT ["dotnet", "GroceryTracker.Api.dll"]
