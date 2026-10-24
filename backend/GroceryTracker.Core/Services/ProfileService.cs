using System.Text.RegularExpressions;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public partial class ProfileService(GroceryTrackerDbContext db)
{
    public async Task<List<ProfileDto>> ListAsync(CancellationToken ct = default)
    {
        // SQLite/EF Core can't translate ORDER BY on DateTimeOffset — sort in-memory
        // after fetching (profile counts are tiny, so this is cheap).
        var profiles = await db.Profiles
            .Select(p => new ProfileDto(p.Id, p.Name, p.CreatedAt, p.Trips.Count, p.Theme))
            .ToListAsync(ct);
        return profiles.OrderBy(p => p.CreatedAt).ToList();
    }

    public async Task<ProfileDto> CreateAsync(CreateProfileRequest request, CancellationToken ct = default)
    {
        var profile = new Profile
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Theme = request.Theme ?? Profile.DefaultTheme,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync(ct);
        return new ProfileDto(profile.Id, profile.Name, profile.CreatedAt, 0, profile.Theme);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var profile = await db.Profiles.FindAsync([id], ct);
        if (profile is null) return false;

        // Cascades to the profile's trips. Items and stores are household-wide and
        // stay, along with the price history other profiles built up.
        db.Profiles.Remove(profile);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // Idempotent create-or-rename, keyed by the caller-supplied id — lets the
    // offline outbox recreate a profile (e.g. after an orphaned-by-server-
    // delete recovery) with a single request, same id it always had.
    public Task<(ProfileUpsertResult Result, ProfileDto Profile)> UpsertAsync(
        Guid id, CreateProfileRequest request, CancellationToken ct = default) =>
        InsertRace.RetryOnceAsync(db, () => UpsertOnceAsync(id, request, ct));

    private async Task<(ProfileUpsertResult Result, ProfileDto Profile)> UpsertOnceAsync(
        Guid id, CreateProfileRequest request, CancellationToken ct)
    {
        var existing = await db.Profiles.FindAsync([id], ct);
        if (existing is null)
        {
            var profile = new Profile
            {
                Id = id, Name = request.Name.Trim(),
                Theme = request.Theme ?? Profile.DefaultTheme, CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Profiles.Add(profile);
            await db.SaveChangesAsync(ct);
            return (ProfileUpsertResult.Created, new ProfileDto(profile.Id, profile.Name, profile.CreatedAt, 0, profile.Theme));
        }

        existing.Name = request.Name.Trim();
        if (request.Theme is not null) existing.Theme = request.Theme;
        await db.SaveChangesAsync(ct);
        var tripCount = await db.Trips.CountAsync(t => t.ProfileId == id, ct);
        return (ProfileUpsertResult.Updated, new ProfileDto(existing.Id, existing.Name, existing.CreatedAt, tripCount, existing.Theme));
    }

    // Only the shape is checked here, not membership: the theme catalogue lives in
    // the frontend, which falls back to the default for an id it doesn't know.
    public static bool IsValidTheme(string? theme) => theme is null || ThemePattern().IsMatch(theme);

    [GeneratedRegex("^[a-z][a-z0-9-]{0,31}$")]
    private static partial Regex ThemePattern();
}

public enum ProfileUpsertResult { Created, Updated }
