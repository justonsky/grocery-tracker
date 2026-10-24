using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// Backs the Items portal: editing the household catalogue and the purchase
// records (trip lines) behind it. Unlike the trip editor, this can correct a
// locked price — but only when the caller says so explicitly.
public class ItemCatalogService(GroceryTrackerDbContext db, LookupService lookup, IClock clock)
{
    public Task<List<CatalogItemDto>> ListAsync(string? search, CancellationToken ct = default) => ListAsync(search, null, ct);

    private async Task<List<CatalogItemDto>> ListAsync(string? search, Guid? onlyId, CancellationToken ct)
    {
        IQueryable<Item> query = db.Items;
        if (onlyId is { } id) query = query.Where(i => i.Id == id);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalized = NameNormalizer.Normalize(search);
            query = query.Where(i => i.NormalizedName.Contains(normalized));
        }

        var items = await query
            .OrderBy(i => i.Name)
            .Select(i => new { i.Id, i.Name, i.DefaultCategoryId, CategoryName = i.DefaultCategory != null ? i.DefaultCategory.Name : "Other" })
            .ToListAsync(ct);
        var ids = items.Select(i => i.Id).ToList();
        var lines = (await db.TripItems
                .Where(ti => ids.Contains(ti.ItemId))
                .Select(ti => new { ti.ItemId, ti.PriceCents, ti.QuantityMilli, ti.Unit, ti.Trip!.Date, ti.Trip!.CreatedAt })
                .ToListAsync(ct))
            .GroupBy(l => l.ItemId)
            .ToDictionary(g => g.Key, g => g.ToList());

