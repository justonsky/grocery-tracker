using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public enum RecipeResult { Ok, Created, NotFound, Invalid }

// Household recipes. Items are the shared catalogue's items, so the prices shown with a
// recipe are the same household averages the rest of the app uses.
public class RecipeService(GroceryTrackerDbContext db, LookupService lookup, RecipePhotoStore photos, IClock clock)
{
    public async Task<List<RecipeDto>> ListAsync(CancellationToken ct = default)
    {
        var recipes = await db.Recipes
            .Include(r => r.Items).ThenInclude(i => i.Item).ThenInclude(i => i!.DefaultCategory)
            .OrderBy(r => r.Name)
            .ToListAsync(ct);
        return await ToDtosAsync(recipes, ct);
    }

    public async Task<RecipeDto?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var recipe = await db.Recipes
            .Include(r => r.Items).ThenInclude(i => i.Item).ThenInclude(i => i!.DefaultCategory)
            .FirstOrDefaultAsync(r => r.Id == id, ct);
        return recipe is null ? null : (await ToDtosAsync([recipe], ct))[0];
    }

    public static bool IsValid(RecipeInput input) =>
        !string.IsNullOrWhiteSpace(input.Name) && input.Name.Trim().Length <= RecipeLimits.NameLength
        && (input.Description is null || input.Description.Length <= RecipeLimits.DescriptionLength)
        && input.Items is { Count: > 0 and <= RecipeLimits.MaxItems }
        && input.Items.All(i => !string.IsNullOrWhiteSpace(i.ItemName) && (i.Amount is null || i.Amount.Length <= RecipeLimits.AmountLength));

    // Idempotent create-or-replace by the caller's id, like trips, so a retried save is safe.
    public async Task<(RecipeResult Result, RecipeDto? Recipe)> UpsertAsync(Guid id, RecipeInput input, CancellationToken ct = default)
    {
        if (!IsValid(input)) return (RecipeResult.Invalid, null);
        var now = clock.UtcNow;
        var recipe = await db.Recipes.Include(r => r.Items).FirstOrDefaultAsync(r => r.Id == id, ct);
        var created = recipe is null;
        if (recipe is null)
        {
            recipe = new Recipe { Id = id, Name = input.Name.Trim(), CreatedAt = now, UpdatedAt = now };
            db.Recipes.Add(recipe);
        }
        else
        {
            db.RecipeItems.RemoveRange(recipe.Items);
            recipe.Items.Clear();
        }

        recipe.Name = input.Name.Trim();
        recipe.Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
        recipe.UpdatedAt = now;

        // An item listed twice is one ingredient.
        var seen = new HashSet<Guid>();
        var order = 0;
        foreach (var line in input.Items)
        {
            var item = await lookup.ResolveItemAsync(line.ItemName, line.CategoryId, ct);
            if (!seen.Add(item.Id)) continue;
            recipe.Items.Add(new RecipeItem
            {
                Id = Guid.NewGuid(), RecipeId = recipe.Id, ItemId = item.Id,
                Amount = string.IsNullOrWhiteSpace(line.Amount) ? null : line.Amount.Trim(), SortOrder = order++,
            });
        }

        await db.SaveChangesAsync(ct);
        return (created ? RecipeResult.Created : RecipeResult.Ok, await GetAsync(id, ct));
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var recipe = await db.Recipes.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (recipe is null) return false;
        db.Recipes.Remove(recipe); // cascades to its items and to trips' planned meals
        await db.SaveChangesAsync(ct);
        photos.Delete(id);
        return true;
    }

    public async Task<(RecipeResult Result, PhotoCheck Check, RecipeDto? Recipe)> SetPhotoAsync(Guid id, byte[] bytes, CancellationToken ct = default)
    {
        var recipe = await db.Recipes.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (recipe is null) return (RecipeResult.NotFound, PhotoCheck.Ok, null);
        var check = RecipePhotoStore.Check(bytes, out var contentType, out _, out _);
        if (check != PhotoCheck.Ok) return (RecipeResult.Invalid, check, null);

        await photos.SaveAsync(id, bytes, ct);
        recipe.PhotoVersion++;
        recipe.PhotoContentType = contentType;
        recipe.UpdatedAt = clock.UtcNow;
        await db.SaveChangesAsync(ct);
        return (RecipeResult.Ok, PhotoCheck.Ok, await GetAsync(id, ct));
    }

    public async Task<RecipeDto?> RemovePhotoAsync(Guid id, CancellationToken ct = default)
    {
        var recipe = await db.Recipes.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (recipe is null) return null;
        photos.Delete(id);
        recipe.PhotoVersion = 0;
        recipe.PhotoContentType = null;
        recipe.UpdatedAt = clock.UtcNow;
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<(Stream Stream, string ContentType)?> OpenPhotoAsync(Guid id, CancellationToken ct = default)
    {
        var type = await db.Recipes.Where(r => r.Id == id && r.PhotoVersion > 0).Select(r => r.PhotoContentType).FirstOrDefaultAsync(ct);
        if (type is null) return null;
        var stream = photos.Open(id);
        return stream is null ? null : (stream, type);
    }

    private async Task<List<RecipeDto>> ToDtosAsync(List<Recipe> recipes, CancellationToken ct)
    {
        var itemIds = recipes.SelectMany(r => r.Items.Select(i => i.ItemId)).Distinct().ToList();
        // Household average per item (or per pound, for things bought by weight).
        var averages = itemIds.Count == 0
            ? new Dictionary<Guid, (decimal Price, string PriceUnit)>()
            : (await db.TripItems.Where(ti => itemIds.Contains(ti.ItemId) && ti.PriceCents > 0)
                    .Select(ti => new { ti.ItemId, ti.PriceCents, ti.QuantityMilli, ti.Unit, ti.Trip!.Date, ti.Trip.CreatedAt })
                    .ToListAsync(ct))
                .GroupBy(x => x.ItemId)
                .ToDictionary(g => g.Key, g =>
                {
                    var (priceUnit, points, _) = Quantities.Summarize(g.Select(x => new Quantities.Purchase(x.PriceCents!.Value, x.QuantityMilli, x.Unit, x.Date, x.CreatedAt)));
                    return (Price: Quantities.Dollars(points.Average(p => p.UnitCents)), PriceUnit: priceUnit);
                });

        var recipeIds = recipes.Select(r => r.Id).ToList();
        var usage = (await db.TripRecipes.Where(tr => recipeIds.Contains(tr.RecipeId))
                .Select(tr => new { tr.RecipeId, tr.Trip!.Date }).ToListAsync(ct))
            .GroupBy(x => x.RecipeId)
            .ToDictionary(g => g.Key, g => (Count: g.Count(), Last: g.Max(x => x.Date)));

        return recipes.Select(r =>
        {
            var items = r.Items.OrderBy(i => i.SortOrder).Select(i => new RecipeItemDto(
                i.ItemId, i.Item!.Name, i.Item.DefaultCategoryId, i.Item.DefaultCategory?.Name ?? "Other",
                i.Amount, averages.TryGetValue(i.ItemId, out var avg) ? avg.Price : null,
                averages.TryGetValue(i.ItemId, out var unit) ? unit.PriceUnit : Quantities.Each)).ToList();
            var known = items.Where(i => i.AveragePrice is not null).ToList();
            usage.TryGetValue(r.Id, out var u);
            return new RecipeDto(r.Id, r.Name, r.Description, r.PhotoVersion, items,
                known.Count == 0 ? null : known.Sum(i => i.AveragePrice!.Value), u.Count, u.Count == 0 ? null : u.Last);
        }).ToList();
    }
}
