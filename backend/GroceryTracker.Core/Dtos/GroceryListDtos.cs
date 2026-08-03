namespace GroceryTracker.Core.Dtos;

public record ListItemDto(
    Guid Id, Guid ItemId, string ItemName, Guid CategoryId, string CategoryName,
    string? PreferredStoreName, bool Checked);

public record ListItemInput(string ItemName, Guid CategoryId, string? PreferredStoreName, bool Checked);

public record GroceryListDto(
    Guid Id, string Name, string? Date, List<string> Stores, List<ListItemDto> Items);

public record GroceryListInput(string Name, string? Date, List<string> Stores, List<ListItemInput> Items);
