using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// Trips cover what used to be two things: a grocery list written before the shop
// and a trip logged after it. They are the same record at different stages, so
// there is one service, one editor and one table.
public class TripService(GroceryTrackerDbContext db, LookupService lookup)
{
    public async Task<List<TripSummaryDto>> ListAsync(Guid profileId, string? from, string? to, CancellationToken ct = default)
    {
        // ISO-8601 dates sort correctly lexicographically; per-profile trip counts are
        // small enough (years of shopping history) that filtering in-memory after the
        // indexed ProfileId fetch is simpler and just as fast as a translated range query.
        var rows = await db.Trips
            .Where(t => t.ProfileId == profileId)
            .Select(t => new
            {
                t.Id,
                t.Name,
                t.Date,
                t.BudgetCents,
                t.CreatedAt,
                Stores = t.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
                ItemCount = t.Items.Count,
                CheckedCount = t.Items.Count(i => i.Checked),
                TotalCents = t.Items.Sum(i => i.PriceCents) ?? 0,
            })
            .ToListAsync(ct);

        return rows
            .Where(r => from is null || string.CompareOrdinal(r.Date, from) >= 0)
            .Where(r => to is null || string.CompareOrdinal(r.Date, to) <= 0)
            .OrderByDescending(r => r.Date, StringComparer.Ordinal)
            .ThenByDescending(r => r.CreatedAt)
            .Select(r => new TripSummaryDto(
                r.Id, r.Name, r.Date, r.Stores, r.ItemCount, r.CheckedCount,
                r.TotalCents / 100m, r.BudgetCents / 100m))
            .ToList();
    }

    public async Task<TripDto?> GetAsync(Guid profileId, Guid tripId, CancellationToken ct = default)
    {
        var trip = await LoadQuery(profileId).FirstOrDefaultAsync(t => t.Id == tripId, ct);
        return trip is null ? null : ToDto(trip);
    }

    public async Task<TripDto> CreateAsync(Guid profileId, TripInput input, CancellationToken ct = default)
    {
        var trip = new Trip
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = Normalize(input.Name),
            Date = input.Date,
            BudgetCents = ToCents(input.Budget),
            CreatedAt = DateTimeOffset.UtcNow,
        };
        await ApplyStoresAndItemsAsync(profileId, trip, input, ct);

        db.Trips.Add(trip);
        await db.SaveChangesAsync(ct);
        return (await GetAsync(profileId, trip.Id, ct))!;
    }

    // Idempotent create-or-replace, keyed by the caller-supplied tripId rather
    // than a server-generated one — this is what lets the offline outbox
    // (client-generated GUIDs) safely re-send the same PUT if a reply is lost,
    // and lets an offline-created trip "just work" once it reaches the server,
    // with no separate reconciliation step.
    public async Task<(TripUpsertResult Result, TripDto? Trip)> UpsertAsync(
        Guid profileId, Guid tripId, TripInput input, CancellationToken ct = default)
    {
        var profileExists = await db.Profiles.AnyAsync(p => p.Id == profileId, ct);
        if (!profileExists) return (TripUpsertResult.ProfileNotFound, null);

        var trip = await db.Trips
            .Include(t => t.Stores)
            .Include(t => t.Items)
            .FirstOrDefaultAsync(t => t.Id == tripId, ct);
        if (trip is not null && trip.ProfileId != profileId)
        {
            return (TripUpsertResult.CrossProfile, null);
        }

        var isCreate = trip is null;

        if (isCreate)
        {
            trip = new Trip
            {
                Id = tripId, ProfileId = profileId,
                Name = Normalize(input.Name), Date = input.Date,
                BudgetCents = ToCents(input.Budget), CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Trips.Add(trip);
        }
        else
        {
            trip!.Name = Normalize(input.Name);
            trip.Date = input.Date;
            trip.BudgetCents = ToCents(input.Budget);
            db.TripStores.RemoveRange(trip.Stores);
            db.TripItems.RemoveRange(trip.Items);
            trip.Stores.Clear();
            trip.Items.Clear();
        }

        await ApplyStoresAndItemsAsync(profileId, trip, input, ct);
        await db.SaveChangesAsync(ct);

        var dto = await GetAsync(profileId, trip.Id, ct);
        return (isCreate ? TripUpsertResult.Created : TripUpsertResult.Updated, dto);
    }

    public async Task<bool> DeleteAsync(Guid profileId, Guid tripId, CancellationToken ct = default)
    {
        var trip = await db.Trips.FirstOrDefaultAsync(t => t.ProfileId == profileId && t.Id == tripId, ct);
        if (trip is null) return false;
        db.Trips.Remove(trip);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private IQueryable<Trip> LoadQuery(Guid profileId) => db.Trips
        .Where(t => t.ProfileId == profileId)
        .Include(t => t.Stores)
        .Include(t => t.Items).ThenInclude(i => i.Item)
        .Include(t => t.Items).ThenInclude(i => i.Category)
        .Include(t => t.Items).ThenInclude(i => i.Store);

    private async Task ApplyStoresAndItemsAsync(Guid profileId, Trip trip, TripInput input, CancellationToken ct)
    {
        var storeOrder = 0;
        foreach (var storeName in input.Stores)
        {
            if (string.IsNullOrWhiteSpace(storeName)) continue;
            trip.Stores.Add(new TripStore
            {
                Id = Guid.NewGuid(),
                TripId = trip.Id,
                Name = storeName.Trim(),
                SortOrder = storeOrder++,
            });
        }

        var itemOrder = 0;
        foreach (var itemInput in input.Items)
        {
            var item = await lookup.ResolveItemAsync(profileId, itemInput.ItemName, itemInput.CategoryId, ct);
            Store? store = null;
            if (!string.IsNullOrWhiteSpace(itemInput.StoreName))
            {
                store = await lookup.ResolveStoreAsync(profileId, itemInput.StoreName, ct);
            }

            trip.Items.Add(new TripItem
            {
                Id = Guid.NewGuid(),
                TripId = trip.Id,
                ItemId = item.Id,
                CategoryId = itemInput.CategoryId,
                StoreId = store?.Id,
                Checked = itemInput.Checked,
                PriceCents = ToCents(itemInput.Price),
                SortOrder = itemOrder++,
            });
        }
    }

    private static string? Normalize(string? name) =>
        string.IsNullOrWhiteSpace(name) ? null : name.Trim();

    // A blank or negative amount means "not known yet", not zero.
    private static int? ToCents(decimal? amount) =>
        amount is null or < 0 ? null : (int)Math.Round(amount.Value * 100m, MidpointRounding.AwayFromZero);

    private static TripDto ToDto(Trip trip) => new(
        trip.Id, trip.Name, trip.Date, trip.BudgetCents / 100m,
        trip.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
        trip.Items.OrderBy(i => i.SortOrder).Select(i => new TripItemDto(
            i.Id, i.ItemId, i.Item!.Name, i.CategoryId, i.Category!.Name,
            i.Store?.Name, i.Checked, i.PriceCents / 100m)).ToList(),
        (trip.Items.Sum(i => i.PriceCents) ?? 0) / 100m);
}

public enum TripUpsertResult { Created, Updated, ProfileNotFound, CrossProfile }
