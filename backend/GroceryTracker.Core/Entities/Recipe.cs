namespace GroceryTracker.Core.Entities;

// A meal the household makes, as the items it needs. Household-wide like Item and
// Store: every profile sees and edits the same recipes.
public class Recipe
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    // The photo lives on disk (RecipePhotoStore), not in the database. Version 0 = no
    // photo; it goes up with every upload so the photo URL changes and caches refresh.
    public int PhotoVersion { get; set; }
    public string? PhotoContentType { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public List<RecipeItem> Items { get; set; } = [];
}

// One ingredient of a recipe: a household Item, plus an optional free-text amount
// ("2 cups", "1 lb") that is for the cook only — trips don't use it.
public class RecipeItem
{
    public Guid Id { get; set; }
    public Guid RecipeId { get; set; }
    public Guid ItemId { get; set; }
    public string? Amount { get; set; }
    public int SortOrder { get; set; }

    public Recipe? Recipe { get; set; }
    public Item? Item { get; set; }
}

// A recipe planned on a trip ("Planned meals"). Its items are ordinary trip lines;
// this row only records that the meal is part of the plan.
public class TripRecipe
{
    public Guid TripId { get; set; }
    public Guid RecipeId { get; set; }
    public int SortOrder { get; set; }

    public Trip? Trip { get; set; }
    public Recipe? Recipe { get; set; }
}
