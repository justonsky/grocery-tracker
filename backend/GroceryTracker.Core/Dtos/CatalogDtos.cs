namespace GroceryTracker.Core.Dtos;

// The Items portal's view of the household catalogue. LineCount counts every trip
// line using the item (planned ones too); PurchaseCount only the priced ones.
public record CatalogItemDto(
    Guid Id, string Name, Guid? DefaultCategoryId, string CategoryName,
    int LineCount, int PurchaseCount, string? LastPurchased, decimal? AveragePrice);

public record SaveItemRequest(string Name, Guid? DefaultCategoryId);

// One trip line for an item. StoreName is the line's own store (null = "any
// store"); EffectiveStoreName falls back to the trip's first store, the same rule
// price history and merge-by-store use.
public record ItemLineDto(
    Guid Id, Guid TripId, string? TripName, string TripDate, string TripStatus,
    Guid ProfileId, string ProfileName,
    string? StoreName, string? EffectiveStoreName,
    bool Checked, decimal? Price, decimal? Estimate,
    bool PriceLocked, DateTimeOffset? PriceLocksAt);

// Adds or edits a purchase record. A blank price leaves the line planned.
// ConfirmLocked must be true to change a line whose price is locked — the trip
// editor can't, this is the deliberate correction path.
public record SaveItemLineRequest(Guid TripId, string? StoreName, decimal? Price, bool ConfirmLocked = false);

// Moves the source item's lines onto the target item. StoreName limits it to lines
// bought at that store (by EffectiveStoreName); null moves them all. The source is
// deleted once nothing references it, unless DeleteSourceIfEmpty is false.
public record MergeItemRequest(Guid TargetItemId, string? StoreName, bool DeleteSourceIfEmpty = true);

public record MergeResultDto(int Moved, bool SourceDeleted);

// Every trip in the household, for the portal's "which trip" pickers.
public record HouseholdTripDto(Guid Id, string? Name, string Date, string Status, Guid ProfileId, string ProfileName, List<string> Stores);
