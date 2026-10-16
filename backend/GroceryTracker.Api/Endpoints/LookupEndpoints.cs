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

        // unit: "each" or "lb" — which way to show an item bought both ways (default: the way most purchases were).
        group.MapGet("/items/{itemId:guid}/history", (Guid itemId, string? from, string? to, string? unit, ItemHistoryService service, CancellationToken ct) =>
            GetHistoryAsync(itemId, from, to, service, ct, unit));

        // The routes these used to live at, before items and stores became
        // household-wide. An installed PWA keeps running its cached build until it
        // reloads, and that build still calls these; the profile id is ignored.
        var legacy = app.MapGroup("/api/v1/profiles/{profileId:guid}").WithTags("Lookups").ExcludeFromDescription();
        legacy.MapGet("/stores", async (string? search, LookupService service, CancellationToken ct) =>
            Results.Ok(await service.SearchStoresAsync(search, ct)));
        legacy.MapGet("/items", async (string? search, LookupService service, CancellationToken ct) =>
            Results.Ok(await service.SearchItemsAsync(search, ct)));
        legacy.MapGet("/items/{itemId:guid}/history", (Guid itemId, ItemHistoryService service, CancellationToken ct) =>
            GetHistoryAsync(itemId, null, null, service, ct));
    }

    private static async Task<IResult> GetHistoryAsync(
        Guid itemId, string? from, string? to, ItemHistoryService service, CancellationToken ct, string? unit = null)
    {
        if (unit is not null and not ("each" or "lb"))
        {
            return Results.Problem(type: ProblemTypes.Validation, title: "unit must be each or lb.", statusCode: StatusCodes.Status400BadRequest);
        }
        if (!IsIsoDateOrNull(from) || !IsIsoDateOrNull(to))
        {
            return Results.Problem(type: ProblemTypes.Validation, title: "from and to must be dates (YYYY-MM-DD).", statusCode: StatusCodes.Status400BadRequest);
        }
        var history = await service.GetAsync(itemId, from, to, ct, unit);
        return history is null
            ? Results.Problem(type: ProblemTypes.ItemNotFound, title: "Item not found.", statusCode: StatusCodes.Status404NotFound)
            : Results.Ok(history);
    }

    private static bool IsIsoDateOrNull(string? value) =>
        value is null || DateOnly.TryParseExact(value, "yyyy-MM-dd", out _);
}
