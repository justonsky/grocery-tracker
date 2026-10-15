namespace GroceryTracker.Core.Entities;

// Household-wide catalogue: "Milk" is one item whoever buys it, so its average
// price and history draw on every profile's purchases. Trips (and spend) stay
// per-profile.
public class Item
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public Guid? DefaultCategoryId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Category? DefaultCategory { get; set; }
}
