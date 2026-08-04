using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public class SettingsService(GroceryTrackerDbContext db)
{
    private const string ThemeModeKey = "ThemeMode";

    public async Task<SettingsDto> GetAsync(CancellationToken ct = default)
    {
        var settings = await db.AppSettings.ToDictionaryAsync(s => s.Key, s => s.Value, ct);
        var themeMode = settings.GetValueOrDefault(ThemeModeKey, "system");
        return new SettingsDto(themeMode);
    }

    public async Task<SettingsDto> UpdateAsync(UpdateSettingsRequest request, CancellationToken ct = default)
    {
        if (request.ThemeMode is not null)
        {
            await UpsertAsync(ThemeModeKey, request.ThemeMode, ct);
        }
        await db.SaveChangesAsync(ct);
        return await GetAsync(ct);
    }

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
