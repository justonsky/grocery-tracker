namespace GroceryTracker.Core.Entities;

public class TripItem
{
    public Guid Id { get; set; }
    public Guid TripId { get; set; }
    public Guid ItemId { get; set; }
    public Guid CategoryId { get; set; }
    public int PriceCents { get; set; }
    public int SortOrder { get; set; }

    public Trip? Trip { get; set; }
    public Item? Item { get; set; }
    public Category? Category { get; set; }
}
