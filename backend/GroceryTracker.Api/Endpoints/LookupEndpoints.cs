using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class LookupEndpoints
{
    public static void MapLookupEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/profiles/{profileId:guid}").WithTags("Lookups");

        group.MapGet("/stores", async (Guid profileId, string? search, LookupService service, CancellationToken ct) =>
            Results.Ok(await service.SearchStoresAsync(profileId, search, ct)));

        group.MapGet("/items", async (Guid profileId, string? search, LookupService service, CancellationToken ct) =>
            Results.Ok(await service.SearchItemsAsync(profileId, search, ct)));

        group.MapGet("/items/{itemId:guid}/history", async (
            Guid profileId, Guid itemId, ItemHistoryService service, CancellationToken ct) =>
        {
            var history = await service.GetAsync(profileId, itemId, ct);
            return history is null ? Results.NotFound() : Results.Ok(history);
        });
    }
}
