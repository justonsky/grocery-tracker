namespace GroceryTracker.Core.Entities;

public class Profile
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    // Color theme id (e.g. "ocean"). The list of themes lives in the frontend;
    // an id it doesn't recognize falls back to the default there.
    public string Theme { get; set; } = DefaultTheme;
    // False: the dashboard grid shows the most recently bought items. True: it
    // shows exactly the items in TrackedItems, in order (possibly none).
    public bool TrackedItemsCustomized { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<Trip> Trips { get; set; } = [];
    public List<TrackedItem> TrackedItems { get; set; } = [];

    public const string DefaultTheme = "fresh";
}
