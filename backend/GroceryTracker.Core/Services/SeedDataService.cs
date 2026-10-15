using System.Text.Json;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GroceryTracker.Core.Services;

// Loads the shipped seed-data.json (real grocery history exported from the
// household's spreadsheet) into an empty database. Deliberately no-ops the
// moment the database already has a profile, so it can never overwrite or
// duplicate a user's own data on a later start.
public class SeedDataService(GroceryTrackerDbContext db, ILogger<SeedDataService>? logger = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<SeedOutcome> SeedIfEmptyAsync(string filePath, CancellationToken ct = default)
    {
        if (await db.Profiles.AnyAsync(ct))
        {
            return SeedOutcome.SkippedNotEmpty;
        }
        if (!File.Exists(filePath))
        {
            logger?.LogInformation("Seed data file not found at {Path}; starting with an empty database.", filePath);
            return SeedOutcome.SkippedNoFile;
        }

        SeedFile? seed;
        await using (var stream = File.OpenRead(filePath))
        {
            seed = await JsonSerializer.DeserializeAsync<SeedFile>(stream, JsonOptions, ct);
        }
        if (seed?.Profiles is not { Count: > 0 })
        {
            return SeedOutcome.SkippedNoFile;
        }

        var categoriesByName = await db.Categories
            .ToDictionaryAsync(c => c.NormalizedName, c => c.Id, ct);
        var fallbackCategoryId = categoriesByName.TryGetValue("other", out var other)
            ? other
            : categoriesByName.Values.First();

        var now = DateTimeOffset.UtcNow;
        var trips = 0;
        var lines = 0;

        // Household-wide lookup tables, shared by every seeded profile and resolved
        // once up front rather than per row.
        var stores = new Dictionary<string, Store>(StringComparer.Ordinal);
        var items = new Dictionary<string, Item>(StringComparer.Ordinal);

        Store ResolveStore(string name)
        {
            var normalized = NameNormalizer.Normalize(name);
            if (stores.TryGetValue(normalized, out var existing)) return existing;
            var created = new Store { Id = Guid.NewGuid(), Name = name.Trim(), NormalizedName = normalized, CreatedAt = now };
            stores[normalized] = created;
            db.Stores.Add(created);
            return created;
        }

        Item ResolveItem(string name, Guid categoryId)
        {
            var normalized = NameNormalizer.Normalize(name);
            if (items.TryGetValue(normalized, out var existing))
            {
                // Mirrors LookupService: remember the most recently used category.
                existing.DefaultCategoryId = categoryId;
                return existing;
            }
            var created = new Item
            {
                Id = Guid.NewGuid(), Name = name.Trim(), NormalizedName = normalized,
                DefaultCategoryId = categoryId, CreatedAt = now,
            };
            items[normalized] = created;
            db.Items.Add(created);
            return created;
        }

        Guid CategoryId(string? name) =>
            name is not null && categoriesByName.TryGetValue(NameNormalizer.Normalize(name), out var id)
                ? id
                : fallbackCategoryId;

        foreach (var seedProfile in seed.Profiles)
        {
            var profile = new Profile { Id = Guid.NewGuid(), Name = seedProfile.Name, CreatedAt = now };
            db.Profiles.Add(profile);

            foreach (var seedTrip in seedProfile.Trips)
            {
                if (seedTrip.Items.Count == 0) continue;

                // Seeded history was bought on the trip's date, not today, so its
                // prices (and completion) are stamped then — and come in already locked.
                var shoppedAt = DateTimeOffset.TryParse($"{seedTrip.Date}T12:00:00Z", out var parsed) ? parsed : now;
                var settled = seedTrip.Items.Count(i => i.Checked || i.Price is not null);
                var status = settled == 0 ? TripStatus.Planned
                    : settled == seedTrip.Items.Count ? TripStatus.Done
                    : TripStatus.Shopping;

                var trip = new Trip
                {
                    Id = Guid.NewGuid(), ProfileId = profile.Id,
                    Name = string.IsNullOrWhiteSpace(seedTrip.Name) ? null : seedTrip.Name!.Trim(),
                    Date = seedTrip.Date,
                    BudgetCents = ToCents(seedTrip.Budget),
                    Status = status,
                    CompletedAt = status == TripStatus.Done ? shoppedAt : null,
                    // Ordering trips logged on the same day follows insertion order.
                    CreatedAt = now.AddMilliseconds(trips),
                };
                db.Trips.Add(trip);
                trips++;

                var storeOrder = 0;
                foreach (var storeName in seedTrip.Stores)
                {
                    if (string.IsNullOrWhiteSpace(storeName)) continue;
                    db.TripStores.Add(new TripStore
                    {
                        Id = Guid.NewGuid(), TripId = trip.Id,
                        Name = storeName.Trim(), SortOrder = storeOrder++,
                    });
                    ResolveStore(storeName); // keep the household store lookup populated
                }

                var order = 0;
                foreach (var line in seedTrip.Items)
                {
                    var categoryId = CategoryId(line.Category);
                    var priceCents = ToCents(line.Price);
                    db.TripItems.Add(new TripItem
                    {
                        Id = Guid.NewGuid(), TripId = trip.Id,
                        ItemId = ResolveItem(line.Name, categoryId).Id,
                        CategoryId = categoryId,
                        StoreId = string.IsNullOrWhiteSpace(line.Store) ? null : ResolveStore(line.Store!).Id,
                        Checked = line.Checked,
                        PriceCents = priceCents,
                        PricedAt = priceCents is null ? null : shoppedAt,
                        SortOrder = order++,
                    });
                    lines++;
                }
            }
        }

        await db.SaveChangesAsync(ct);
        logger?.LogInformation("Seeded {Trips} trips ({Lines} items) from {Path}.", trips, lines, filePath);
        return SeedOutcome.Seeded;
    }

    private sealed record SeedFile(int Version, string? Source, List<SeedProfile> Profiles);

    private static int? ToCents(decimal? amount) =>
        amount is null or < 0 ? null : (int)Math.Round(amount.Value * 100m, MidpointRounding.AwayFromZero);

    private sealed record SeedProfile(string Name, List<SeedTrip> Trips)
    {
        public List<SeedTrip> Trips { get; init; } = Trips ?? [];
    }

    private sealed record SeedTrip(string? Name, string Date, decimal? Budget, List<string> Stores, List<SeedTripItem> Items)
    {
        public List<string> Stores { get; init; } = Stores ?? [];
        public List<SeedTripItem> Items { get; init; } = Items ?? [];
    }

    private sealed record SeedTripItem(string Name, string? Category, string? Store, bool Checked, decimal? Price);
}

public enum SeedOutcome { Seeded, SkippedNotEmpty, SkippedNoFile }
