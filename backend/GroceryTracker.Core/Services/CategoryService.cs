using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public class CategoryService(GroceryTrackerDbContext db)
{
    public async Task<List<CategoryDto>> ListAsync(CancellationToken ct = default)
    {
        return await db.Categories
            .OrderBy(c => c.SortOrder)
            .Select(c => new CategoryDto(c.Id, c.Name, c.IsBuiltIn, c.SortOrder))
            .ToListAsync(ct);
    }

    public async Task<CategoryDto?> CreateAsync(CreateCategoryRequest request, CancellationToken ct = default)
    {
        var trimmed = request.Name.Trim();
        if (trimmed.Length == 0) return null;
        var normalized = NameNormalizer.Normalize(trimmed);

        if (await db.Categories.AnyAsync(c => c.NormalizedName == normalized, ct)) return null;

        var maxSortOrder = await db.Categories.MaxAsync(c => (int?)c.SortOrder, ct) ?? -1;
        var category = new Category
        {
            Id = Guid.NewGuid(),
            Name = trimmed,
            NormalizedName = normalized,
            IsBuiltIn = false,
            SortOrder = maxSortOrder + 1,
        };
        db.Categories.Add(category);
        await db.SaveChangesAsync(ct);
        return new CategoryDto(category.Id, category.Name, category.IsBuiltIn, category.SortOrder);
    }

    // Never cascades a delete of purchase/list history: any TripItem/ListItem/Item
    // still referencing this category is reassigned to the built-in "Other" category first.
    public async Task<CategoryDeleteResult> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var category = await db.Categories.FindAsync([id], ct);
        if (category is null) return CategoryDeleteResult.NotFound;
        if (category.IsBuiltIn) return CategoryDeleteResult.BuiltIn;

        var other = await db.Categories.FirstAsync(c => c.NormalizedName == "other", ct);

        await db.TripItems.Where(ti => ti.CategoryId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(ti => ti.CategoryId, other.Id), ct);
        await db.ListItems.Where(li => li.CategoryId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(li => li.CategoryId, other.Id), ct);
        await db.Items.Where(i => i.DefaultCategoryId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.DefaultCategoryId, other.Id), ct);

        db.Categories.Remove(category);
        await db.SaveChangesAsync(ct);
        return CategoryDeleteResult.Deleted;
    }
}

public enum CategoryDeleteResult { NotFound, BuiltIn, Deleted }
