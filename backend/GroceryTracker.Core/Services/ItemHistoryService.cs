using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public class ItemHistoryService(GroceryTrackerDbContext db)
{
    public async Task<ItemHistoryDto?> GetAsync(Guid profileId, Guid itemId, CancellationToken ct = default)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == itemId && i.ProfileId == profileId, ct);
        if (item is null) return null;

        var purchases = await db.TripItems
            .Where(ti => ti.ItemId == itemId && ti.Trip!.ProfileId == profileId)
            .Select(ti => new
            {
                ti.PriceCents,
                Date = ti.Trip!.Date,
                StoreName = ti.Trip!.Store!.Name,
                CategoryName = ti.Category!.Name,
            })
            .ToListAsync(ct);

        if (purchases.Count == 0)
        {
            return new ItemHistoryDto(item.Id, item.Name, "Other", 0, 0, "", 0, "", 0, []);
        }

        var ordered = purchases.OrderBy(p => p.Date, StringComparer.Ordinal).ToList();

        var ascendingHistory = new List<PurchasePointDto>(ordered.Count);
        for (var i = 0; i < ordered.Count; i++)
        {
            var p = ordered[i];
            decimal? deltaFromPrevious = i > 0 ? (p.PriceCents - ordered[i - 1].PriceCents) / 100m : null;
            ascendingHistory.Add(new PurchasePointDto(p.Date, p.StoreName, p.PriceCents / 100m, deltaFromPrevious));
        }

        var lowest = ordered.MinBy(p => p.PriceCents)!;
        var highest = ordered.MaxBy(p => p.PriceCents)!;
        var current = ordered[^1];
        var average = ordered.Sum(p => p.PriceCents) / 100m / ordered.Count;

        return new ItemHistoryDto(
            item.Id, item.Name, current.CategoryName,
            current.PriceCents / 100m,
            lowest.PriceCents / 100m, $"{lowest.StoreName} · {lowest.Date}",
            highest.PriceCents / 100m, $"{highest.StoreName} · {highest.Date}",
            average,
            Enumerable.Reverse(ascendingHistory).ToList()); // most recent purchase first
    }
}
