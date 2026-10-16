using System.Text.Json;
using System.Text.RegularExpressions;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public partial class SettingsService(GroceryTrackerDbContext db)
{
    private const string ThemeModeKey = "ThemeMode";
    private const string ChartSchemeKey = "ChartScheme";
    public static readonly string[] ChartSchemes = ["fresh", "citrus", "berry"];
    private const string GroupColorsKey = "GroupColors";
    private const int MaxGroupColors = 500;

    public async Task<SettingsDto> GetAsync(CancellationToken ct = default)
    {
        var settings = await db.AppSettings.ToDictionaryAsync(s => s.Key, s => s.Value, ct);
        var themeMode = settings.GetValueOrDefault(ThemeModeKey, "system");
        var groupColors = settings.TryGetValue(GroupColorsKey, out var json)
            ? JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? []
            : [];
        var chartScheme = settings.GetValueOrDefault(ChartSchemeKey, ChartSchemes[0]);
        return new SettingsDto(themeMode, groupColors, ChartSchemes.Contains(chartScheme) ? chartScheme : ChartSchemes[0]);
    }

    public async Task<SettingsDto> UpdateAsync(UpdateSettingsRequest request, CancellationToken ct = default)
    {
        if (request.ThemeMode is not null)
        {
            await UpsertAsync(ThemeModeKey, request.ThemeMode, ct);
        }
        if (request.ChartScheme is not null)
        {
            await UpsertAsync(ChartSchemeKey, request.ChartScheme, ct);
        }
        if (request.GroupColors is not null)
        {
            await UpsertAsync(GroupColorsKey, JsonSerializer.Serialize(request.GroupColors), ct);
        }
        await db.SaveChangesAsync(ct);
        return await GetAsync(ct);
    }

    // Keys are short "kind:slug" ids; values a hex color or "none".
    public static bool IsValidGroupColors(Dictionary<string, string>? colors) =>
        colors is null || (colors.Count <= MaxGroupColors
            && colors.All(c => GroupKeyPattern().IsMatch(c.Key) && (c.Value == "none" || HexColorPattern().IsMatch(c.Value))));

    [GeneratedRegex("^(store|category):[a-z0-9]{1,80}$")]
    private static partial Regex GroupKeyPattern();

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColorPattern();

    private async Task UpsertAsync(string key, string value, CancellationToken ct)
    {
        var existing = await db.AppSettings.FindAsync([key], ct);
        if (existing is null)
        {
            db.AppSettings.Add(new AppSetting { Key = key, Value = value });
        }
        else
        {
            existing.Value = value;
        }
    }
}
