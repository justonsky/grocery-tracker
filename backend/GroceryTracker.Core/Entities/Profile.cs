namespace GroceryTracker.Core.Entities;

public class Profile
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<Store> Stores { get; set; } = [];
    public List<Item> Items { get; set; } = [];
    public List<Trip> Trips { get; set; } = [];
    public List<GroceryList> Lists { get; set; } = [];
}
