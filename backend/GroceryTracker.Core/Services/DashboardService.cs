using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
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
                t.Date,
                t.CreatedAt,
                StoreName = t.Store!.Name,
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
                recentTripRaw.Id, recentTripRaw.Date, recentTripRaw.StoreName, recentTripRaw.Items.Count,
                SumCents(recentTripRaw.Items.Select(i => i.PriceCents)),
                recentTripRaw.Items.Select(i => new TripLineDto(i.ItemName, i.CategoryName, i.PriceCents / 100m)).ToList());

        return new DashboardSummaryDto(
            SumCents(todayTrips.SelectMany(t => t.Items.Select(i => i.PriceCents))), todayTrips.Count,
            SumCents(monthTrips.SelectMany(t => t.Items.Select(i => i.PriceCents))), monthTrips.Count,
            SumCents(yearTrips.SelectMany(t => t.Items.Select(i => i.PriceCents))), yearTrips.Count,
            recentTrip,
            await BuildTrackedItemsAsync(profileId, ct));
    }

    private static decimal SumCents(IEnumerable<int> cents) => cents.Sum() / 100m;

    private async Task<List<TrackedItemDto>> BuildTrackedItemsAsync(Guid profileId, CancellationToken ct)
    {
        var purchases = await db.TripItems
            .Where(ti => ti.Trip!.ProfileId == profileId)
            .Select(ti => new
            {
                ti.ItemId,
                ItemName = ti.Item!.Name,
                CategoryName = ti.Category!.Name,
                ti.PriceCents,
                Date = ti.Trip!.Date,
            })
            .ToListAsync(ct);

        return purchases
            .GroupBy(p => p.ItemId)
            .Select(g =>
            {
                var ordered = g.OrderBy(p => p.Date, StringComparer.Ordinal).ToList();
                var last = ordered[^1];
                var recentPrices = ordered.TakeLast(SparklinePoints).Select(p => p.PriceCents / 100m).ToList();
                decimal? delta = ordered.Count >= 2 ? (ordered[^1].PriceCents - ordered[^2].PriceCents) / 100m : null;
                var trend = delta switch { > 0 => "up", < 0 => "down", _ => "flat" };
                var dto = new TrackedItemDto(g.Key, last.ItemName, last.CategoryName, last.PriceCents / 100m, recentPrices, trend, delta);
                return (SortDate: last.Date, Dto: dto);
            })
            .OrderByDescending(x => x.SortDate, StringComparer.Ordinal)
            .Take(TrackedItemCount)
            .Select(x => x.Dto)
            .ToList();
    }
}
