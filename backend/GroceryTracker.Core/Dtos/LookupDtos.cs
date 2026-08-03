namespace GroceryTracker.Core.Dtos;

public record StoreDto(Guid Id, string Name);

public record ItemDto(Guid Id, string Name, Guid? DefaultCategoryId);
