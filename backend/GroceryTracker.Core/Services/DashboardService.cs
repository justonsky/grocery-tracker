using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public class DashboardService(GroceryTrackerDbContext db, IClock clock)
{
    private const int TrackedItemCount = 8;
    private const int SparklinePoints = 8;

    public async Task<DashboardSummaryDto> GetSummaryAsync(Guid profileId, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var todayIso = now.ToString("yyyy-MM-dd");
        var monthPrefix = now.ToString("yyyy-MM");
        var yearPrefix = now.ToString("yyyy");

        var trips = await db.Trips
            .Where(t => t.ProfileId == profileId)
            .Select(t => new
            {
                t.Id,
                t.Name,
                t.Date,
                t.CreatedAt,
                Stores = t.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
                Items = t.Items.Select(i => new { i.PriceCents, ItemName = i.Item!.Name, CategoryName = i.Category!.Name }).ToList(),
            })
            .ToListAsync(ct);

        var todayTrips = trips.Where(t => t.Date == todayIso).ToList();
        var monthTrips = trips.Where(t => t.Date.StartsWith(monthPrefix, StringComparison.Ordinal)).ToList();
        var yearTrips = trips.Where(t => t.Date.StartsWith(yearPrefix, StringComparison.Ordinal)).ToList();

        var recentTripRaw = trips
            .OrderByDescending(t => t.Date, StringComparer.Ordinal)
            .ThenByDescending(t => t.CreatedAt)
            .FirstOrDefault();

        RecentTripDto? recentTrip = recentTripRaw is null
            ? null
            : new RecentTripDto(
                recentTripRaw.Id, recentTripRaw.Name, recentTripRaw.Date,
                recentTripRaw.Stores.Count > 0 ? string.Join(", ", recentTripRaw.Stores) : "—",
                recentTripRaw.Items.Count,
                SumCents(recentTripRaw.Items.Select(i => i.PriceCents)),
                recentTripRaw.Items.Select(i => new TripLineDto(i.ItemName, i.CategoryName, i.PriceCents / 100m)).ToList());

        return new DashboardSummaryDto(
            SumCents(todayTrips.SelectMany(t => t.Items.Select(i => i.PriceCents))), todayTrips.Count,
            SumCents(monthTrips.SelectMany(t => t.Items.Select(i => i.PriceCents))), monthTrips.Count,
            SumCents(yearTrips.SelectMany(t => t.Items.Select(i => i.PriceCents))), yearTrips.Count,
            recentTrip,
            await GetTrackedItemsAsync(profileId, null, ct),
            await db.Profiles.Where(p => p.Id == profileId).Select(p => p.TrackedItemsCustomized).FirstOrDefaultAsync(ct));
    }

    // Items still being planned have no price yet and simply do not count toward spend.
    private static decimal SumCents(IEnumerable<int?> cents) => (cents.Sum() ?? 0) / 100m;

    // With a search: every item the household has bought whose name matches,
    // most recently bought first. Without: this profile's grid.
    public async Task<List<TrackedItemDto>> GetTrackedItemsAsync(Guid profileId, string? search = null, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = NameNormalizer.Normalize(search);
            var matches = await db.TripItems
                .Where(ti => ti.PriceCents != null && ti.PriceCents > 0 && ti.Item!.NormalizedName.Contains(normalizedSearch))
                .Select(ti => new { ti.ItemId, ti.Trip!.Date })
                .ToListAsync(ct);
            var ordered = matches
                .GroupBy(m => m.ItemId)
                .OrderByDescending(g => g.Max(m => m.Date), StringComparer.Ordinal)
                .Select(g => g.Key)
                .ToList();
            return await BuildTrackedItemsAsync(ordered, ct);
        }

        var (ids, _) = await ResolveGridAsync(profileId, ct);
        return await BuildTrackedItemsAsync(ids, ct);
    }

    // Replaces the grid wholesale (idempotent, so the offline outbox can replay
    // it). Unknown item ids — e.g. deleted in the Items portal meanwhile — are
    // dropped rather than failing the whole request. Null = back to automatic.
    public async Task<(bool ProfileFound, List<TrackedItemDto> Items)> SetTrackedItemsAsync(
        Guid profileId, List<Guid>? itemIds, CancellationToken ct = default)
    {
        var profile = await db.Profiles.Include(p => p.TrackedItems).FirstOrDefaultAsync(p => p.Id == profileId, ct);
        if (profile is null) return (false, []);

        db.TrackedItems.RemoveRange(profile.TrackedItems);
        profile.TrackedItems.Clear();
        profile.TrackedItemsCustomized = itemIds is not null;

        if (itemIds is not null)
        {
            var wanted = itemIds.Distinct().ToList();
            var existing = (await db.Items.Where(i => wanted.Contains(i.Id)).Select(i => i.Id).ToListAsync(ct)).ToHashSet();
            var order = 0;
            foreach (var itemId in wanted.Where(existing.Contains))
            {
                profile.TrackedItems.Add(new TrackedItem { ProfileId = profileId, ItemId = itemId, SortOrder = order++ });
            }
        }

        await db.SaveChangesAsync(ct);
        return (true, await GetTrackedItemsAsync(profileId, null, ct));
    }

    // A customized grid is exactly the pinned items. Otherwise it's the items this
    // profile bought most recently, topped up from the rest of the household so a
    // new profile doesn't start with an empty grid.
    private async Task<(List<Guid> Ids, bool Customized)> ResolveGridAsync(Guid profileId, CancellationToken ct)
    {
        var customized = await db.Profiles.Where(p => p.Id == profileId).Select(p => p.TrackedItemsCustomized).FirstOrDefaultAsync(ct);
        if (customized)
        {
            var pinned = await db.TrackedItems.Where(t => t.ProfileId == profileId)
                .OrderBy(t => t.SortOrder).Select(t => t.ItemId).ToListAsync(ct);
            return (pinned, true);
        }

        var purchases = await db.TripItems
            .Where(ti => ti.PriceCents != null && ti.PriceCents > 0)
            .Select(ti => new { ti.ItemId, ti.Trip!.ProfileId, ti.Trip!.Date, ti.Trip!.CreatedAt })
            .ToListAsync(ct);

        List<Guid> MostRecent(IEnumerable<(Guid ItemId, string Date, DateTimeOffset CreatedAt)> rows) => rows
            .GroupBy(r => r.ItemId)
            .Select(g => (ItemId: g.Key, Latest: g.OrderByDescending(r => r.Date, StringComparer.Ordinal).ThenByDescending(r => r.CreatedAt).First()))
            .OrderByDescending(x => x.Latest.Date, StringComparer.Ordinal)
            .ThenByDescending(x => x.Latest.CreatedAt)
            .Select(x => x.ItemId)
            .ToList();

        var own = MostRecent(purchases.Where(p => p.ProfileId == profileId).Select(p => (p.ItemId, p.Date, p.CreatedAt)));
        var household = MostRecent(purchases.Select(p => (p.ItemId, p.Date, p.CreatedAt)));
        return (own.Concat(household).Distinct().Take(TrackedItemCount).ToList(), false);
    }

    private async Task<List<TrackedItemDto>> BuildTrackedItemsAsync(List<Guid> itemIds, CancellationToken ct)
    {
        if (itemIds.Count == 0) return [];

        var items = await db.Items
            .Where(i => itemIds.Contains(i.Id))
            .Select(i => new { i.Id, i.Name, CategoryName = i.DefaultCategory != null ? i.DefaultCategory.Name : "Other" })
            .ToDictionaryAsync(i => i.Id, ct);

        var purchases = (await db.TripItems
                .Where(ti => itemIds.Contains(ti.ItemId) && ti.PriceCents != null && ti.PriceCents > 0)
                .Select(ti => new { ti.ItemId, ti.PriceCents, CategoryName = ti.Category!.Name, ti.Trip!.Date, ti.Trip!.CreatedAt })
                .ToListAsync(ct))
            .GroupBy(p => p.ItemId)
            .ToDictionary(g => g.Key, g => g.OrderBy(p => p.Date, StringComparer.Ordinal).ThenBy(p => p.CreatedAt).ToList());

        var result = new List<TrackedItemDto>(itemIds.Count);
        foreach (var id in itemIds)
        {
            if (!items.TryGetValue(id, out var item)) continue;
            if (!purchases.TryGetValue(id, out var ordered))
            {
                result.Add(new TrackedItemDto(id, item.Name, item.CategoryName, null, [], "flat", null));
                continue;
            }

            var last = ordered[^1];
            var recentPrices = ordered.TakeLast(SparklinePoints).Select(p => p.PriceCents!.Value / 100m).ToList();
            decimal? delta = ordered.Count >= 2 ? (ordered[^1].PriceCents!.Value - ordered[^2].PriceCents!.Value) / 100m : null;
            var trend = delta switch { > 0 => "up", < 0 => "down", _ => "flat" };
            result.Add(new TrackedItemDto(id, item.Name, last.CategoryName, last.PriceCents!.Value / 100m, recentPrices, trend, delta));
        }
        return result;
    }
}
