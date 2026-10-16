namespace GroceryTracker.Core.Services;

// How much of an item a trip line bought. Stored as thousandths (QuantityMilli: 750 = 0.75)
// so SQLite keeps it exact, with a unit: "each" (a count) or a weight. A line's price is
// always what the whole line cost; per-unit prices are derived here, for averages and charts.
// Weights are compared per pound (the stores this household uses price by the pound), so
// 12 oz and 0.75 lb are the same amount. A count and a weight can't be compared, so an
// item's price history uses whichever of the two most of its purchases were in.
public static class Quantities
{
    public const string Each = "each";
    public const string Pound = "lb";
    public const int OneMilli = 1000;
    public const decimal MaxQuantity = 9999m;

    private static readonly Dictionary<string, double> GramsPerUnit = new()
    {
        ["lb"] = 453.59237, ["oz"] = 28.349523125, ["kg"] = 1000, ["g"] = 1,
    };

    public static readonly string[] Units = ["each", "lb", "oz", "kg", "g"];

    public static bool IsValidUnit(string? unit) => unit is null || Units.Contains(unit);
    public static bool IsWeight(string unit) => GramsPerUnit.ContainsKey(unit);

    public static int ToMilli(decimal quantity) => (int)Math.Round(quantity * 1000m, MidpointRounding.AwayFromZero);
    public static decimal FromMilli(int milli) => milli / 1000m;
    public static bool IsValidQuantity(decimal? quantity) => quantity is null || (quantity > 0 && quantity <= MaxQuantity && ToMilli(quantity.Value) > 0);

    // "each" or "lb": what a per-unit price of this line is per.
    public static string PriceUnitOf(string unit) => IsWeight(unit) ? Pound : Each;

    // The line's price per item (counts) or per pound (weights), in cents.
    public static decimal UnitPriceCents(int priceCents, int quantityMilli, string unit)
    {
        var quantity = Math.Max(quantityMilli, 1) / 1000.0;
        var amount = IsWeight(unit) ? quantity * GramsPerUnit[unit] / GramsPerUnit[Pound] : quantity;
        return (decimal)(priceCents / amount);
    }

    public static decimal Dollars(decimal cents) => Math.Round(cents / 100m, 2, MidpointRounding.AwayFromZero);

    // The price unit most of these purchases were in (ties go to the most recent purchase).
    public static string DominantPriceUnit<T>(IReadOnlyList<T> purchasesOldestFirst, Func<T, string> unit)
    {
        if (purchasesOldestFirst.Count == 0) return Each;
        var weights = purchasesOldestFirst.Count(p => IsWeight(unit(p)));
        var counts = purchasesOldestFirst.Count - weights;
        if (weights != counts) return weights > counts ? Pound : Each;
        return PriceUnitOf(unit(purchasesOldestFirst[^1]));
    }

    public sealed record Purchase(int PriceCents, int QuantityMilli, string Unit, string Date, DateTimeOffset CreatedAt);

    // An item's purchases, oldest first, reduced to the ones in its dominant price unit, with
    // their per-unit prices (cents). Everything that averages or charts prices goes through this.
    public static (string PriceUnit, List<(Purchase Purchase, decimal UnitCents)> Points, int Other) Summarize(IEnumerable<Purchase> purchases)
    {
        var ordered = purchases.OrderBy(p => p.Date, StringComparer.Ordinal).ThenBy(p => p.CreatedAt).ToList();
        var priceUnit = DominantPriceUnit(ordered, p => p.Unit);
        var points = ordered.Where(p => PriceUnitOf(p.Unit) == priceUnit)
            .Select(p => (p, UnitPriceCents(p.PriceCents, p.QuantityMilli, p.Unit))).ToList();
        return (priceUnit, points, ordered.Count - points.Count);
    }
}
