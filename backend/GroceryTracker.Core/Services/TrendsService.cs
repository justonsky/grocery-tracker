using System.Globalization;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// Shopping trends for one profile, computed on request from its priced lines.
//
// Cost: one indexed read (Trip ProfileId+Date) of just the columns used — a few thousand
// rows a year — then in-memory grouping. Nothing is stored or maintained, and nothing runs
// until the Trends page asks, so it adds no cost to normal use. Ten years of weekly
// shopping is tens of thousands of rows: still milliseconds.
public class TrendsService(GroceryTrackerDbContext db, IClock clock)
{
    public static readonly string[] Ranges = ["30d", "90d", "180d", "365d", "all"];

    private const int ListSize = 8;
    private const int MinTripsForTrends = 4;
    private const int MinEarlierPurchasesToFade = 3;
    private const int MinRecentPurchasesToRise = 2;
    private const double RisingFactor = 1.5;
    private const int MinEarlierPlansToFade = 2;

    // Money that isn't a grocery: the seed data keeps tax, tips and unlisted purchases as items so a
    // week's spend adds up. They count toward spend and categories, but not the item rankings.
    private static readonly HashSet<string> NotGroceries = new(["Unlisted purchases", "Tax", "Tip", "Driver Tip"], StringComparer.OrdinalIgnoreCase);

    private sealed record ItemStats(Guid Key, string Name, string Category, int All, int Recent, int Cents, decimal AverageUnitCents, string PriceUnit, string Last)
    {
        public int Earlier => All - Recent;
    }

    private sealed record Line(Guid TripId, string Date, DateTimeOffset CreatedAt, Guid ItemId, Guid CategoryId, int Cents, int QuantityMilli, string Unit);

