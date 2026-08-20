namespace GroceryTracker.Core.Dtos;

public record StoreDto(Guid Id, string Name);

// LastPrice is the most recently paid price for this item on this profile, or null
// when it has never been bought — it backs the grocery list's estimated-cost summary.
public record ItemDto(Guid Id, string Name, Guid? DefaultCategoryId, decimal? LastPrice);
