using GroceryTracker.Api.Endpoints;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

var dataDirectory = builder.Configuration["DataDirectory"]
    ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GroceryTracker");
Directory.CreateDirectory(dataDirectory);
var dbPath = Path.Combine(dataDirectory, "grocerytracker.db");

builder.Services.AddDbContext<GroceryTrackerDbContext>(options =>
    options.UseSqlite($"Data Source={dbPath}")
        .AddInterceptors(new SqlitePragmaInterceptor()));

builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddScoped<LookupService>();
builder.Services.AddScoped<ProfileService>();
builder.Services.AddScoped<CategoryService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<TripService>();
builder.Services.AddScoped<ListService>();
builder.Services.AddScoped<DashboardService>();
builder.Services.AddScoped<ItemHistoryService>();
builder.Services.AddScoped<ExportService>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<GroceryTrackerDbContext>();
    ApplyMigrations(db, dbPath);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapProfileEndpoints();
app.MapCategoryEndpoints();
app.MapLookupEndpoints();
app.MapTripEndpoints();
app.MapListEndpoints();
app.MapSettingsEndpoints();
app.MapDashboardEndpoints();
app.MapExportEndpoints();

// Same-origin: Kestrel serves the built React app's static files plus the
// API below, so no CORS configuration is needed in production.
app.UseDefaultFiles();
app.UseStaticFiles();

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
