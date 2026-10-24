using System.Globalization;

namespace GroceryTracker.Core.Services;

// Shared limits for what clients send: money, dates and names. Every service that stores an
// amount goes through ToCents, so a value too big for the int cents columns is refused with a
// 400 up front instead of overflowing into a 500 (which the offline outbox would keep retrying).
public static class Amounts
{
    public const decimal MaxAmount = 1_000_000m;
    public const int NameLength = 200;
    public const string Invalid = "Amounts must be at most $1,000,000.";

    // A blank or negative amount means "not known yet", not zero.
    public static bool IsValid(decimal? amount) => amount is null or < 0 || amount <= MaxAmount;

    public static int? ToCents(decimal? amount) =>
        amount is null or < 0 ? null : (int)Math.Round(Math.Min(amount.Value, MaxAmount) * 100m, MidpointRounding.AwayFromZero);

    // Trip dates are the shopper's local calendar date, "yyyy-MM-dd"; month and year math slices them.
    public static bool IsValidDate(string? date) =>
        date is { Length: 10 } && DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    public static bool IsValidName(string? name) => !string.IsNullOrWhiteSpace(name) && name.Trim().Length <= NameLength;
    public static bool IsValidOptionalName(string? name) => name is null || name.Trim().Length <= NameLength;
}
