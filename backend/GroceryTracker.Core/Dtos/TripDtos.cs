namespace GroceryTracker.Core.Dtos;

// Price is null for an item that is planned but not yet bought; StoreName is null
// for "any store".
public record TripItemDto(
    Guid Id, Guid ItemId, string ItemName, Guid CategoryId, string CategoryName,
    string? StoreName, bool Checked, decimal? Price);

public record TripItemInput(string ItemName, Guid CategoryId, string? StoreName, bool Checked, decimal? Price);

public record TripDto(
    Guid Id, string? Name, string Date, decimal? Budget,
    List<string> Stores, List<TripItemDto> Items, decimal Total);

public record TripInput(
    string? Name, string Date, decimal? Budget,
    List<string> Stores, List<TripItemInput> Items);

// Total counts only items that have a price — a trip still being planned reads as $0.00.
public record TripSummaryDto(
    Guid Id, string? Name, string Date, List<string> Stores,
    int ItemCount, int CheckedCount, decimal Total, decimal? Budget);
