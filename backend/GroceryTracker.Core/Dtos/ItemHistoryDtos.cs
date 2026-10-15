namespace GroceryTracker.Core.Dtos;

// DeltaFromPrevious compares with the purchase before this one even when that one
// falls outside the selected range, so the first row in a range isn't blank.
public record PurchasePointDto(
    string Date, string StoreName, decimal Price, decimal? DeltaFromPrevious,
    Guid LineId, Guid TripId, string ProfileName);

// Every statistic covers only the purchases between From and To (inclusive, ISO
// dates; null = unbounded). FirstDate/LastDate span all of the item's purchases,
// whatever the range, so the UI can offer sensible bounds.
public record ItemHistoryDto(
    Guid ItemId, string ItemName, string CategoryName,
    decimal Current,
    decimal Lowest, string LowestMeta,
    decimal Highest, string HighestMeta,
    decimal Average,
    decimal Variance, decimal VariancePct,
    List<PurchasePointDto> History,
    int PurchaseCount, string? From, string? To, string? FirstDate, string? LastDate);
