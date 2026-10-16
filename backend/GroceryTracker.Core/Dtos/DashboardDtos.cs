namespace GroceryTracker.Core.Dtos;

// Price is null for an item on the trip that hasn't been bought (yet).
public record TripLineDto(string ItemName, string CategoryName, decimal? Price);

public record RecentTripDto(Guid Id, string? Name, string Date, string StoreName, int ItemCount, decimal Total, List<TripLineDto> Items);

// Prices are household-wide (every profile's purchases), matching the item page.
// LastPrice is null for a pinned item nobody has bought yet.
public record TrackedItemDto(
    Guid ItemId, string ItemName, string CategoryName, decimal? LastPrice,
    List<decimal> RecentPrices, string Trend, decimal? DeltaFromPrevious, string PriceUnit = "each");

// One calendar month of the spend chart (Month is "yyyy-MM").
public record MonthlySpendDto(string Month, decimal Total, int Count);

// MonthBudget is the sum of the budgets set on this month's trips (null when none has one);
// MonthBudgetSpent is what those same trips cost, so budget minus spent is the money left.
// MonthlySpend covers the last 12 calendar months, oldest first, empty months as zero.
// TrackedItemsCustomized: false while the grid follows recent purchases
// automatically, true once the profile has added or removed items.
public record DashboardSummaryDto(
    decimal TodaySpend, int TodayCount,
    decimal MonthSpend, int MonthCount,
    decimal YearSpend, int YearCount,
    RecentTripDto? RecentTrip,
    List<TrackedItemDto> TrackedItems,
    bool TrackedItemsCustomized,
    decimal? MonthBudget,
    decimal MonthBudgetSpent,
    List<MonthlySpendDto> MonthlySpend);

// The whole grid, in order. Null puts it back on automatic (most recent items).
public record SetTrackedItemsRequest(List<Guid>? ItemIds);
