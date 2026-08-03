namespace GroceryTracker.Core.Dtos;

public record PurchasePointDto(string Date, string StoreName, decimal Price, decimal? DeltaFromPrevious);

public record ItemHistoryDto(
    Guid ItemId, string ItemName, string CategoryName,
    decimal Current,
    decimal Lowest, string LowestMeta,
    decimal Highest, string HighestMeta,
    decimal Average,
    List<PurchasePointDto> History);
