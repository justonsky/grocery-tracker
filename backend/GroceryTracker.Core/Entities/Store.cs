namespace GroceryTracker.Core.Entities;

// Household-wide, like Item: every profile shops at the same stores, so there is
// one list to autocomplete from.
public class Store
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
