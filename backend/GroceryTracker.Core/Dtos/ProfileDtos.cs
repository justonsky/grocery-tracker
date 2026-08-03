namespace GroceryTracker.Core.Dtos;

public record ProfileDto(Guid Id, string Name, DateTimeOffset CreatedAt, int TripCount);

public record CreateProfileRequest(string Name);
