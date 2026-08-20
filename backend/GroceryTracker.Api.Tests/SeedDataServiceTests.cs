using System.Text.Json;
using FluentAssertions;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

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
                name = "Juston",
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
        profile.Name.Should().Be("Juston");

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
        _db.Profiles.Should().ContainSingle();
        _db.Trips.Count().Should().BeGreaterThan(300);
        _db.TripItems.Count().Should().BeGreaterThan(2000);
        _db.Trips.Count(t => t.BudgetCents != null).Should().BeGreaterThan(0);
        // Every trip item must carry a real price and a known category.
        _db.TripItems.Count(ti => ti.PriceCents <= 0).Should().Be(0);
        _db.TripStores.Count().Should().BeGreaterThan(0);
        _db.TripItems.Count(ti => ti.CategoryId == Guid.Empty).Should().Be(0);
    }
}
