namespace GroceryTracker.Core.Dtos;

public record TripItemDto(Guid Id, Guid ItemId, string ItemName, Guid CategoryId, string CategoryName, decimal Price);

public record TripItemInput(string ItemName, Guid CategoryId, decimal Price);

public record TripDto(Guid Id, string Date, Guid StoreId, string StoreName, List<TripItemDto> Items, decimal Total);

public record TripInput(string Date, string StoreName, List<TripItemInput> Items);
