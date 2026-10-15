using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

// Items and stores are household-wide, so these routes aren't under a profile.
public static class LookupEndpoints
{
    public static void MapLookupEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1").WithTags("Lookups");

        group.MapGet("/stores", async (string? search, LookupService service, CancellationToken ct) =>
            Results.Ok(await service.SearchStoresAsync(search, ct)));

        group.MapGet("/items", async (string? search, LookupService service, CancellationToken ct) =>
            Results.Ok(await service.SearchItemsAsync(search, ct)));

        group.MapGet("/items/{itemId:guid}/history", async (Guid itemId, ItemHistoryService service, CancellationToken ct) =>
        {
            var history = await service.GetAsync(itemId, ct);
            return history is null
                ? Results.Problem(type: ProblemTypes.ItemNotFound, title: "Item not found.", statusCode: StatusCodes.Status404NotFound)
                : Results.Ok(history);
        });
    }
}
