namespace GroceryTracker.Core.Entities;

// Shared by the schema, validation and the photo upload. The photo limits are what
// the in-app crop editor targets: a larger photo has to be cropped down first.
public static class RecipeLimits
{
    public const int NameLength = 120;
    public const int DescriptionLength = 2000;
    public const int AmountLength = 40;
    public const int MaxItems = 100;

    public const int PhotoMaxBytes = 5 * 1024 * 1024;
    public const int PhotoMaxWidth = 1600;
    public const int PhotoMaxHeight = 1600;
}
