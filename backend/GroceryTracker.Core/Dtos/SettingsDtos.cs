namespace GroceryTracker.Core.Dtos;

// Which profile is "active" is deliberately NOT here — that's per-device state
// (see frontend useCurrentProfileId, localStorage-backed), not shared server
// config. It used to live here and caused every device to jump to whichever
// profile was most recently selected anywhere.
//
// GroupColors: background colors the user picked for the share card's groups,
// keyed like "store:aldi" or "category:produce" (frontend trips/shareGroups.ts).
// Values are "#rrggbb" or "none". Household-wide, so a shared list looks the same
// from every device.
//
// ChartScheme: which chart palette to use ("fresh", "citrus" or "berry"; frontend index.css).
public record SettingsDto(string ThemeMode, Dictionary<string, string> GroupColors, string ChartScheme);

// Null fields are left unchanged. GroupColors replaces the whole map.
public record UpdateSettingsRequest(string? ThemeMode, Dictionary<string, string>? GroupColors = null, string? ChartScheme = null);