    // today: the shopper's local date (see LocalDate), so a trip dated today is inside the period.
    public async Task<TrendsDto?> GetAsync(Guid profileId, string range, string? today = null, CancellationToken ct = default)
    {
        if (!await db.Profiles.AnyAsync(p => p.Id == profileId, ct)) return null;

        var to = LocalDate.Resolve(today, clock);
        DateOnly from;
        if (range == "all")
        {
            var first = await db.Trips.Where(t => t.ProfileId == profileId).MinAsync(t => t.Date, ct);
            from = first is null ? to : DateOnly.ParseExact(first, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (from > to) from = to;
        }
        else
        {
            from = to.AddDays(1 - int.Parse(range[..^1], CultureInfo.InvariantCulture));
        }

        var days = to.DayNumber - from.DayNumber + 1;
        var previousFrom = range == "all" ? (DateOnly?)null : from.AddDays(-days);
        var readFrom = previousFrom ?? from;

        var lines = (await db.TripItems
                .Where(ti => ti.Trip!.ProfileId == profileId && ti.PriceCents > 0
                    && string.Compare(ti.Trip.Date, Iso(readFrom)) >= 0 && string.Compare(ti.Trip.Date, Iso(to)) <= 0)
                .Select(ti => new Line(ti.TripId, ti.Trip!.Date, ti.Trip.CreatedAt, ti.ItemId, ti.CategoryId, ti.PriceCents!.Value, ti.QuantityMilli, ti.Unit))
                .ToListAsync(ct))
            .ToList();

        // Names are looked up once per item and category, not joined onto every line: the line
        // query stays a narrow index read however much history there is.
        var itemNames = await db.Items.ToDictionaryAsync(i => i.Id, i => i.Name, ct);
        var categoryNames = await db.Categories.ToDictionaryAsync(c => c.Id, c => c.Name, ct);

        var fromIso = Iso(from);
        var current = lines.Where(l => string.CompareOrdinal(l.Date, fromIso) >= 0).ToList();
        var previous = lines.Where(l => string.CompareOrdinal(l.Date, fromIso) < 0).ToList();

        // Recent window: the last third of the period (at least two weeks), the rest is "earlier".
        var recentDays = Math.Clamp((int)Math.Round(days / 3.0), 14, int.MaxValue);
        if (recentDays >= days) recentDays = Math.Max(1, days / 2);
        var earlierDays = days - recentDays;
        var recentFrom = to.AddDays(1 - recentDays);
        var recentIso = Iso(recentFrom);

        var byItem = current
            .Where(l => !NotGroceries.Contains(itemNames[l.ItemId]))
            .GroupBy(l => l.ItemId)
            .Select(g =>
            {
                var recent = g.Where(l => string.CompareOrdinal(l.Date, recentIso) >= 0).Select(l => l.TripId).Distinct().Count();
                var all = g.Select(l => l.TripId).Distinct().Count();
                var last = g.Max(l => l.Date)!;
                var cents = g.Sum(l => l.Cents);
                // Per item, or per pound for things bought by weight — the same average as everywhere else.
                var (priceUnit, points, _) = Quantities.Summarize(g.Select(l => new Quantities.Purchase(l.Cents, l.QuantityMilli, l.Unit, l.Date, l.CreatedAt)));
                var average = points.Count == 0 ? 0 : points.Average(p => p.UnitCents);
                return new ItemStats(g.Key, itemNames[g.Key], categoryNames[g.First().CategoryId], all, recent, cents, average, priceUnit, last);
            })
            .ToList();

        static TrendItemDto ToItem(ItemStats x) => new(x.Key, x.Name, x.Category, x.All, x.Cents / 100m, Quantities.Dollars(x.AverageUnitCents), x.Last, x.PriceUnit);

        var mostBought = byItem.OrderByDescending(x => x.All).ThenByDescending(x => x.Cents).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .Take(ListSize).Select(x => ToItem(x)).ToList();
        var biggestSpend = byItem.OrderByDescending(x => x.Cents).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .Take(ListSize).Select(x => ToItem(x)).ToList();

        var rising = new List<RisingItemDto>();
        var fading = new List<FadingItemDto>();
        if (earlierDays > 0)
        {
            rising = byItem
                .Where(x => x.Recent >= MinRecentPurchasesToRise)
                .Select(x =>
                {
                    var expected = x.Earlier * (double)recentDays / earlierDays;
                    double? factor = x.Earlier == 0 ? null : Math.Round(x.Recent / expected, 1);
                    return new { x, factor, Extra = x.Recent - expected };
                })
                .Where(r => r.factor is null || r.factor >= RisingFactor)
                .OrderByDescending(r => r.Extra).ThenBy(r => r.x.Name, StringComparer.OrdinalIgnoreCase)
                .Take(ListSize)
                .Select(r => new RisingItemDto(r.x.Key, r.x.Name, r.x.Category, r.x.Recent, r.x.Earlier, r.factor))
                .ToList();

            fading = byItem
                .Where(x => x.Recent == 0 && x.Earlier >= MinEarlierPurchasesToFade)
                .OrderByDescending(x => x.Earlier).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
                .Take(ListSize)
                .Select(x => new FadingItemDto(x.Key, x.Name, x.Category, x.Earlier, x.Last,
                    (to.DayNumber - DateOnly.ParseExact(x.Last, "yyyy-MM-dd", CultureInfo.InvariantCulture).DayNumber) / 7))
                .ToList();
        }

        var categories = current
            .GroupBy(l => categoryNames[l.CategoryId])
            .Select(g => new CategorySpendDto(g.Key, g.Sum(l => l.Cents) / 100m, g.Count()))
            .OrderByDescending(c => c.Spent).ThenBy(c => c.Category, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Planned meals: how many of the period's trips each recipe was on, split like the items.
        var plans = await db.TripRecipes
            .Where(tr => tr.Trip!.ProfileId == profileId
                && string.Compare(tr.Trip.Date, fromIso) >= 0 && string.Compare(tr.Trip.Date, Iso(to)) <= 0)
            .Select(tr => new { tr.RecipeId, tr.Trip!.Date, tr.Recipe!.Name, PhotoVersion = RecipeService.ShownPhotoVersion(tr.Recipe.PhotoVersion, tr.Recipe.PhotoContentType) })
            .ToListAsync(ct);
        var byRecipe = plans.GroupBy(p => p.RecipeId).Select(g =>
        {
            var recent = g.Count(p => string.CompareOrdinal(p.Date, recentIso) >= 0);
            return new { g.Key, g.First().Name, g.First().PhotoVersion, All = g.Count(), Recent = recent, Earlier = g.Count() - recent, Last = g.Max(p => p.Date)! };
        }).ToList();
        var popularRecipes = byRecipe.OrderByDescending(r => r.All).ThenByDescending(r => r.Last, StringComparer.Ordinal)
            .ThenBy(r => r.Name, StringComparer.OrdinalIgnoreCase).Take(ListSize)
            .Select(r => new TrendRecipeDto(r.Key, r.Name, r.PhotoVersion, r.All, r.Last)).ToList();
        var quietRecipes = earlierDays <= 0 ? [] : byRecipe.Where(r => r.Recent == 0 && r.Earlier >= MinEarlierPlansToFade)
            .OrderByDescending(r => r.Earlier).ThenBy(r => r.Name, StringComparer.OrdinalIgnoreCase).Take(ListSize)
            .Select(r => new QuietRecipeDto(r.Key, r.Name, r.PhotoVersion, r.Earlier, r.Last,
                (to.DayNumber - DateOnly.ParseExact(r.Last, "yyyy-MM-dd", CultureInfo.InvariantCulture).DayNumber) / 7)).ToList();

        var tripCount = current.Select(l => l.TripId).Distinct().Count();
        return new TrendsDto(
            range, fromIso, Iso(to), recentIso,
            tripCount, byItem.Count, current.Sum(l => l.Cents) / 100m,
            previousFrom is null ? null : previous.Select(l => l.TripId).Distinct().Count(),
            previousFrom is null ? null : previous.Sum(l => l.Cents) / 100m,
            tripCount >= MinTripsForTrends,
            mostBought, biggestSpend, rising, fading, categories, popularRecipes, quietRecipes);
    }

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
