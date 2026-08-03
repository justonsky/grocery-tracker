namespace GroceryTracker.Core.Dtos;

public record CategoryDto(Guid Id, string Name, bool IsBuiltIn, int SortOrder);

public record CreateCategoryRequest(string Name);
