namespace GroceryTracker.Core.Services;

// Thin clock abstraction so dashboard "today/month/year" bucketing is testable
// with a fixed instant instead of the real wall clock.
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

public class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
