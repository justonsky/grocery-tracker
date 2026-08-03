namespace GroceryTracker.Core.Dtos;

public record SettingsDto(string ThemeMode, Guid? CurrentProfileId);

public record UpdateSettingsRequest(string? ThemeMode, Guid? CurrentProfileId);
