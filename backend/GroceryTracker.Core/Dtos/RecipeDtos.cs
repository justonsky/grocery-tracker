namespace GroceryTracker.Core.Dtos;

// AveragePrice is the household average paid for the item (null if never bought).
public record RecipeItemDto(Guid ItemId, string ItemName, Guid? CategoryId, string CategoryName, string? Amount, decimal? AveragePrice, string PriceUnit = "each");

// PhotoVersion 0 = no photo; otherwise the photo is at /api/v1/recipes/{id}/photo?v={PhotoVersion}.
// TripCount / LastPlanned: on how many trips the recipe was planned, and the latest such date.
public record RecipeDto(
    Guid Id, string Name, string? Description, int PhotoVersion,
    List<RecipeItemDto> Items, decimal? EstimatedCost, int TripCount, string? LastPlanned);

// Items are matched by name (new names create household items, which then get CategoryId as their default).
public record RecipeItemInput(string ItemName, Guid? CategoryId = null, string? Amount = null);

public record RecipeInput(string Name, string? Description, List<RecipeItemInput> Items);

// A meal planned on a trip. PhotoVersion 0 = no photo.
public record TripRecipeDto(Guid Id, string Name, int PhotoVersion, int ItemCount);

// Recipe standings for the Trends page: trips the recipe was planned on in the period.
public record TrendRecipeDto(Guid RecipeId, string Name, int PhotoVersion, int TimesPlanned, string LastPlanned);
public record QuietRecipeDto(Guid RecipeId, string Name, int PhotoVersion, int EarlierCount, string LastPlanned, int WeeksSince);
