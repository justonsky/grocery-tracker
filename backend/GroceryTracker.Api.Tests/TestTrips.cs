using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Most tests describe the shape a trip used to have: one store, everything bought.
// A trip now also carries a name, a budget, a store list and per-item picked-up/price
// state, so these helpers keep those tests reading the way they always did.
internal static class TestTrips
{
    // A completed shop at a single store. Items default to that store.
    public static TripInput At(string date, string store, params TripItemInput[] items) =>
        new(null, date, null, [store],
            items.Select(i => i.StoreName is null ? i with { StoreName = store } : i).ToList());

    public static TripItemInput Bought(string name, Guid categoryId, decimal price) =>
        new(name, categoryId, null, true, price);

    // Planned but not bought yet: no price, not ticked off.
    public static TripItemInput Planned(string name, Guid categoryId, string? store = null) =>
        new(name, categoryId, store, false, null);
}
