using System.Text.RegularExpressions;

namespace GroceryTracker.Core.Services;

// Scores how well a receipt's abbreviated description fits an item name ("Redcd Sodium Broth"
// against "Reduced Sodium Chicken Broth"). Run-together codes like "KFTEZMAC" are beyond it;
// those are left to the model (IReceiptReader.ChooseAsync) or to the user, once. A receipt word
// matches an item word exactly, as a prefix ("tomat" / "tomatoes"), or as an abbreviation (same
// first letter, letters in order: "redcd" / "reduced"). 1.0 = every word matched exactly.
public static partial class ItemNameMatcher
{
    private static readonly HashSet<string> Noise = ["lb", "lbs", "oz", "ct", "pk", "ea", "x", "lrw", "fa", "fb", "nb", "n", "t", "the", "and", "of"];

    public static double Score(string receiptText, string itemName)
    {
        var receipt = Words(receiptText);
        var item = Words(itemName);
        if (receipt.Count == 0 || item.Count == 0) return 0;

        double matched = 0;
        var used = new HashSet<int>();
        foreach (var word in receipt)
        {
            var best = 0.0;
            var bestAt = -1;
            for (var i = 0; i < item.Count; i++)
            {
                if (used.Contains(i)) continue;
                var s = WordScore(word, item[i]);
                if (s > best) (best, bestAt) = (s, i);
            }
            if (bestAt >= 0) used.Add(bestAt);
            matched += best;
        }
        // Penalise item words the receipt doesn't mention, but gently: receipts drop words.
        return matched / (receipt.Count + 0.5 * Math.Max(0, item.Count - used.Count));
    }

    private static double WordScore(string r, string i)
    {
        if (r == i) return 1;
        if (r.Length >= 3 && i.StartsWith(r, StringComparison.Ordinal)) return 0.85;
        if (i.Length >= 3 && r.StartsWith(i, StringComparison.Ordinal)) return 0.8;
        if (r.Length >= 3 && r[0] == i[0] && IsSubsequence(r, i)) return 0.7;
        return 0;
    }

    private static bool IsSubsequence(string small, string big)
    {
        var j = 0;
        foreach (var c in big)
        {
            if (j < small.Length && small[j] == c) j++;
        }
        return j == small.Length;
    }

    private static List<string> Words(string text) =>
        NotAlnum().Split(text.ToLowerInvariant())
            .Where(w => w.Length >= 2 && !Noise.Contains(w) && !AllDigits().IsMatch(w))
            .ToList();

    [GeneratedRegex(@"[^a-z0-9]+")] private static partial Regex NotAlnum();
    [GeneratedRegex(@"^\d+$")] private static partial Regex AllDigits();
}
