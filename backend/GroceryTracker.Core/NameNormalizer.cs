namespace GroceryTracker.Core;

public static class NameNormalizer
{
    public static string Normalize(string name) => name.Trim().ToLowerInvariant();
}
