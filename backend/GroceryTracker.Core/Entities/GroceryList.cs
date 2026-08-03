namespace GroceryTracker.Core.Entities;

public class GroceryList
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    public required string Name { get; set; }
    public string? Date { get; set; } // ISO-8601 date, YYYY-MM-DD
    public DateTimeOffset CreatedAt { get; set; }

    public Profile? Profile { get; set; }
    public List<ListStore> Stores { get; set; } = [];
    public List<ListItem> Items { get; set; } = [];
}
