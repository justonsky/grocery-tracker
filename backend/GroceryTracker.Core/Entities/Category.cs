namespace GroceryTracker.Core.Entities;

public class Category
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public bool IsBuiltIn { get; set; }
    public int SortOrder { get; set; }
}
