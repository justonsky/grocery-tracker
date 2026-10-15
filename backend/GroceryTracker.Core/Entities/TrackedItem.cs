namespace GroceryTracker.Core.Entities;

// One item pinned to a profile's dashboard grid. Only used once the profile has
// customized its grid (Profile.TrackedItemsCustomized); until then the grid
// follows the most recently bought items automatically.
public class TrackedItem
{
    public Guid ProfileId { get; set; }
    public Guid ItemId { get; set; }
    public int SortOrder { get; set; }

    public Profile? Profile { get; set; }
    public Item? Item { get; set; }
}
