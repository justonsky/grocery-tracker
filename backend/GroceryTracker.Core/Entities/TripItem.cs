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
    // What the shopper expects to pay, typed freely or filled from the item's
    // average price. Null = no estimate, and it doesn't count toward the trip's.
    public int? EstimateCents { get; set; }
    // Null until the item is actually bought — a planned item has no price yet.
    public int? PriceCents { get; set; }
    // Server-stamped when a price is first recorded. The line becomes read-only
    // once TripService.PriceEditWindow has passed since then, so price history
    // (and every average built from it) stops shifting under the user.
    public DateTimeOffset? PricedAt { get; set; }
    public int SortOrder { get; set; }

    public Trip? Trip { get; set; }
    public Item? Item { get; set; }
    public Category? Category { get; set; }
    public Store? Store { get; set; }
}
