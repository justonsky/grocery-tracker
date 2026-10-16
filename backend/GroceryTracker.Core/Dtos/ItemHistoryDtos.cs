namespace GroceryTracker.Core.Dtos;

// DeltaFromPrevious compares with the purchase before this one even when that one
// falls outside the selected range, so the first row in a range isn't blank.
// Price is per PriceUnit of the history (per item, or per pound); LineTotal is what the line cost.
public record PurchasePointDto(
    string Date, string StoreName, decimal Price, decimal? DeltaFromPrevious,
    Guid LineId, Guid TripId, string ProfileName,
    decimal Quantity = 1, string Unit = "each", decimal LineTotal = 0);

// Every statistic covers only the purchases between From and To (inclusive, ISO
// dates; null = unbounded). FirstDate/LastDate span all of the item's purchases,
// whatever the range, so the UI can offer sensible bounds.
// Prices are per PriceUnit: the one asked for, else the one most purchases were in. Purchases in
// the other kind of unit (counted vs weighed) can't be compared with these, so they're left out and
// counted in OtherUnitCount; AvailableUnits lists both kinds an item has, to switch between them.
public record ItemHistoryDto(
    Guid ItemId, string ItemName, string CategoryName,
    decimal Current,
    decimal Lowest, string LowestMeta,
    decimal Highest, string HighestMeta,
    decimal Average,
    decimal Variance, decimal VariancePct,
    List<PurchasePointDto> History,
    int PurchaseCount, string? From, string? To, string? FirstDate, string? LastDate,
    string PriceUnit = "each", int OtherUnitCount = 0,
    List<PriceUnitCountDto>? AvailableUnits = null);

// How many of an item's purchases (all time) can be shown per item ("each") or per pound ("lb").
public record PriceUnitCountDto(string PriceUnit, int Count);
