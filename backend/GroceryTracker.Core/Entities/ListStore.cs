namespace GroceryTracker.Core.Entities;

// List-scoped, denormalized on purpose: a store name attached to one grocery list's
// planning context, not the profile-wide Store lookup table used by Trips.
public class ListStore
{
    public Guid Id { get; set; }
    public Guid ListId { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }

    public GroceryList? List { get; set; }
}
