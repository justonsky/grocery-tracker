namespace GroceryTracker.Core.Dtos;

// Which profile is "active" is deliberately NOT here — that's per-device state
// (see frontend useCurrentProfileId, localStorage-backed), not shared server
// config. It used to live here and caused every device to jump to whichever
// profile was most recently selected anywhere.
public record SettingsDto(string ThemeMode);

public record UpdateSettingsRequest(string? ThemeMode);
