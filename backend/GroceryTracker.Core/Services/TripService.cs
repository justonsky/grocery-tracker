using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

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
                t.Date,
                t.StoreId,
                StoreName = t.Store!.Name,
                ItemCount = t.Items.Count,
                TotalCents = t.Items.Sum(i => (int?)i.PriceCents) ?? 0,
            })
            .ToListAsync(ct);

        return rows
            .Where(r => from is null || string.CompareOrdinal(r.Date, from) >= 0)
            .Where(r => to is null || string.CompareOrdinal(r.Date, to) <= 0)
            .OrderByDescending(r => r.Date)
            .Select(r => new TripSummaryDto(r.Id, r.Date, r.StoreId, r.StoreName, r.ItemCount, r.TotalCents / 100m))
            .ToList();
    }

    public async Task<TripDto?> GetAsync(Guid profileId, Guid tripId, CancellationToken ct = default)
    {
        var trip = await db.Trips
            .Include(t => t.Store)
            .Include(t => t.Items).ThenInclude(i => i.Item)
            .Include(t => t.Items).ThenInclude(i => i.Category)
            .FirstOrDefaultAsync(t => t.ProfileId == profileId && t.Id == tripId, ct);
        return trip is null ? null : ToDto(trip);
    }

    public async Task<TripDto> CreateAsync(Guid profileId, TripInput input, CancellationToken ct = default)
    {
        var store = await lookup.ResolveStoreAsync(profileId, input.StoreName, ct);
        var trip = new Trip
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Date = input.Date,
            StoreId = store.Id,
            Store = store,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        await ApplyItemsAsync(profileId, trip, input.Items, ct);

        db.Trips.Add(trip);
        await db.SaveChangesAsync(ct);
        return (await GetAsync(profileId, trip.Id, ct))!;
    }

    public async Task<TripDto?> UpdateAsync(Guid profileId, Guid tripId, TripInput input, CancellationToken ct = default)
    {
        var trip = await db.Trips
            .Include(t => t.Items)
            .FirstOrDefaultAsync(t => t.ProfileId == profileId && t.Id == tripId, ct);
        if (trip is null) return null;

        var store = await lookup.ResolveStoreAsync(profileId, input.StoreName, ct);
        trip.Date = input.Date;
        trip.StoreId = store.Id;

        db.TripItems.RemoveRange(trip.Items);
        trip.Items.Clear();
        await ApplyItemsAsync(profileId, trip, input.Items, ct);

        await db.SaveChangesAsync(ct);
        return await GetAsync(profileId, trip.Id, ct);
    }

    public async Task<bool> DeleteAsync(Guid profileId, Guid tripId, CancellationToken ct = default)
    {
        var trip = await db.Trips.FirstOrDefaultAsync(t => t.ProfileId == profileId && t.Id == tripId, ct);
        if (trip is null) return false;
        db.Trips.Remove(trip);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private async Task ApplyItemsAsync(Guid profileId, Trip trip, List<TripItemInput> items, CancellationToken ct)
    {
        var sortOrder = 0;
        foreach (var input in items)
        {
            var item = await lookup.ResolveItemAsync(profileId, input.ItemName, input.CategoryId, ct);
            trip.Items.Add(new TripItem
            {
                Id = Guid.NewGuid(),
                TripId = trip.Id,
                ItemId = item.Id,
                CategoryId = input.CategoryId,
                PriceCents = (int)Math.Round(input.Price * 100m, MidpointRounding.AwayFromZero),
                SortOrder = sortOrder++,
            });
        }
    }

    private static TripDto ToDto(Trip trip) => new(
        trip.Id, trip.Date, trip.StoreId, trip.Store!.Name,
        trip.Items.OrderBy(i => i.SortOrder).Select(i => new TripItemDto(
            i.Id, i.ItemId, i.Item!.Name, i.CategoryId, i.Category!.Name, i.PriceCents / 100m)).ToList(),
        trip.Items.Sum(i => i.PriceCents) / 100m);
}
