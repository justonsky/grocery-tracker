using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public class ProfileService(GroceryTrackerDbContext db)
{
    public async Task<List<ProfileDto>> ListAsync(CancellationToken ct = default)
    {
        // SQLite/EF Core can't translate ORDER BY on DateTimeOffset — sort in-memory
        // after fetching (profile counts are tiny, so this is cheap).
        var profiles = await db.Profiles
            .Select(p => new ProfileDto(p.Id, p.Name, p.CreatedAt, p.Trips.Count))
            .ToListAsync(ct);
        return profiles.OrderBy(p => p.CreatedAt).ToList();
    }

    public async Task<ProfileDto> CreateAsync(CreateProfileRequest request, CancellationToken ct = default)
    {
        var profile = new Profile
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync(ct);
        return new ProfileDto(profile.Id, profile.Name, profile.CreatedAt, 0);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var profile = await db.Profiles.FindAsync([id], ct);
        if (profile is null) return false;

        db.Profiles.Remove(profile); // cascades Stores/Items/Trips/Lists via FK config
        await db.SaveChangesAsync(ct);
        return true;
    }
}
