namespace GroceryTracker.Core.Dtos;

// An item's standing in the period. TimesBought counts trips it was bought on (twice on
// one trip is once); Spent and AveragePrice use every priced line.
public record TrendItemDto(Guid ItemId, string Name, string Category, int TimesBought, decimal Spent, decimal AveragePrice, string LastBought);

// Bought more often lately than earlier in the period. Factor is how many times as often
// (recent rate / earlier rate), or null when it wasn't bought at all earlier ("new").
public record RisingItemDto(Guid ItemId, string Name, string Category, int RecentCount, int EarlierCount, double? Factor);

// A regular earlier in the period that hasn't been bought in the recent window.
public record FadingItemDto(Guid ItemId, string Name, string Category, int EarlierCount, string LastBought, int WeeksSince);

public record CategorySpendDto(string Category, decimal Spent, int Lines);

// From/To are inclusive dates; the recent window is RecentFrom..To and "earlier" is the rest.
// Previous* describe the equal-length period just before From (null for "all").
// EnoughData is false when too few trips fall in the period for the lists to mean much.
public record TrendsDto(
    string Range, string From, string To, string RecentFrom,
    int TripCount, int ItemCount, decimal Spent,
    int? PreviousTripCount, decimal? PreviousSpent,
    bool EnoughData,
    List<TrendItemDto> MostBought, List<TrendItemDto> BiggestSpend,
    List<RisingItemDto> Rising, List<FadingItemDto> Fading,
    List<CategorySpendDto> Categories);
