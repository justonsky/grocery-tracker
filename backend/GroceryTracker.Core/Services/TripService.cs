using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// Trips cover what used to be two things: a grocery list written before the shop
// and a trip logged after it. They are the same record at different stages, so
// there is one service, one editor and one table.
public class TripService(GroceryTrackerDbContext db, LookupService lookup, IClock clock)
{
    // How long after a price is first recorded its line can still be edited.
    // Past this, the line is history: averages and price trends stop moving.
    public static readonly TimeSpan PriceEditWindow = TimeSpan.FromDays(7);

    public async Task<List<TripSummaryDto>> ListAsync(Guid profileId, string? from, string? to, CancellationToken ct = default)
    {
        // ISO-8601 dates sort correctly lexicographically; per-profile trip counts are
        // small enough (years of shopping history) that filtering in-memory after the
        // indexed ProfileId fetch is simpler and just as fast as a translated range query.
        var rows = await db.Trips
            .Where(t => t.ProfileId == profileId)
            .Select(t => new
            {
                t.Id,
                t.Name,
                t.Date,
                t.BudgetCents,
                t.Status,
                t.CreatedAt,
                Stores = t.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
                ItemCount = t.Items.Count,
                CheckedCount = t.Items.Count(i => i.Checked),
                TotalCents = t.Items.Sum(i => i.PriceCents) ?? 0,
                EstimatedCents = t.Items.Sum(i => i.EstimateCents) ?? 0,
                ComparedCount = t.Items.Count(i => i.EstimateCents != null && i.PriceCents != null),
                SavingsCents = t.Items
                    .Where(i => i.EstimateCents != null && i.PriceCents != null)
                    .Sum(i => i.EstimateCents!.Value - i.PriceCents!.Value),
            })
            .ToListAsync(ct);

        return rows
            .Where(r => from is null || string.CompareOrdinal(r.Date, from) >= 0)
            .Where(r => to is null || string.CompareOrdinal(r.Date, to) <= 0)
            .OrderByDescending(r => r.Date, StringComparer.Ordinal)
            .ThenByDescending(r => r.CreatedAt)
            .Select(r => new TripSummaryDto(
                r.Id, r.Name, r.Date, r.Stores, r.ItemCount, r.CheckedCount,
                r.TotalCents / 100m, r.BudgetCents / 100m,
                FormatStatus(r.Status), r.EstimatedCents / 100m,
                r.ComparedCount == 0 ? null : r.SavingsCents / 100m))
            .ToList();
    }

    public async Task<TripDto?> GetAsync(Guid profileId, Guid tripId, CancellationToken ct = default)
    {
        var trip = await LoadQuery(profileId).FirstOrDefaultAsync(t => t.Id == tripId, ct);
        return trip is null ? null : ToDto(trip, clock.UtcNow);
    }

    public async Task<TripDto> CreateAsync(Guid profileId, TripInput input, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var trip = new Trip
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = Normalize(input.Name),
            Date = input.Date,
            BudgetCents = ToCents(input.Budget),
            CreatedAt = now,
        };
        ApplyStatus(trip, ParseStatus(input.Status) ?? TripStatus.Planned, now);
        await ApplyStoresAndItemsAsync(profileId, trip, input, new TripItem?[input.Items.Count], now, ct);
        await ApplyRecipesAsync(trip, input, ct);

