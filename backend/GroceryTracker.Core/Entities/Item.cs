namespace GroceryTracker.Core.Entities;

public class Item
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public Guid? DefaultCategoryId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Profile? Profile { get; set; }
    public Category? DefaultCategory { get; set; }
}
