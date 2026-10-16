using System.Text.Json;
using FluentAssertions;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Entities;
using GroceryTracker.Core.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GroceryTracker.Api.Tests;

public class SeedDataServiceTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly GroceryTrackerDbContext _db;
    private readonly string _dir;

    public SeedDataServiceTests()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        _connection.Open();
        _db = new GroceryTrackerDbContext(
            new DbContextOptionsBuilder<GroceryTrackerDbContext>().UseSqlite(_connection).Options);
        _db.Database.Migrate();
        _dir = Path.Combine(Path.GetTempPath(), "grocery-seed-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private string WriteSeed(object seed)
    {
        var path = Path.Combine(_dir, "seed-data.json");
        File.WriteAllText(path, JsonSerializer.Serialize(seed, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        return path;
    }

    private static object SampleSeed() => new
    {
        version = 1,
        profiles = new[]
        {
            new
            {
                name = "Mom",
                trips = new object[]
                {
                    new { name = (string?)null, date = "2026-08-01", budget = (decimal?)null, stores = new[] { "Aldi" }, items = new object[]
                        { new { name = "Whole Milk", category = "Dairy", store = "Aldi", @checked = true, price = (decimal?)3.49m },
                          new { name = "Bananas", category = "Produce", store = "Aldi", @checked = true, price = (decimal?)1.20m } } },
                    new { name = (string?)null, date = "2026-08-08", budget = (decimal?)null, stores = new[] { "BJ's" }, items = new object[]
                        { new { name = "whole milk", category = "Dairy", store = "BJ's", @checked = true, price = (decimal?)4.25m } } },
                    // A trip still being planned: budget set, nothing bought yet.
                    new { name = (string?)"Weekly stock-up", date = "2026-08-09", budget = (decimal?)160m, stores = new[] { "Aldi" },
                          items = new object[] { new { name = "Bananas", category = "Produce", store = "Aldi", @checked = false, price = (decimal?)null } } },
                },
            },
        },
    };

    [Fact]
    public async Task SeedIfEmpty_PopulatesProfilesTripsAndLists()
    {
        var outcome = await new SeedDataService(_db).SeedIfEmptyAsync(WriteSeed(SampleSeed()));

        outcome.Should().Be(SeedOutcome.Seeded);
        var profile = await _db.Profiles.SingleAsync();
        profile.Name.Should().Be("Mom");

        _db.Trips.Count().Should().Be(3);
        _db.TripItems.Count().Should().Be(4);

        // Money round-trips through integer cents.
        var milkLines = await _db.TripItems.Where(ti => ti.Item!.NormalizedName == "whole milk")
            .Select(ti => ti.PriceCents).ToListAsync();
        milkLines.Should().BeEquivalentTo([349, 425]);

        var planned = await _db.Trips.SingleAsync(t => t.Name == "Weekly stock-up");
        planned.BudgetCents.Should().Be(16000);
        (await _db.TripStores.CountAsync(ts => ts.TripId == planned.Id)).Should().Be(1);
        // The planned item carries no price until it is actually bought.
        (await _db.TripItems.SingleAsync(ti => ti.TripId == planned.Id)).PriceCents.Should().BeNull();
    }

    [Fact]
    public async Task SeedIfEmpty_V3File_HonorsStatusAndEstimates()
    {
        var seed = new
        {
            version = 3,
            profiles = new[]
            {
                new
                {
                    name = "Mom",
                    trips = new object[]
                    {
                        // Every line is ticked off, but the file says the shop is still under way.
                        new { name = (string?)null, date = "2026-08-01", budget = (decimal?)null, stores = new[] { "Aldi" },
                              items = new object[]
                              { new { name = "Whole Milk", category = "Dairy", store = "Aldi", @checked = true, price = (decimal?)3.49m, estimate = (decimal?)3.25m },
                                new { name = "Bananas", category = "Produce", store = "Aldi", @checked = true, price = (decimal?)1.20m, estimate = (decimal?)null } },
                              status = "Shopping", total = 4.69m, estimatedTotal = 3.25m, savings = (decimal?)-0.24m },
                        // Planned list with estimates filled from averages, no prices yet.
                        new { name = (string?)"Weekly stock-up", date = "2026-08-09", budget = (decimal?)160m, stores = new[] { "Aldi" },
                              items = new object[]
                              { new { name = "Bananas", category = "Produce", store = "Aldi", @checked = false, price = (decimal?)null, estimate = (decimal?)1.205m } },
                              status = "planned", total = 0m, estimatedTotal = 1.21m, savings = (decimal?)null },
                    },
                },
            },
        };
        var logger = new ListLogger<SeedDataService>();

        (await new SeedDataService(_db, logger).SeedIfEmptyAsync(WriteSeed(seed))).Should().Be(SeedOutcome.Seeded);

        var shopping = await _db.Trips.SingleAsync(t => t.Date == "2026-08-01");
        shopping.Status.Should().Be(TripStatus.Shopping);
        shopping.CompletedAt.Should().BeNull();
        var lines = await _db.TripItems.Where(ti => ti.TripId == shopping.Id).OrderBy(ti => ti.SortOrder).ToListAsync();
        lines.Select(ti => ti.EstimateCents).Should().Equal(325, null);
        lines.Select(ti => ti.PriceCents).Should().Equal(349, 120);

        var planned = await _db.Trips.SingleAsync(t => t.Name == "Weekly stock-up");
        planned.Status.Should().Be(TripStatus.Planned);
        // Same away-from-zero rounding as prices.
        (await _db.TripItems.SingleAsync(ti => ti.TripId == planned.Id)).EstimateCents.Should().Be(121);
        // Both totals agree with their lines, so nothing to warn about.
        logger.Warnings.Should().BeEmpty();
    }

    [Fact]
    public async Task SeedIfEmpty_V2FileWithoutStatus_InfersStatusFromLines()
    {
        var seed = new
        {
            version = 2,
            profiles = new[]
            {
                new
                {
                    name = "Mom",
                    trips = new object[]
                    {
                        new { name = (string?)null, date = "2026-08-01", budget = (decimal?)null, stores = new[] { "Aldi" }, items = new object[]
                            { new { name = "Whole Milk", category = "Dairy", store = "Aldi", @checked = true, price = (decimal?)3.49m } } },
                        new { name = (string?)"Half done", date = "2026-08-02", budget = (decimal?)null, stores = new[] { "Aldi" }, items = new object[]
                            { new { name = "Eggs", category = "Dairy", store = "Aldi", @checked = true, price = (decimal?)2.99m },
                              new { name = "Bread", category = "Bakery", store = "Aldi", @checked = false, price = (decimal?)null } } },
                        new { name = (string?)"Weekly stock-up", date = "2026-08-09", budget = (decimal?)160m, stores = new[] { "Aldi" }, items = new object[]
                            { new { name = "Bananas", category = "Produce", store = "Aldi", @checked = false, price = (decimal?)null } } },
                    },
                },
            },
        };

        await new SeedDataService(_db).SeedIfEmptyAsync(WriteSeed(seed));

        var done = await _db.Trips.SingleAsync(t => t.Date == "2026-08-01");
        done.Status.Should().Be(TripStatus.Done);
        done.CompletedAt.Should().Be(DateTimeOffset.Parse("2026-08-01T12:00:00Z"));
        (await _db.Trips.SingleAsync(t => t.Name == "Half done")).Status.Should().Be(TripStatus.Shopping);
        (await _db.Trips.SingleAsync(t => t.Name == "Weekly stock-up")).Status.Should().Be(TripStatus.Planned);
        _db.TripItems.Count(ti => ti.EstimateCents != null).Should().Be(0);
    }

    [Fact]
    public async Task SeedIfEmpty_UnknownStatusAndMismatchedTotal_FallsBackAndWarns()
    {
        var seed = new
        {
            version = 3,
            profiles = new[]
            {
                new
                {
                    name = "Mom",
                    trips = new object[]
                    {
                        new { name = (string?)null, date = "2026-08-01", budget = (decimal?)null, stores = new[] { "Aldi" },
                              items = new object[] { new { name = "Whole Milk", category = "Dairy", store = "Aldi", @checked = true, price = (decimal?)3.49m } },
                              status = "finished", total = 9.99m },
                    },
                },
            },
        };
        var logger = new ListLogger<SeedDataService>();

        await new SeedDataService(_db, logger).SeedIfEmptyAsync(WriteSeed(seed));

        (await _db.Trips.SingleAsync()).Status.Should().Be(TripStatus.Done);
        logger.Warnings.Should().ContainSingle();
    }

    [Fact]
    public async Task SeedIfEmpty_ResolvesItemsAndStoresCaseInsensitively()
    {
        await new SeedDataService(_db).SeedIfEmptyAsync(WriteSeed(SampleSeed()));

        // "Whole Milk" and "whole milk" are the same item, so price history joins up.
        _db.Items.Count(i => i.NormalizedName == "whole milk").Should().Be(1);
        // Bananas appears in a trip and a list without being duplicated.
        _db.Items.Count(i => i.NormalizedName == "bananas").Should().Be(1);
        _db.Stores.Select(s => s.Name).Should().BeEquivalentTo(["Aldi", "BJ's"]);
    }

    [Fact]
    public async Task SeedIfEmpty_OnDatabaseThatAlreadyHasData_DoesNothing()
    {
        var path = WriteSeed(SampleSeed());
        await new SeedDataService(_db).SeedIfEmptyAsync(path);

        // A second run must not duplicate anything — this is what protects a real
        // user's data when the app restarts.
        var outcome = await new SeedDataService(_db).SeedIfEmptyAsync(path);

        outcome.Should().Be(SeedOutcome.SkippedNotEmpty);
        _db.Profiles.Count().Should().Be(1);
        _db.Trips.Count().Should().Be(3);
    }

    [Fact]
    public async Task SeedIfEmpty_WithMissingFile_IsANoOp()
    {
        var outcome = await new SeedDataService(_db).SeedIfEmptyAsync(Path.Combine(_dir, "nope.json"));

        outcome.Should().Be(SeedOutcome.SkippedNoFile);
        _db.Profiles.Should().BeEmpty();
    }

    [Fact]
    public async Task ShippedSeedFile_IsValidAndLoads()
    {
        // Guards the actual artifact that ships with the app, not just a fixture.
        var path = Path.Combine(AppContext.BaseDirectory, "SeedData", "seed-data.json");
        if (!File.Exists(path)) return; // not copied in this build configuration

        var outcome = await new SeedDataService(_db).SeedIfEmptyAsync(path);

        outcome.Should().Be(SeedOutcome.Seeded);
        _db.Profiles.Should().ContainSingle().Which.Name.Should().Be("Mom");

        // One trip per week of the workbook, each with its own date and budget.
        var trips = await _db.Trips.Include(t => t.Stores).Include(t => t.Items).ThenInclude(i => i.Store).ToListAsync();
        trips.Count.Should().BeInRange(100, 200);
        trips.Select(t => t.Date).Distinct().Count().Should().Be(trips.Count);
        trips.Count(t => t.BudgetCents != null).Should().BeGreaterThan(100);
        _db.TripItems.Count().Should().BeGreaterThan(2000);
        _db.TripStores.Count().Should().BeGreaterThan(0);
        _db.TripItems.Count(ti => ti.CategoryId == Guid.Empty).Should().Be(0);
        // A price is never zero or negative.
        _db.TripItems.Count(ti => ti.PriceCents <= 0).Should().Be(0);

        // Statuses come from the sheet: upcoming weeks are plans, the rest are finished.
        trips.Should().NotContain(t => t.Status == TripStatus.Shopping);
        var planned = trips.Where(t => t.Status == TripStatus.Planned).ToList();
        planned.Should().NotBeEmpty();
        planned.SelectMany(t => t.Items).Should().OnlyContain(i => i.PriceCents == null && !i.Checked && i.EstimateCents != null);
        // A finished week's lines are priced (bought) or left unbought, never half-priced; an
        // estimate accompanies every listed line (only "Unlisted purchases" has none).
        var unbought = trips.Where(t => t.Status == TripStatus.Done && t.Items.All(i => i.PriceCents == null)).ToList();
        unbought.SelectMany(t => t.Items).Should().OnlyContain(i => !i.Checked);
        var listed = trips.SelectMany(t => t.Items).Where(i => i.Item!.Name != "Unlisted purchases");
        listed.Should().OnlyContain(i => i.EstimateCents != null);
        trips.Where(t => t.Status == TripStatus.Done).SelectMany(t => t.Items)
            .Where(i => i.PriceCents != null).Should().OnlyContain(i => i.Checked);

        // Each line's store is one of its trip's stores.
        foreach (var trip in trips)
        {
            var names = trip.Stores.Select(s => s.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            trip.Items.Where(i => i.Store != null).Should().OnlyContain(i => names.Contains(i.Store!.Name), $"trip {trip.Date}");
        }
        _db.Stores.Select(s => s.Name).Should().Contain(["Aldi", "BJ's", "Rt-17 Farmer's Market"]);
    }

    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<string> Warnings { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Warning) Warnings.Add(formatter(state, exception));
        }
    }
}
