namespace GroceryTracker.Core.Dtos;

public record TripLineDto(string ItemName, string CategoryName, decimal Price);

public record RecentTripDto(Guid Id, string Date, string StoreName, int ItemCount, decimal Total, List<TripLineDto> Items);

public record TrackedItemDto(
    Guid ItemId, string ItemName, string CategoryName, decimal LastPrice,
    List<decimal> RecentPrices, string Trend, decimal? DeltaFromPrevious);

public record DashboardSummaryDto(
    decimal TodaySpend, int TodayCount,
    decimal MonthSpend, int MonthCount,
    decimal YearSpend, int YearCount,
    RecentTripDto? RecentTrip,
    List<TrackedItemDto> TrackedItems);

public record TripSummaryDto(Guid Id, string Date, Guid StoreId, string StoreName, int ItemCount, decimal Total);
