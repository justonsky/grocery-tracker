namespace GroceryTracker.Core.Entities;

// Trip-scoped, denormalized on purpose: the stores this trip covers, in the
// order they were added. The profile-wide Store lookup table still backs
// per-item store assignment and autocomplete.
public class TripStore
{
    public Guid Id { get; set; }
    public Guid TripId { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }

    public Trip? Trip { get; set; }
}
