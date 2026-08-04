using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public class ListService(GroceryTrackerDbContext db, LookupService lookup)
{
    public async Task<List<GroceryListDto>> ListAsync(Guid profileId, CancellationToken ct = default)
    {
        // SQLite/EF Core can't translate ORDER BY on DateTimeOffset — sort in-memory
        // after fetching (per-profile list counts are tiny).
        var lists = await LoadQuery(profileId).ToListAsync(ct);
        return lists.OrderByDescending(l => l.CreatedAt).Select(ToDto).ToList();
    }

    public async Task<GroceryListDto?> GetAsync(Guid profileId, Guid listId, CancellationToken ct = default)
    {
        var list = await LoadQuery(profileId).FirstOrDefaultAsync(l => l.Id == listId, ct);
        return list is null ? null : ToDto(list);
    }

    public async Task<GroceryListDto> CreateAsync(Guid profileId, GroceryListInput input, CancellationToken ct = default)
    {
        var list = new GroceryList
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = input.Name.Trim(),
            Date = input.Date,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        await ApplyStoresAndItemsAsync(profileId, list, input, ct);

        db.GroceryLists.Add(list);
        await db.SaveChangesAsync(ct);
        return (await GetAsync(profileId, list.Id, ct))!;
    }

    // Idempotent create-or-replace — see TripService.UpsertAsync for why.
    public async Task<(ListUpsertResult Result, GroceryListDto? List)> UpsertAsync(
        Guid profileId, Guid listId, GroceryListInput input, CancellationToken ct = default)
    {
        var profileExists = await db.Profiles.AnyAsync(p => p.Id == profileId, ct);
        if (!profileExists) return (ListUpsertResult.ProfileNotFound, null);

        var list = await db.GroceryLists
            .Include(l => l.Stores)
            .Include(l => l.Items)
            .FirstOrDefaultAsync(l => l.Id == listId, ct);
        if (list is not null && list.ProfileId != profileId)
        {
            return (ListUpsertResult.CrossProfile, null);
        }

        var isCreate = list is null;

        if (isCreate)
        {
            list = new GroceryList { Id = listId, ProfileId = profileId, Name = input.Name.Trim(), Date = input.Date, CreatedAt = DateTimeOffset.UtcNow };
            db.GroceryLists.Add(list);
        }
        else
        {
            list!.Name = input.Name.Trim();
            list.Date = input.Date;
            db.ListStores.RemoveRange(list.Stores);
            db.ListItems.RemoveRange(list.Items);
            list.Stores.Clear();
            list.Items.Clear();
        }

        await ApplyStoresAndItemsAsync(profileId, list, input, ct);
        await db.SaveChangesAsync(ct);

        var dto = await GetAsync(profileId, list.Id, ct);
        return (isCreate ? ListUpsertResult.Created : ListUpsertResult.Updated, dto);
    }

    public async Task<bool> DeleteAsync(Guid profileId, Guid listId, CancellationToken ct = default)
    {
        var list = await db.GroceryLists.FirstOrDefaultAsync(l => l.ProfileId == profileId && l.Id == listId, ct);
        if (list is null) return false;
        db.GroceryLists.Remove(list);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private IQueryable<GroceryList> LoadQuery(Guid profileId) => db.GroceryLists
        .Where(l => l.ProfileId == profileId)
        .Include(l => l.Stores)
        .Include(l => l.Items).ThenInclude(i => i.Item)
        .Include(l => l.Items).ThenInclude(i => i.Category)
        .Include(l => l.Items).ThenInclude(i => i.PreferredStore);

    private async Task ApplyStoresAndItemsAsync(Guid profileId, GroceryList list, GroceryListInput input, CancellationToken ct)
    {
        var storeOrder = 0;
        foreach (var storeName in input.Stores)
        {
            list.Stores.Add(new ListStore
            {
                Id = Guid.NewGuid(),
                ListId = list.Id,
                Name = storeName.Trim(),
                SortOrder = storeOrder++,
            });
        }

        var itemOrder = 0;
        foreach (var itemInput in input.Items)
        {
            var item = await lookup.ResolveItemAsync(profileId, itemInput.ItemName, itemInput.CategoryId, ct);
            Store? preferredStore = null;
            if (!string.IsNullOrWhiteSpace(itemInput.PreferredStoreName))
            {
                preferredStore = await lookup.ResolveStoreAsync(profileId, itemInput.PreferredStoreName, ct);
            }

            list.Items.Add(new ListItem
            {
                Id = Guid.NewGuid(),
                ListId = list.Id,
                ItemId = item.Id,
                CategoryId = itemInput.CategoryId,
                PreferredStoreId = preferredStore?.Id,
                Checked = itemInput.Checked,
                SortOrder = itemOrder++,
            });
        }
    }

    private static GroceryListDto ToDto(GroceryList list) => new(
        list.Id, list.Name, list.Date,
        list.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
        list.Items.OrderBy(i => i.SortOrder).Select(i => new ListItemDto(
            i.Id, i.ItemId, i.Item!.Name, i.CategoryId, i.Category!.Name,
            i.PreferredStore?.Name, i.Checked)).ToList());
}

public enum ListUpsertResult { Created, Updated, ProfileNotFound, CrossProfile }
