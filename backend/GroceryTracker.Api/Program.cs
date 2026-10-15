using GroceryTracker.Api;
using GroceryTracker.Api.Endpoints;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<AppExceptionHandler>();

var dataDirectory = builder.Configuration["DataDirectory"]
    ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GroceryTracker");
Directory.CreateDirectory(dataDirectory);
var dbPath = Path.Combine(dataDirectory, "grocerytracker.db");

builder.Services.AddDbContext<GroceryTrackerDbContext>(options =>
    options.UseSqlite($"Data Source={dbPath}")
        .AddInterceptors(new SqlitePragmaInterceptor()));

builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton<ServerInstanceHolder>();
builder.Services.AddScoped<ServerInstanceService>();
builder.Services.AddScoped<LookupService>();
builder.Services.AddScoped<ProfileService>();
builder.Services.AddScoped<CategoryService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<TripService>();
builder.Services.AddScoped<DashboardService>();
builder.Services.AddScoped<ItemHistoryService>();
builder.Services.AddScoped<ExportService>();
builder.Services.AddScoped<SeedDataService>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<GroceryTrackerDbContext>();
    ApplyMigrations(db, dbPath);

    var instanceService = scope.ServiceProvider.GetRequiredService<ServerInstanceService>();
    var holder = scope.ServiceProvider.GetRequiredService<ServerInstanceHolder>();
    holder.InstanceId = await instanceService.EnsureInstanceIdAsync();

    // First run on a fresh database gets the shipped grocery history. Disabled in
    // integration tests, which assert against databases they populate themselves.
    if (builder.Configuration.GetValue("SeedData:Enabled", true))
    {
        var seedPath = builder.Configuration["SeedData:Path"]
            ?? Path.Combine(app.Environment.ContentRootPath, "SeedData", "seed-data.json");
        await scope.ServiceProvider.GetRequiredService<SeedDataService>().SeedIfEmptyAsync(seedPath);
    }
}

// Must wrap everything below it, so it's registered before any endpoint mapping.
app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapHealthEndpoints();
app.MapProfileEndpoints();
app.MapCategoryEndpoints();
app.MapLookupEndpoints();
app.MapTripEndpoints();
app.MapSettingsEndpoints();
app.MapDashboardEndpoints();
app.MapExportEndpoints();

// Same-origin: Kestrel serves the built React app's static files plus the
// API below, so no CORS configuration is needed in production.
app.UseDefaultFiles();
app.UseStaticFiles();

// An unknown /api route is a 404, never the SPA shell: answering a stale or
// mistyped API call with index.html (200, text/html) makes the client fail to
// parse it and silently show nothing. More specific than the SPA fallback, so it wins.
app.MapFallback("/api/{**path}", () => Results.Problem(
    type: ProblemTypes.RouteNotFound, title: "No such API endpoint.", statusCode: StatusCodes.Status404NotFound));
app.MapFallbackToFile("index.html");

app.Run();

static void ApplyMigrations(GroceryTrackerDbContext db, string dbPath)
{
    // The on-device SQLite file is the user's only copy of their data — back it
    // up before applying any pending schema migration.
    if (File.Exists(dbPath) && db.Database.GetPendingMigrations().Any())
    {
        File.Copy(dbPath, dbPath + ".bak", overwrite: true);
    }

    db.Database.Migrate();
}

public partial class Program; // exposed for WebApplicationFactory<Program> in integration tests
