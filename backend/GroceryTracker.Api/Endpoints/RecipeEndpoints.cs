using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class RecipeEndpoints
{
    public static void MapRecipeEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/recipes").WithTags("Recipes");

        group.MapGet("/", async (RecipeService service, CancellationToken ct) => Results.Ok(await service.ListAsync(ct)));

        group.MapGet("/{id:guid}", async (Guid id, RecipeService service, CancellationToken ct) =>
            await service.GetAsync(id, ct) is { } recipe ? Results.Ok(recipe) : NotFound());

        // Idempotent create-or-replace keyed by the caller's id (a retried save is safe).
        group.MapPut("/{id:guid}", async (Guid id, RecipeInput input, RecipeService service, CancellationToken ct) =>
        {
            var (result, recipe) = await service.UpsertAsync(id, input, ct);
            return result switch
            {
                RecipeResult.Created => Results.Created($"/api/v1/recipes/{id}", recipe),
                RecipeResult.Ok => Results.Ok(recipe),
                _ => Results.Problem(type: ProblemTypes.Validation,
                    title: $"A recipe needs a name (up to {RecipeLimits.NameLength} characters) and 1–{RecipeLimits.MaxItems} items.",
                    statusCode: StatusCodes.Status400BadRequest),
            };
        });

        group.MapDelete("/{id:guid}", async (Guid id, RecipeService service, CancellationToken ct) =>
            await service.DeleteAsync(id, ct) ? Results.NoContent() : NotFound());

        // The body is the image itself. Over the limits it is refused so the app can have the
        // user crop it; the crop editor produces files that always fit.
        group.MapPut("/{id:guid}/photo", async (Guid id, HttpRequest request, RecipeService service, CancellationToken ct) =>
        {
            using var buffer = new MemoryStream();
            var limited = request.Body;
            var chunk = new byte[81920];
            int read;
            while ((read = await limited.ReadAsync(chunk, ct)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > RecipeLimits.PhotoMaxBytes * 2L) break; // refuse far-too-large bodies early
            }
            var bytes = buffer.ToArray();
            var (result, check, recipe) = await service.SetPhotoAsync(id, bytes, ct);
            if (result == RecipeResult.NotFound) return NotFound();
            if (result == RecipeResult.Ok) return Results.Ok(recipe);
            return check switch
            {
                PhotoCheck.NotAnImage => Results.Problem(type: ProblemTypes.Validation,
                    title: "That file isn't a JPEG, PNG or WebP image.", statusCode: StatusCodes.Status400BadRequest),
                _ => Results.Problem(type: ProblemTypes.PhotoTooLarge,
                    title: $"Photos can be at most {RecipeLimits.PhotoMaxWidth}×{RecipeLimits.PhotoMaxHeight}px and {RecipeLimits.PhotoMaxBytes / 1024 / 1024} MB — crop it first.",
                    statusCode: StatusCodes.Status413PayloadTooLarge),
            };
        });

        group.MapDelete("/{id:guid}/photo", async (Guid id, RecipeService service, CancellationToken ct) =>
            await service.RemovePhotoAsync(id, ct) is { } recipe ? Results.Ok(recipe) : NotFound());

        // ?v= is the recipe's PhotoVersion, so a changed photo is a new URL and the old one can be cached for good.
        group.MapGet("/{id:guid}/photo", async (Guid id, int? v, HttpContext ctx, RecipeService service, CancellationToken ct) =>
        {
            var photo = await service.OpenPhotoAsync(id, ct);
            if (photo is null) return NotFound();
            ctx.Response.Headers.CacheControl = v is null ? "no-cache" : "public, max-age=31536000, immutable";
            return Results.Stream(photo.Value.Stream, photo.Value.ContentType);
        });
    }

    private static IResult NotFound() =>
        Results.Problem(type: ProblemTypes.RecipeNotFound, title: "Recipe not found.", statusCode: StatusCodes.Status404NotFound);
}