        return items.Select(i =>
        {
            var itemLines = lines.GetValueOrDefault(i.Id) ?? [];
            var bought = itemLines.Where(l => l.PriceCents is > 0).ToList();
            // Average per item, or per pound for things bought by weight.
            var (priceUnit, points, _) = Quantities.Summarize(bought.Select(l => new Quantities.Purchase(l.PriceCents!.Value, l.QuantityMilli, l.Unit, l.Date, l.CreatedAt)));
            return new CatalogItemDto(
                i.Id, i.Name, i.DefaultCategoryId, i.CategoryName,
                itemLines.Count, bought.Count,
                bought.Count == 0 ? null : bought.Max(l => l.Date),
                points.Count == 0 ? null : Quantities.Dollars(points.Average(p => p.UnitCents)),
                priceUnit);
        }).ToList();
    }

    public async Task<(CatalogResult Result, CatalogItemDto? Item)> CreateAsync(SaveItemRequest request, CancellationToken ct = default)
    {
        if (await ValidateAsync(null, request, ct) is { } invalid) return (invalid, null);

        var item = new Item
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            NormalizedName = NameNormalizer.Normalize(request.Name),
            DefaultCategoryId = request.DefaultCategoryId,
            CreatedAt = clock.UtcNow,
        };
        db.Items.Add(item);
        await db.SaveChangesAsync(ct);
        return (CatalogResult.Ok, await GetCatalogItemAsync(item.Id, ct));
    }

    public async Task<(CatalogResult Result, CatalogItemDto? Item)> UpdateAsync(Guid itemId, SaveItemRequest request, CancellationToken ct = default)
    {
        var item = await db.Items.FindAsync([itemId], ct);
        if (item is null) return (CatalogResult.ItemNotFound, null);
        if (await ValidateAsync(itemId, request, ct) is { } invalid) return (invalid, null);

        item.Name = request.Name.Trim();
        item.NormalizedName = NameNormalizer.Normalize(request.Name);
        item.DefaultCategoryId = request.DefaultCategoryId;
        await db.SaveChangesAsync(ct);
        return (CatalogResult.Ok, await GetCatalogItemAsync(itemId, ct));
    }

    // Removes the item and every trip line that uses it (FK cascade), price
    // history included, and unpins it from every dashboard. Locked purchases go
    // too, so — like correcting one — that needs the caller to confirm it.
    public async Task<CatalogResult> DeleteAsync(Guid itemId, bool confirmLocked, CancellationToken ct = default)
    {
        var item = await db.Items.FindAsync([itemId], ct);
        if (item is null) return CatalogResult.ItemNotFound;
        if (!confirmLocked)
        {
            // SQLite can't compare DateTimeOffsets in a query, so the lock check runs here.
            var pricedAt = await db.TripItems.Where(ti => ti.ItemId == itemId && ti.PricedAt != null).Select(ti => ti.PricedAt!.Value).ToListAsync(ct);
            var now = clock.UtcNow;
            if (pricedAt.Any(p => now - p > TripService.PriceEditWindow)) return CatalogResult.PriceLocked;
        }
        db.Items.Remove(item);
        await db.SaveChangesAsync(ct);
        return CatalogResult.Ok;
    }

    public async Task<List<ItemLineDto>?> GetLinesAsync(Guid itemId, CancellationToken ct = default)
    {
        if (!await db.Items.AnyAsync(i => i.Id == itemId, ct)) return null;
        var lines = await LineQuery().Where(ti => ti.ItemId == itemId).ToListAsync(ct);
        var now = clock.UtcNow;
        return lines
            .OrderByDescending(l => l.Trip!.Date, StringComparer.Ordinal)
            .ThenByDescending(l => l.Trip!.CreatedAt)
            .Select(l => ToLineDto(l, now))
            .ToList();
    }

    public async Task<(CatalogResult Result, ItemLineDto? Line)> AddLineAsync(Guid itemId, SaveItemLineRequest request, CancellationToken ct = default)
    {
        if (!Quantities.IsValidQuantity(request.Quantity) || !Quantities.IsValidUnit(request.Unit) || !Amounts.IsValid(request.Price)
            || !Amounts.IsValidOptionalName(request.StoreName)) return (CatalogResult.Invalid, null);
        var item = await db.Items.FindAsync([itemId], ct);
        if (item is null) return (CatalogResult.ItemNotFound, null);
        var trip = await db.Trips.Include(t => t.Stores).Include(t => t.Items).FirstOrDefaultAsync(t => t.Id == request.TripId, ct);
        if (trip is null) return (CatalogResult.TripNotFound, null);

        var now = clock.UtcNow;
        var priceCents = ToCents(request.Price);
        var line = new TripItem
        {
            Id = Guid.NewGuid(),
            TripId = trip.Id,
            ItemId = itemId,
            CategoryId = item.DefaultCategoryId ?? await OtherCategoryIdAsync(ct),
            Checked = priceCents is not null,
            PriceCents = priceCents,
            PricedAt = priceCents is null ? null : now,
            QuantityMilli = request.Quantity is { } quantity ? Quantities.ToMilli(quantity) : Quantities.OneMilli,
            Unit = request.Unit ?? Quantities.Each,
            SortOrder = trip.Items.Count == 0 ? 0 : trip.Items.Max(i => i.SortOrder) + 1,
        };
        await ApplyStoreAsync(line, trip, request.StoreName, ct);
        db.TripItems.Add(line);
        await db.SaveChangesAsync(ct);
        return (CatalogResult.Ok, await GetLineAsync(line.Id, ct));
    }

    public async Task<(CatalogResult Result, ItemLineDto? Line)> UpdateLineAsync(
        Guid itemId, Guid lineId, SaveItemLineRequest request, CancellationToken ct = default)
    {
        if (!Quantities.IsValidQuantity(request.Quantity) || !Quantities.IsValidUnit(request.Unit) || !Amounts.IsValid(request.Price)
            || !Amounts.IsValidOptionalName(request.StoreName)) return (CatalogResult.Invalid, null);
        var line = await db.TripItems.FirstOrDefaultAsync(ti => ti.Id == lineId && ti.ItemId == itemId, ct);
        if (line is null) return (CatalogResult.LineNotFound, null);
        var now = clock.UtcNow;
        if (IsLocked(line, now) && !request.ConfirmLocked) return (CatalogResult.PriceLocked, null);

        var trip = await db.Trips.Include(t => t.Stores).Include(t => t.Items).FirstOrDefaultAsync(t => t.Id == request.TripId, ct);
        if (trip is null) return (CatalogResult.TripNotFound, null);

        if (trip.Id != line.TripId)
        {
            line.TripId = trip.Id;
            line.SortOrder = trip.Items.Count == 0 ? 0 : trip.Items.Max(i => i.SortOrder) + 1;
        }

        var priceCents = ToCents(request.Price);
        // Same rule as the trip editor: the window runs from the first price, so a
        // correction doesn't reopen (or restart) it; clearing the price does.
        line.PricedAt = priceCents is null ? null : line.PriceCents is null ? now : line.PricedAt ?? now;
        line.PriceCents = priceCents;
        if (priceCents is not null) line.Checked = true;
        if (request.Quantity is { } quantity) line.QuantityMilli = Quantities.ToMilli(quantity);
        if (request.Unit is { } unit) line.Unit = unit;
        await ApplyStoreAsync(line, trip, request.StoreName, ct);

        await db.SaveChangesAsync(ct);
        return (CatalogResult.Ok, await GetLineAsync(line.Id, ct));
    }

    // A locked purchase is part of the price history; removing it needs the same confirmation as correcting it.
    public async Task<CatalogResult> DeleteLineAsync(Guid itemId, Guid lineId, bool confirmLocked, CancellationToken ct = default)
    {
        var line = await db.TripItems.FirstOrDefaultAsync(ti => ti.Id == lineId && ti.ItemId == itemId, ct);
        if (line is null) return CatalogResult.LineNotFound;
        if (IsLocked(line, clock.UtcNow) && !confirmLocked) return CatalogResult.PriceLocked;
        db.TripItems.Remove(line);
        await db.SaveChangesAsync(ct);
        return CatalogResult.Ok;
    }

    // E.g. "milk" into "whole milk". Moving lines is idempotent — replaying the
    // same merge finds nothing left to move — so a retried request is harmless.
    public async Task<(CatalogResult Result, MergeResultDto? Merge)> MergeAsync(
        Guid sourceId, MergeItemRequest request, CancellationToken ct = default)
    {
        if (sourceId == request.TargetItemId) return (CatalogResult.Invalid, null);
        var source = await db.Items.FindAsync([sourceId], ct);
        var target = await db.Items.FindAsync([request.TargetItemId], ct);
        if (source is null || target is null) return (CatalogResult.ItemNotFound, null);

        var lines = await db.TripItems
            .Include(ti => ti.Store)
            .Include(ti => ti.Trip!).ThenInclude(t => t.Stores)
            .Where(ti => ti.ItemId == sourceId)
            .ToListAsync(ct);
        var store = string.IsNullOrWhiteSpace(request.StoreName) ? null : NameNormalizer.Normalize(request.StoreName);
        var moving = lines
            .Where(l => store is null || (EffectiveStoreName(l) is { } s && NameNormalizer.Normalize(s) == store))
            .ToList();
        foreach (var line in moving) line.ItemId = target.Id;

        var sourceDeleted = false;
        if (request.DeleteSourceIfEmpty && moving.Count == lines.Count)
        {
            // Dashboards that pinned the source now show the target in its place.
            var pins = await db.TrackedItems.Where(t => t.ItemId == sourceId).ToListAsync(ct);
            var profilesPinningTarget = (await db.TrackedItems.Where(t => t.ItemId == target.Id).Select(t => t.ProfileId).ToListAsync(ct)).ToHashSet();
            foreach (var pin in pins.Where(p => !profilesPinningTarget.Contains(p.ProfileId)))
            {
                db.TrackedItems.Add(new TrackedItem { ProfileId = pin.ProfileId, ItemId = target.Id, SortOrder = pin.SortOrder });
            }
            db.TrackedItems.RemoveRange(pins);
            // Recipes that used the source use the target instead (once, if they already had it).
            var recipeItems = await db.RecipeItems.Where(r => r.ItemId == sourceId).ToListAsync(ct);
            var recipesWithTarget = (await db.RecipeItems.Where(r => r.ItemId == target.Id).Select(r => r.RecipeId).ToListAsync(ct)).ToHashSet();
            foreach (var recipeItem in recipeItems)
            {
                if (recipesWithTarget.Contains(recipeItem.RecipeId)) db.RecipeItems.Remove(recipeItem);
                else recipeItem.ItemId = target.Id;
            }
            // Receipt names learned for the source now mean the target (unless the store already has that name).
            var sourceAliases = await db.ItemAliases.Where(a => a.ItemId == sourceId).ToListAsync(ct);
            var taken = (await db.ItemAliases.Where(a => a.ItemId == target.Id).Select(a => new { a.StoreId, a.Key }).ToListAsync(ct))
                .Select(a => (a.StoreId, a.Key)).ToHashSet();
            foreach (var alias in sourceAliases)
            {
                if (taken.Contains((alias.StoreId, alias.Key))) db.ItemAliases.Remove(alias);
                else alias.ItemId = target.Id;
            }
            db.Items.Remove(source);
            sourceDeleted = true;
        }

        await db.SaveChangesAsync(ct);
        return (CatalogResult.Ok, new MergeResultDto(moving.Count, sourceDeleted));
    }

    public async Task<List<HouseholdTripDto>> ListTripsAsync(CancellationToken ct = default)
    {
        var trips = await db.Trips
            .Select(t => new
            {
                t.Id, t.Name, t.Date, t.Status, t.CreatedAt, t.ProfileId, ProfileName = t.Profile!.Name,
                Stores = t.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
            })
            .ToListAsync(ct);
        return trips
            .OrderByDescending(t => t.Date, StringComparer.Ordinal).ThenByDescending(t => t.CreatedAt)
            .Select(t => new HouseholdTripDto(t.Id, t.Name, t.Date, t.Status.ToString().ToLowerInvariant(), t.ProfileId, t.ProfileName, t.Stores))
            .ToList();
    }

    private async Task<CatalogResult?> ValidateAsync(Guid? itemId, SaveItemRequest request, CancellationToken ct)
    {
        if (!Amounts.IsValidName(request.Name)) return CatalogResult.Invalid;
        if (request.DefaultCategoryId is { } categoryId && !await db.Categories.AnyAsync(c => c.Id == categoryId, ct))
        {
            return CatalogResult.Invalid;
        }
        var normalized = NameNormalizer.Normalize(request.Name);
        if (await db.Items.AnyAsync(i => i.NormalizedName == normalized && i.Id != itemId, ct))
        {
            return CatalogResult.NameConflict;
        }
        return null;
    }

    // Resolves the store through the household lookup, and adds it to the trip's
    // own store list if it isn't there yet, so the trip editor shows it.
    private async Task ApplyStoreAsync(TripItem line, Trip trip, string? storeName, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(storeName))
        {
            line.StoreId = null;
            line.Store = null;
            return;
        }
        var store = await lookup.ResolveStoreAsync(storeName, ct);
        line.Store = store;
        line.StoreId = store.Id;
        if (!trip.Stores.Any(s => NameNormalizer.Normalize(s.Name) == store.NormalizedName))
        {
            db.TripStores.Add(new TripStore
            {
                Id = Guid.NewGuid(), TripId = trip.Id, Name = store.Name,
                SortOrder = trip.Stores.Count == 0 ? 0 : trip.Stores.Max(s => s.SortOrder) + 1,
            });
        }
    }

    private async Task<Guid> OtherCategoryIdAsync(CancellationToken ct) =>
        await db.Categories.Where(c => c.NormalizedName == "other").Select(c => c.Id).FirstAsync(ct);

    private IQueryable<TripItem> LineQuery() => db.TripItems
        .Include(ti => ti.Store)
        .Include(ti => ti.Trip!).ThenInclude(t => t.Stores)
        .Include(ti => ti.Trip!).ThenInclude(t => t.Profile);

    private async Task<ItemLineDto?> GetLineAsync(Guid lineId, CancellationToken ct)
    {
        db.ChangeTracker.Clear(); // re-read what was saved, with fresh navigations
        var line = await LineQuery().FirstOrDefaultAsync(ti => ti.Id == lineId, ct);
        return line is null ? null : ToLineDto(line, clock.UtcNow);
    }

    private async Task<CatalogItemDto?> GetCatalogItemAsync(Guid itemId, CancellationToken ct) =>
        (await ListAsync(null, itemId, ct)).FirstOrDefault();

    private static string? EffectiveStoreName(TripItem line) =>
        line.Store?.Name ?? line.Trip?.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).FirstOrDefault();

    private static bool IsLocked(TripItem line, DateTimeOffset now) =>
        line.PricedAt is { } pricedAt && now - pricedAt > TripService.PriceEditWindow;

    private static ItemLineDto ToLineDto(TripItem l, DateTimeOffset now) => new(
        l.Id, l.TripId, l.Trip!.Name, l.Trip.Date, l.Trip.Status.ToString().ToLowerInvariant(),
        l.Trip.ProfileId, l.Trip.Profile!.Name,
        l.Store?.Name, EffectiveStoreName(l),
        l.Checked, l.PriceCents / 100m, l.EstimateCents / 100m,
        IsLocked(l, now), l.PricedAt + TripService.PriceEditWindow,
        Quantities.FromMilli(l.QuantityMilli), l.Unit);

    private static int? ToCents(decimal? amount) => Amounts.ToCents(amount);
}

public enum CatalogResult { Ok, ItemNotFound, TripNotFound, LineNotFound, NameConflict, PriceLocked, Invalid }
