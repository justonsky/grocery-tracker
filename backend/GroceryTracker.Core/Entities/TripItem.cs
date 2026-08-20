namespace GroceryTracker.Core.Entities;

public class TripItem
{
    public Guid Id { get; set; }
    public Guid TripId { get; set; }
    public Guid ItemId { get; set; }
    public Guid CategoryId { get; set; }
    // Which of the trip's stores this item is for; null = "any store".
    public Guid? StoreId { get; set; }
    // Whether the item has actually been picked up. Planned-but-unbought items
    // stay unchecked with a null price.
    public bool Checked { get; set; }
    // Null until the item is actually bought — a planned item has no price yet.
    public int? PriceCents { get; set; }
    public int SortOrder { get; set; }

    public Trip? Trip { get; set; }
    public Item? Item { get; set; }
    public Category? Category { get; set; }
    public Store? Store { get; set; }
}
