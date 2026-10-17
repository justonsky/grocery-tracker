using System.Text.RegularExpressions;

namespace GroceryTracker.Core.Services;

// How receipt lines and stores are compared. A printed item code (BJ's and Aldi print one) is a
// steadier key than the description, which stores abbreviate and reword.
public static partial class ReceiptKeys
{
    public static string KeyFor(string text, string? code)
    {
        var digits = code is null ? "" : DigitsOnly().Replace(code, "");
        return digits.Length >= 4 ? $"code:{digits}" : $"text:{NormalizeText(text)}";
    }

    // The printed item number a key was made from, if it was made from one.
    public static string? CodeOf(string key) => key.StartsWith("code:", StringComparison.Ordinal) ? key[5..] : null;

    // Lowercase letters and digits, single spaces, without a trailing price or tax flag.
    public static string NormalizeText(string text)
    {
        var t = TrailingPrice().Replace(text.ToLowerInvariant(), "");
        t = NotAlnum().Replace(t, " ");
        return Spaces().Replace(t, " ").Trim();
    }

    // "BJ's Wholesale Club" and "BJS" are the same store; so are "ALDI" and "Aldi".
    public static string StoreKey(string name) => NotAlnumNoSpace().Replace(name.ToLowerInvariant(), "");

    [GeneratedRegex(@"\D")] private static partial Regex DigitsOnly();
    [GeneratedRegex(@"\s+-?\$?\d+\.\d{2}-?\s*[a-z]{0,2}\s*$")] private static partial Regex TrailingPrice();
    [GeneratedRegex(@"[^a-z0-9]+")] private static partial Regex NotAlnum();
    [GeneratedRegex(@"[^a-z0-9]")] private static partial Regex NotAlnumNoSpace();
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
}
