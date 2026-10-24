using System.Globalization;

namespace GroceryTracker.Core.Services;

// Trip dates are the shopper's local calendar date. Screens that ask about "today" send theirs
// (?today=yyyy-MM-dd); without a readable one the server's own local date stands in, never UTC,
// which is already tomorrow on a US evening.
public static class LocalDate
{
    public static DateOnly Resolve(string? today, IClock clock) =>
        Amounts.IsValidDate(today)
            ? DateOnly.ParseExact(today!, "yyyy-MM-dd", CultureInfo.InvariantCulture)
            : DateOnly.FromDateTime(clock.UtcNow.ToLocalTime().DateTime);
}
