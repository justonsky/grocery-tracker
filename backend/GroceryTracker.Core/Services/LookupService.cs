using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// "Soft normalization": Store/Item are first-class per-profile lookup tables, but
// callers only ever pass free text — this resolves an existing row by
// case-insensitive name or transparently creates one, so typing a new store/item
// name anywhere never feels more rigid than the original prototype's plain text fields.
public class LookupService(GroceryTrackerDbContext db)
{
    public async Task<Store> ResolveStoreAsync(Guid profileId, string name, CancellationToken ct = default)
    {
        var trimmed = name.Trim();
        var normalized = NameNormalizer.Normalize(trimmed);

        var existing = await db.Stores
            .FirstOrDefaultAsync(s => s.ProfileId == profileId && s.NormalizedName == normalized, ct);
        if (existing is not null) return existing;

        var store = new Store
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = trimmed,
            NormalizedName = normalized,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Stores.Add(store);
        return store;
    }

    public async Task<Item> ResolveItemAsync(Guid profileId, string name, Guid? defaultCategoryId, CancellationToken ct = default)
    {
        var trimmed = name.Trim();
        var normalized = NameNormalizer.Normalize(trimmed);

        var existing = await db.Items
            .FirstOrDefaultAsync(i => i.ProfileId == profileId && i.NormalizedName == normalized, ct);
        if (existing is not null)
        {
            // Remember the most recently used category for this item name, for autocomplete UX.
            if (defaultCategoryId is not null && existing.DefaultCategoryId != defaultCategoryId)
            {
                existing.DefaultCategoryId = defaultCategoryId;
            }
            return existing;
        }

        var item = new Item
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = trimmed,
            NormalizedName = normalized,
            DefaultCategoryId = defaultCategoryId,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Items.Add(item);
        return item;
    }

    public async Task<List<StoreDto>> SearchStoresAsync(Guid profileId, string? search, CancellationToken ct = default)
    {
        var query = db.Stores.Where(s => s.ProfileId == profileId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalized = NameNormalizer.Normalize(search);
            query = query.Where(s => s.NormalizedName.Contains(normalized));
        }
        return await query.OrderBy(s => s.Name)
            .Select(s => new StoreDto(s.Id, s.Name))
            .ToListAsync(ct);
    }

    public async Task<List<ItemDto>> SearchItemsAsync(Guid profileId, string? search, CancellationToken ct = default)
    {
        var query = db.Items.Where(i => i.ProfileId == profileId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalized = NameNormalizer.Normalize(search);
            query = query.Where(i => i.NormalizedName.Contains(normalized));
        }
        return await query.OrderBy(i => i.Name)
            .Select(i => new ItemDto(i.Id, i.Name, i.DefaultCategoryId))
            .ToListAsync(ct);
    }
}
