using GroceryTracker.Api;
using GroceryTracker.Api.Endpoints;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Services;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.Sqlite;
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
builder.Services.AddSingleton(new RecipePhotoStore(dataDirectory));
builder.Services.AddScoped<RecipeService>();

// Receipt import: a cloud vision model by default (needs Receipts:ApiKey, or ANTHROPIC_API_KEY);
// Receipts:Reader=fixture swaps in canned readings for tests and demos.
var receiptOptions = builder.Configuration.GetSection("Receipts").Get<ReceiptOptions>() ?? new ReceiptOptions();
receiptOptions.ApiKey ??= builder.Configuration["ANTHROPIC_API_KEY"];
builder.Services.AddSingleton(receiptOptions);
if (receiptOptions.Reader == "fixture")
{
    builder.Services.AddSingleton<IReceiptReader, FixtureReceiptReader>();
}
else
{
    builder.Services.AddHttpClient<IReceiptReader, AnthropicReceiptReader>(client => client.Timeout = TimeSpan.FromSeconds(90));
}
builder.Services.AddSingleton(new ReceiptImageStore(dataDirectory));
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy(ReceiptEndpoints.ReadPolicy, _ => RateLimitPartition.GetFixedWindowLimiter("receipt-reads", _ =>
        new FixedWindowRateLimiterOptions { PermitLimit = Math.Max(receiptOptions.ReadsPerHour, 1), Window = TimeSpan.FromHours(1) }));
    options.OnRejected = async (context, ct) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(new Microsoft.AspNetCore.Mvc.ProblemDetails
        {
            Type = ProblemTypes.TooManyReceipts, Status = StatusCodes.Status429TooManyRequests,
            Title = "Too many receipts read in the last hour. Try again later.",
        }, (System.Text.Json.JsonSerializerOptions?)null, "application/problem+json", ct);
    };
});
builder.Services.AddScoped<ReceiptService>();
builder.Services.AddScoped<TripService>();
builder.Services.AddScoped<DashboardService>();
builder.Services.AddScoped<TrendsService>();
builder.Services.AddScoped<ItemHistoryService>();
builder.Services.AddScoped<ItemCatalogService>();
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
        try
        {
            await scope.ServiceProvider.GetRequiredService<SeedDataService>().SeedIfEmptyAsync(seedPath);
        }
        catch (Exception ex)
        {
            // A bad seed must never keep the server from starting.
            app.Logger.LogError(ex, "Loading the seed data failed; starting without it.");
        }
    }
}

// Must wrap everything below it, so it's registered before any endpoint mapping.
app.UseExceptionHandler();
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapHealthEndpoints();
app.MapProfileEndpoints();
app.MapCategoryEndpoints();
app.MapLookupEndpoints();
app.MapItemEndpoints();
app.MapTripEndpoints();
app.MapRecipeEndpoints();
app.MapReceiptEndpoints();
app.MapSettingsEndpoints();
app.MapDashboardEndpoints();
app.MapTrendsEndpoints();
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
    // up before applying any pending schema migration. SQLite's online backup
    // includes pages still in the WAL file, which a plain file copy would miss.
    if (File.Exists(dbPath) && db.Database.GetPendingMigrations().Any())
    {
        var backupPath = dbPath + ".bak";
        File.Delete(backupPath);
        using var source = new SqliteConnection($"Data Source={dbPath}");
        using var target = new SqliteConnection($"Data Source={backupPath};Pooling=False");
        source.Open();
        target.Open();
        source.BackupDatabase(target);
    }

    db.Database.Migrate();
}

public partial class Program; // exposed for WebApplicationFactory<Program> in integration tests
