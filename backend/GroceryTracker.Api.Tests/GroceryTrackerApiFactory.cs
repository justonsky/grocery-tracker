using GroceryTracker.Core.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace GroceryTracker.Api.Tests;

// A fresh temp SQLite file per factory instance (test classes construct one per
// test method) so integration tests never share or leak state across each other.
public class GroceryTrackerApiFactory(DateTimeOffset? fixedNow = null) : WebApplicationFactory<Program>
{
    private readonly string _dataDirectory =
        Path.Combine(Path.GetTempPath(), "grocery-tracker-tests", Guid.NewGuid().ToString("N"));

    public string DataDirectory => _dataDirectory;

    // Only set when constructed with fixedNow; tests move it forward with Advance.
    public FakeClock? Clock { get; } = fixedNow is { } start ? new FakeClock(start) : null;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(_dataDirectory);
        builder.UseSetting("DataDirectory", _dataDirectory);
        // Tests build their own fixtures; the shipped seed data would skew every assertion.
        builder.UseSetting("SeedData:Enabled", "false");
        // Receipts are "read" from the sample fixtures, never by calling the real model.
        builder.UseSetting("Receipts:Reader", "fixture");
        builder.UseSetting("Receipts:FixtureDir", Path.Combine(AppContext.BaseDirectory, "ReceiptFixtures"));

        if (Clock is { } clock)
        {
            // Registered after Program.cs's own AddSingleton<IClock, SystemClock>() runs,
            // so this later registration wins when IClock is resolved.
            builder.ConfigureServices(services => services.AddSingleton<IClock>(clock));
        }
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (Directory.Exists(_dataDirectory))
        {
            Directory.Delete(_dataDirectory, recursive: true);
        }
    }
}

public class FakeClock(DateTimeOffset now) : IClock
{
    public DateTimeOffset UtcNow { get; private set; } = now;

    public void Advance(TimeSpan by) => UtcNow += by;
}
