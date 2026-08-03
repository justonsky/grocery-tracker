using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;
using static GroceryTracker.Core.Services.CategoryDeleteResult;

namespace GroceryTracker.Api.Endpoints;

public static class CategoryEndpoints
{
    public static void MapCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/categories").WithTags("Categories");

        group.MapGet("/", async (CategoryService service, CancellationToken ct) =>
            Results.Ok(await service.ListAsync(ct)));

        group.MapPost("/", async (CreateCategoryRequest request, CategoryService service, CancellationToken ct) =>
        {
            var category = await service.CreateAsync(request, ct);
            return category is null
                ? Results.Conflict("A category with that name already exists.")
                : Results.Created($"/api/v1/categories/{category.Id}", category);
        });

        group.MapDelete("/{id:guid}", async (Guid id, CategoryService service, CancellationToken ct) =>
            await service.DeleteAsync(id, ct) switch
            {
                Deleted => Results.NoContent(),
                BuiltIn => Results.BadRequest("Built-in categories can't be deleted."),
                _ => Results.NotFound(),
            });
    }
}
