namespace GroceryTracker.Core.Entities;

public class Trip
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    public required string Date { get; set; } // ISO-8601 date, YYYY-MM-DD
    public Guid StoreId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Profile? Profile { get; set; }
    public Store? Store { get; set; }
    public List<TripItem> Items { get; set; } = [];
}