        db.Trips.Add(trip);
        await db.SaveChangesAsync(ct);
        return (await GetAsync(profileId, trip.Id, ct))!;
    }

    // Idempotent create-or-replace, keyed by the caller-supplied tripId rather
    // than a server-generated one — this is what lets the offline outbox
    // (client-generated GUIDs) safely re-send the same PUT if a reply is lost,
    // and lets an offline-created trip "just work" once it reaches the server,
    // with no separate reconciliation step.
    public async Task<(TripUpsertResult Result, TripDto? Trip)> UpsertAsync(
        Guid profileId, Guid tripId, TripInput input, CancellationToken ct = default)
    {
        var profileExists = await db.Profiles.AnyAsync(p => p.Id == profileId, ct);
        if (!profileExists) return (TripUpsertResult.ProfileNotFound, null);

        var trip = await db.Trips
            .Include(t => t.Stores)
            .Include(t => t.Recipes)
            .Include(t => t.Items).ThenInclude(i => i.Item)
            .Include(t => t.Items).ThenInclude(i => i.Store)
            .FirstOrDefaultAsync(t => t.Id == tripId, ct);
        if (trip is not null && trip.ProfileId != profileId)
        {
            return (TripUpsertResult.CrossProfile, null);
        }

        var now = clock.UtcNow;
        var isCreate = trip is null;
        TripItem?[] matches;

        if (isCreate)
        {
            trip = new Trip
            {
                Id = tripId, ProfileId = profileId,
                Name = Normalize(input.Name), Date = input.Date,
                BudgetCents = ToCents(input.Budget), CreatedAt = now,
            };
            ApplyStatus(trip, ParseStatus(input.Status) ?? TripStatus.Planned, now);
            matches = new TripItem?[input.Items.Count];
            db.Trips.Add(trip);
        }
        else
        {
            matches = MatchExistingItems(trip!.Items, input.Items);
            var hasLockedLines = trip.Items.Any(i => IsLocked(i, now));

            trip.Name = Normalize(input.Name);
            // Price history is dated by the trip, so once a line is locked the date
            // is too — otherwise moving it would shift every locked price point.
            if (!hasLockedLines) trip.Date = input.Date;
            trip.BudgetCents = ToCents(input.Budget);
            ApplyStatus(trip, ParseStatus(input.Status) ?? trip.Status, now);

            db.TripStores.RemoveRange(trip.Stores);
            trip.Stores.Clear();
            // Lines carried over keep their row (and with it PricedAt); the rest go —
            // except locked lines, which stay whether or not the save mentions them.
            foreach (var removed in trip.Items.Except(matches.OfType<TripItem>()).Where(i => !IsLocked(i, now)).ToList())
            {
                db.TripItems.Remove(removed);
                trip.Items.Remove(removed);
            }
        }

        await ApplyStoresAndItemsAsync(profileId, trip, input, matches, now, ct);
        await ApplyRecipesAsync(trip, input, ct);
        // Locked lines the save left out keep their place after everything it sent.
        var order = input.Items.Count;
        foreach (var kept in trip.Items.Where(i => IsLocked(i, now) && Array.IndexOf(matches, i) < 0).OrderBy(i => i.SortOrder))
        {
            kept.SortOrder = order++;
        }
        await db.SaveChangesAsync(ct);

        var dto = await GetAsync(profileId, trip.Id, ct);
        return (isCreate ? TripUpsertResult.Created : TripUpsertResult.Updated, dto);
    }

    public async Task<bool> DeleteAsync(Guid profileId, Guid tripId, CancellationToken ct = default)
    {
        var trip = await db.Trips.FirstOrDefaultAsync(t => t.ProfileId == profileId && t.Id == tripId, ct);
        if (trip is null) return false;
        db.Trips.Remove(trip);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public static bool IsValidStatus(string? status) => status is null || ParseStatus(status) is not null;

    private static TripStatus? ParseStatus(string? status) => status?.Trim().ToLowerInvariant() switch
    {
        "planned" => TripStatus.Planned,
        "shopping" => TripStatus.Shopping,
        "done" => TripStatus.Done,
        _ => null,
    };

    private static string FormatStatus(TripStatus status) => status.ToString().ToLowerInvariant();

    // CompletedAt records when the trip was first finished; reopening clears it.
    private static void ApplyStatus(Trip trip, TripStatus status, DateTimeOffset now)
    {
        trip.Status = status;
        trip.CompletedAt = status == TripStatus.Done ? trip.CompletedAt ?? now : null;
    }

    private static bool IsLocked(TripItem line, DateTimeOffset now) =>
        line.PricedAt is { } pricedAt && now - pricedAt > PriceEditWindow;

    // Pairs each incoming line with the existing row it edits (or null for a new
    // line). Ids are claimed first so a name match can never take a row that
    // another input names explicitly; lines without an id fall back to item name.
    private static TripItem?[] MatchExistingItems(List<TripItem> existing, List<TripItemInput> inputs)
    {
        var unmatched = existing.ToList();
        var matches = new TripItem?[inputs.Count];

        for (var i = 0; i < inputs.Count; i++)
        {
            if (inputs[i].Id is not { } id) continue;
            var row = unmatched.FirstOrDefault(e => e.Id == id);
            if (row is null) continue;
            matches[i] = row;
            unmatched.Remove(row);
        }

        for (var i = 0; i < inputs.Count; i++)
        {
            if (inputs[i].Id is not null) continue;
            var normalized = NameNormalizer.Normalize(inputs[i].ItemName);
            var row = unmatched.FirstOrDefault(e => e.Item!.NormalizedName == normalized);
            if (row is null) continue;
            matches[i] = row;
            unmatched.Remove(row);
        }

        return matches;
    }

    private IQueryable<Trip> LoadQuery(Guid profileId) => db.Trips
        .Where(t => t.ProfileId == profileId)
        .Include(t => t.Stores)
        .Include(t => t.Recipes).ThenInclude(r => r.Recipe).ThenInclude(r => r!.Items)
        .Include(t => t.Items).ThenInclude(i => i.Item)
        .Include(t => t.Items).ThenInclude(i => i.Category)
        .Include(t => t.Items).ThenInclude(i => i.Store);

    private async Task ApplyStoresAndItemsAsync(
        Guid profileId, Trip trip, TripInput input, TripItem?[] matches, DateTimeOffset now, CancellationToken ct)
    {
        var storeOrder = 0;
        foreach (var storeName in input.Stores)
        {
            if (string.IsNullOrWhiteSpace(storeName)) continue;
            trip.Stores.Add(new TripStore
            {
                Id = Guid.NewGuid(),
                TripId = trip.Id,
                Name = storeName.Trim(),
                SortOrder = storeOrder++,
            });
        }

        for (var i = 0; i < input.Items.Count; i++)
        {
            var itemInput = input.Items[i];
            var line = matches[i];

            // Locked: read-only. Whatever the save says about it is ignored (so a
            // queued offline edit that crossed the lock still applies everything
            // else); only its position follows the save.
            if (line is not null && IsLocked(line, now))
            {
                line.SortOrder = i;
                continue;
            }

            var item = await lookup.ResolveItemAsync(itemInput.ItemName, itemInput.CategoryId, ct);
            Store? store = null;
            if (!string.IsNullOrWhiteSpace(itemInput.StoreName))
            {
                store = await lookup.ResolveStoreAsync(itemInput.StoreName, ct);
            }

            if (line is null)
            {
                line = new TripItem { Id = Guid.NewGuid(), TripId = trip.Id };
                trip.Items.Add(line);
            }

            var priceCents = ToCents(itemInput.Price);
            // The edit window runs from when a price was first recorded, so
            // correcting it doesn't restart the clock; clearing it does.
            line.PricedAt = priceCents is null ? null : line.PriceCents is null ? now : line.PricedAt ?? now;
            line.Item = item;
            line.ItemId = item.Id;
            line.CategoryId = itemInput.CategoryId;
            line.Store = store;
            line.StoreId = store?.Id;
            line.Checked = itemInput.Checked;
            line.EstimateCents = ToCents(itemInput.Estimate);
            line.PriceCents = priceCents;
            line.SortOrder = i;
        }
    }

    // The planned meals. Null RecipeIds (an older queued save) leaves them alone; ids of recipes
    // that no longer exist are dropped rather than failing the save. Which of a meal's items
    // are on the list is the trip's own lines — this only records the meals.
    private async Task ApplyRecipesAsync(Trip trip, TripInput input, CancellationToken ct)
    {
        if (input.RecipeIds is null) return;
        var wanted = input.RecipeIds.Distinct().ToList();
        var existing = (await db.Recipes.Where(r => wanted.Contains(r.Id)).Select(r => r.Id).ToListAsync(ct)).ToHashSet();
        db.TripRecipes.RemoveRange(trip.Recipes);
        trip.Recipes.Clear();
        var order = 0;
        foreach (var id in wanted.Where(existing.Contains))
        {
            trip.Recipes.Add(new TripRecipe { TripId = trip.Id, RecipeId = id, SortOrder = order++ });
        }
    }

    private static string? Normalize(string? name) =>
        string.IsNullOrWhiteSpace(name) ? null : name.Trim();

    // A blank or negative amount means "not known yet", not zero.
    private static int? ToCents(decimal? amount) =>
        amount is null or < 0 ? null : (int)Math.Round(amount.Value * 100m, MidpointRounding.AwayFromZero);

    private static TripDto ToDto(Trip trip, DateTimeOffset now)
    {
        // A line's store is the household Store row ("Aldi"), but the trip lists
        // stores as typed ("aldi"). Report the line under the trip's spelling so the
        // two always match and the editor never splits one store into two sections.
        var tripStoreNames = trip.Stores
            .GroupBy(s => NameNormalizer.Normalize(s.Name))
            .ToDictionary(g => g.Key, g => g.OrderBy(s => s.SortOrder).First().Name);
        string? StoreName(TripItem line) =>
            line.Store is { } store ? tripStoreNames.GetValueOrDefault(store.NormalizedName, store.Name) : null;

        var compared = trip.Items.Where(i => i.EstimateCents is not null && i.PriceCents is not null).ToList();
        return new TripDto(
            trip.Id, trip.Name, trip.Date, trip.BudgetCents / 100m,
            trip.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
            trip.Items.OrderBy(i => i.SortOrder).Select(i => new TripItemDto(
                i.Id, i.ItemId, i.Item!.Name, i.CategoryId, i.Category!.Name,
                StoreName(i), i.Checked, i.PriceCents / 100m,
                i.EstimateCents / 100m, i.PricedAt + PriceEditWindow, IsLocked(i, now))).ToList(),
            (trip.Items.Sum(i => i.PriceCents) ?? 0) / 100m,
            FormatStatus(trip.Status), trip.CompletedAt,
            (trip.Items.Sum(i => i.EstimateCents) ?? 0) / 100m,
            compared.Count == 0 ? null : compared.Sum(i => i.EstimateCents!.Value - i.PriceCents!.Value) / 100m,
            trip.Recipes.OrderBy(r => r.SortOrder)
                .Select(r => new TripRecipeDto(r.RecipeId, r.Recipe!.Name, r.Recipe.PhotoVersion, r.Recipe.Items.Count)).ToList());
    }
}

public enum TripUpsertResult { Created, Updated, ProfileNotFound, CrossProfile }
