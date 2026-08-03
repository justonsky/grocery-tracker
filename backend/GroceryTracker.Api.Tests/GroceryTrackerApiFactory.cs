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

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(_dataDirectory);
        builder.UseSetting("DataDirectory", _dataDirectory);

        if (fixedNow is { } now)
        {
            // Registered after Program.cs's own AddSingleton<IClock, SystemClock>() runs,
            // so this later registration wins when IClock is resolved.
            builder.ConfigureServices(services =>
                services.AddSingleton<IClock>(new FakeClock(now)));
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
    public DateTimeOffset UtcNow => now;
}
