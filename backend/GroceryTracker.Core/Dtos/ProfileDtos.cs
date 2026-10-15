namespace GroceryTracker.Core.Dtos;

public record ProfileDto(Guid Id, string Name, DateTimeOffset CreatedAt, int TripCount, string Theme);

// Theme is optional: null keeps the profile's current theme (or the default for a
// new profile), so a plain rename never resets it.
public record CreateProfileRequest(string Name, string? Theme = null);
