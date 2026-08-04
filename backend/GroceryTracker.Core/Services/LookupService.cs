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

        // Check the change tracker before the DB: two references to the same
        // new name within one payload (e.g. trip items "Milk" and "milk")
        // both miss a DB-only lookup, since neither has been saved yet — the
        // second then violates the unique index at SaveChangesAsync. `.Local`
        // sees Added-but-unsaved entities, so the second reference resolves
        // to the first instead of trying to create a duplicate.
        var store = db.Stores.Local.FirstOrDefault(s => s.ProfileId == profileId && s.NormalizedName == normalized)
            ?? await db.Stores.FirstOrDefaultAsync(s => s.ProfileId == profileId && s.NormalizedName == normalized, ct);
        if (store is not null) return store;

        var created = new Store
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = trimmed,
            NormalizedName = normalized,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Stores.Add(created);
        return created;
    }

    public async Task<Item> ResolveItemAsync(Guid profileId, string name, Guid? defaultCategoryId, CancellationToken ct = default)
    {
        var trimmed = name.Trim();
        var normalized = NameNormalizer.Normalize(trimmed);

        // See ResolveStoreAsync — same same-payload-duplicate-name fix.
        var item = db.Items.Local.FirstOrDefault(i => i.ProfileId == profileId && i.NormalizedName == normalized)
            ?? await db.Items.FirstOrDefaultAsync(i => i.ProfileId == profileId && i.NormalizedName == normalized, ct);
        if (item is not null)
        {
            // Remember the most recently used category for this item name, for autocomplete UX.
            if (defaultCategoryId is not null && item.DefaultCategoryId != defaultCategoryId)
            {
                item.DefaultCategoryId = defaultCategoryId;
            }
            return item;
        }

        var created = new Item
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = trimmed,
            NormalizedName = normalized,
            DefaultCategoryId = defaultCategoryId,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Items.Add(created);
        return created;
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
