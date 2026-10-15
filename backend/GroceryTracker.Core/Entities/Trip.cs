namespace GroceryTracker.Core.Entities;

// A trip is the single record of a shopping run — used both as a plan written
// beforehand (items unchecked, prices blank) and as the log of what was actually
// bought (items checked off, prices filled in). Grocery lists used to be a
// separate entity; they are the same thing at an earlier point in time, and
// Status says which point that is.
public class Trip
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    // Optional label ("Weekly stock-up"). Falls back to the date in the UI.
    public string? Name { get; set; }
    public required string Date { get; set; } // ISO-8601 date, YYYY-MM-DD
    // Optional overall grocery budget for this trip, in cents.
    public int? BudgetCents { get; set; }
    public TripStatus Status { get; set; } = TripStatus.Planned;
    // Server-stamped the first time the trip is marked Done; cleared on reopen.
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Profile? Profile { get; set; }
    public List<TripStore> Stores { get; set; } = [];
    public List<TripItem> Items { get; set; } = [];
}

// Planned: a shopping list, nothing bought yet. Shopping: in the store, ticking
// things off. Done: the shop is over and the record is history.
public enum TripStatus { Planned, Shopping, Done }
