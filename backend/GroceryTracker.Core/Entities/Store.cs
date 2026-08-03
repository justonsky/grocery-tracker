namespace GroceryTracker.Core.Entities;

public class Store
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Profile? Profile { get; set; }
}
