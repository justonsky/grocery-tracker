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
                ? Results.Problem(type: ProblemTypes.CategoryNameConflict, title: "A category with that name already exists.", statusCode: StatusCodes.Status409Conflict)
                : Results.Created($"/api/v1/categories/{category.Id}", category);
        });

        group.MapDelete("/{id:guid}", async (Guid id, CategoryService service, CancellationToken ct) =>
            await service.DeleteAsync(id, ct) switch
            {
                Deleted => Results.NoContent(),
                BuiltIn => Results.Problem(type: ProblemTypes.CategoryBuiltIn, title: "Built-in categories can't be deleted.", statusCode: StatusCodes.Status400BadRequest),
                _ => Results.Problem(type: ProblemTypes.CategoryNotFound, title: "Category not found.", statusCode: StatusCodes.Status404NotFound),
            });

        // Idempotent upsert (new route — POST above is unaffected). Targeted
        // by the offline outbox for offline-created categories.
        group.MapPut("/{id:guid}", async (Guid id, CreateCategoryRequest request, CategoryService service, CancellationToken ct) =>
        {
            if (id == Guid.Empty)
            {
                return Results.Problem(type: ProblemTypes.Validation, title: "Id must not be empty.", statusCode: StatusCodes.Status400BadRequest);
            }

            var (result, category) = await service.UpsertAsync(id, request, ct);
            return result switch
            {
                CategoryUpsertResult.Created => Results.Created($"/api/v1/categories/{category!.Id}", category),
                CategoryUpsertResult.Updated => Results.Ok(category),
                CategoryUpsertResult.BuiltIn => Results.Problem(
                    type: ProblemTypes.CategoryBuiltIn, title: "Built-in categories can't be renamed.", statusCode: StatusCodes.Status400BadRequest),
                _ => Results.Problem(
                    type: ProblemTypes.CategoryNameConflict, title: "A category with that name already exists.", statusCode: StatusCodes.Status409Conflict),
            };
        });
    }
}
