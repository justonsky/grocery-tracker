namespace GroceryTracker.Core.Entities;

public class ListItem
{
    public Guid Id { get; set; }
    public Guid ListId { get; set; }
    public Guid ItemId { get; set; }
    public Guid CategoryId { get; set; }
    public Guid? PreferredStoreId { get; set; } // null = "any store"
    public bool Checked { get; set; }
    public int SortOrder { get; set; }

    public GroceryList? List { get; set; }
    public Item? Item { get; set; }
    public Category? Category { get; set; }
    public Store? PreferredStore { get; set; }
}
