namespace GroceryTracker.Core.Dtos;

// Price is null for an item that is planned but not yet bought; StoreName is null
// for "any store". PriceLocked is true once the edit window after the price was
// first recorded has passed — the whole line is read-only from then on, and
// PriceLocksAt says when that happens (null while there is no price).
public record TripItemDto(
    Guid Id, Guid ItemId, string ItemName, Guid CategoryId, string CategoryName,
    string? StoreName, bool Checked, decimal? Price,
    decimal? Estimate, DateTimeOffset? PriceLocksAt, bool PriceLocked);

// Id is the existing line's id when editing (from TripItemDto.Id) and null for a
// new line. It is how the server tells "changed this line" from "removed it and
// added another", which the price lock depends on. A line without an id is matched
// to an existing one by item name, so payloads queued by older clients still work.
public record TripItemInput(
    string ItemName, Guid CategoryId, string? StoreName, bool Checked, decimal? Price,
    decimal? Estimate = null, Guid? Id = null);

// Status is "planned", "shopping" or "done". EstimatedTotal sums the lines that
// have an estimate. Savings compares estimate against price on the lines that
// have both (positive = spent less than expected), and is null when none do.
public record TripDto(
    Guid Id, string? Name, string Date, decimal? Budget,
    List<string> Stores, List<TripItemDto> Items, decimal Total,
    string Status, DateTimeOffset? CompletedAt, decimal EstimatedTotal, decimal? Savings);

// A null Status keeps the trip's current status (or "planned" for a new trip).
public record TripInput(
    string? Name, string Date, decimal? Budget,
    List<string> Stores, List<TripItemInput> Items, string? Status = null);

// Total counts only items that have a price — a trip still being planned reads as $0.00.
public record TripSummaryDto(
    Guid Id, string? Name, string Date, List<string> Stores,
    int ItemCount, int CheckedCount, decimal Total, decimal? Budget,
    string Status, decimal EstimatedTotal, decimal? Savings);
