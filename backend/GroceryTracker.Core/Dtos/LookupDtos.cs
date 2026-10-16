namespace GroceryTracker.Core.Dtos;

public record StoreDto(Guid Id, string Name);

// LastPrice is the most recently paid price and AveragePrice the mean of every
// recorded price for this item on this profile; both are null when it has never
// been bought. AveragePrice backs the trip editor's "fill estimates" button.
// LastPrice / AveragePrice are per PriceUnit: per item ("each") or per pound ("lb") for things
// bought by weight. Unit is the unit the item was last bought in (the editor's default).
public record ItemDto(Guid Id, string Name, Guid? DefaultCategoryId, decimal? LastPrice, decimal? AveragePrice,
    string PriceUnit = "each", string Unit = "each");
