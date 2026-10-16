using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public class ItemHistoryService(GroceryTrackerDbContext db)
{
    // Household-wide: every profile's purchases of the item, so the averages here
    // match the ones the trip editor fills estimates from. from/to (ISO dates,
    // inclusive) narrow the purchases every statistic is computed over.
    public async Task<ItemHistoryDto?> GetAsync(Guid itemId, string? from = null, string? to = null, CancellationToken ct = default, string? priceUnit = null)
    {
        var item = await db.Items
            .Where(i => i.Id == itemId)
            .Select(i => new { i.Id, i.Name, CategoryName = i.DefaultCategory != null ? i.DefaultCategory.Name : "Other" })
            .FirstOrDefaultAsync(ct);
        if (item is null) return null;

        // Only items that were actually bought have a price and belong in history —
        // a planned item on an upcoming trip is not a data point yet.
        var all = (await db.TripItems
                .Where(ti => ti.ItemId == itemId && ti.PriceCents != null && ti.PriceCents > 0)
                .Select(ti => new
                {
                    ti.Id,
                    ti.TripId,
                    ti.PriceCents,
                    ti.QuantityMilli,
                    ti.Unit,
                    Date = ti.Trip!.Date,
                    ti.Trip!.CreatedAt,
                    ProfileName = ti.Trip!.Profile!.Name,
                    ItemStoreName = ti.Store!.Name,
                    TripStoreName = ti.Trip!.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).FirstOrDefault(),
                    CategoryName = ti.Category!.Name,
                })
                .ToListAsync(ct))
            .OrderBy(x => x.Date, StringComparer.Ordinal).ThenBy(x => x.CreatedAt)
            .ToList();

        // Prices per item, or per pound for things bought by weight; purchases in the other kind of
        // unit can't be compared on the same chart, so they're counted, not plotted.
        var (dominant, _, _) = Quantities.Summarize(all.Select(p => new Quantities.Purchase(p.PriceCents!.Value, p.QuantityMilli, p.Unit, p.Date, p.CreatedAt)));
        // An item bought both ways can be viewed either way; by default, the way most purchases were.
        var available = all.GroupBy(p => Quantities.PriceUnitOf(p.Unit))
            .Select(g => new PriceUnitCountDto(g.Key, g.Count()))
            .OrderByDescending(u => u.PriceUnit == dominant).ToList();
        priceUnit = priceUnit is not null && available.Any(u => u.PriceUnit == priceUnit) ? priceUnit : dominant;
        var otherUnits = all.Count(p => Quantities.PriceUnitOf(p.Unit) != priceUnit);
        var comparable = all.Where(p => Quantities.PriceUnitOf(p.Unit) == priceUnit).ToList();
        var points = new List<(PurchasePointDto Point, decimal Cents, string CategoryName)>(comparable.Count);
        for (var i = 0; i < comparable.Count; i++)
        {
            var p = comparable[i];
            var cents = Quantities.UnitPriceCents(p.PriceCents!.Value, p.QuantityMilli, p.Unit);
            decimal? delta = i > 0 ? Quantities.Dollars(cents) - Quantities.Dollars(points[i - 1].Cents) : null;
            var store = p.ItemStoreName ?? p.TripStoreName ?? "—";
            points.Add((new PurchasePointDto(p.Date, store, Quantities.Dollars(cents), delta, p.Id, p.TripId, p.ProfileName,
                Quantities.FromMilli(p.QuantityMilli), p.Unit, p.PriceCents!.Value / 100m), cents, p.CategoryName));
        }

        var firstDate = all.Count > 0 ? all[0].Date : null;
        var lastDate = all.Count > 0 ? all[^1].Date : null;
        var inRange = points
            .Where(p => from is null || string.CompareOrdinal(p.Point.Date, from) >= 0)
            .Where(p => to is null || string.CompareOrdinal(p.Point.Date, to) <= 0)
            .ToList();

        if (inRange.Count == 0)
        {
            return new ItemHistoryDto(item.Id, item.Name, item.CategoryName, 0, 0, "", 0, "", 0, 0, 0, [],
                0, from, to, firstDate, lastDate, priceUnit, otherUnits, available);
        }

        var lowest = inRange.MinBy(p => p.Cents);
        var highest = inRange.MaxBy(p => p.Cents);
        var current = inRange[^1];
        var avgCents = inRange.Sum(p => p.Cents) / inRange.Count;

        decimal variance = 0m, variancePct = 0m;
        if (inRange.Count > 1)
        {
            variance = (decimal)Math.Sqrt(inRange.Sum(p => Math.Pow((double)(p.Cents - avgCents), 2)) / inRange.Count) / 100m;
            if (avgCents > 0m) variancePct = variance / (avgCents / 100m) * 100m;
        }

        return new ItemHistoryDto(
            item.Id, item.Name, current.CategoryName,
            Quantities.Dollars(current.Cents),
            Quantities.Dollars(lowest.Cents), $"{lowest.Point.StoreName} · {lowest.Point.Date}",
            Quantities.Dollars(highest.Cents), $"{highest.Point.StoreName} · {highest.Point.Date}",
            avgCents / 100m,
            variance, variancePct,
            Enumerable.Reverse(inRange).Select(p => p.Point).ToList(), // most recent purchase first
            inRange.Count, from, to, firstDate, lastDate, priceUnit, otherUnits, available);
    }
}
