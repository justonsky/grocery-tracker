namespace GroceryTracker.Core.Entities;

public class Profile
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    // Color theme id (e.g. "ocean"). The list of themes lives in the frontend;
    // an id it doesn't recognize falls back to the default there.
    public string Theme { get; set; } = DefaultTheme;
    public DateTimeOffset CreatedAt { get; set; }

    public List<Store> Stores { get; set; } = [];
    public List<Item> Items { get; set; } = [];
    public List<Trip> Trips { get; set; } = [];

    public const string DefaultTheme = "nocturne";
}
