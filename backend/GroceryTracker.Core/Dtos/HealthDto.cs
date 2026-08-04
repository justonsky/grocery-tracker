namespace GroceryTracker.Core.Dtos;

public record HealthDto(string Service, Guid InstanceId, string AppVersion, DateTimeOffset ServerTime, string Status);
