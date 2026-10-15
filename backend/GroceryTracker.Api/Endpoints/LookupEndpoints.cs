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

        group.MapGet("/items/{itemId:guid}/history", (Guid itemId, ItemHistoryService service, CancellationToken ct) =>
            GetHistoryAsync(itemId, service, ct));

        // The routes these used to live at, before items and stores became
        // household-wide. An installed PWA keeps running its cached build until it
        // reloads, and that build still calls these; the profile id is ignored.
        var legacy = app.MapGroup("/api/v1/profiles/{profileId:guid}").WithTags("Lookups").ExcludeFromDescription();
        legacy.MapGet("/stores", async (string? search, LookupService service, CancellationToken ct) =>
            Results.Ok(await service.SearchStoresAsync(search, ct)));
        legacy.MapGet("/items", async (string? search, LookupService service, CancellationToken ct) =>
            Results.Ok(await service.SearchItemsAsync(search, ct)));
        legacy.MapGet("/items/{itemId:guid}/history", (Guid itemId, ItemHistoryService service, CancellationToken ct) =>
            GetHistoryAsync(itemId, service, ct));
    }

    private static async Task<IResult> GetHistoryAsync(Guid itemId, ItemHistoryService service, CancellationToken ct)
    {
        var history = await service.GetAsync(itemId, ct);
        return history is null
            ? Results.Problem(type: ProblemTypes.ItemNotFound, title: "Item not found.", statusCode: StatusCodes.Status404NotFound)
            : Results.Ok(history);
    }
}
