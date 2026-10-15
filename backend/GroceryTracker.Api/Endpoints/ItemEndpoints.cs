using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

// The Items portal: the household catalogue and the purchase records behind it.
// Plain online CRUD — these edits aren't routed through the offline outbox.
public static class ItemEndpoints
{
    public static void MapItemEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1").WithTags("Items");

        api.MapGet("/catalog/items", async (string? search, ItemCatalogService service, CancellationToken ct) =>
            Results.Ok(await service.ListAsync(search, ct)));

        api.MapGet("/trips", async (ItemCatalogService service, CancellationToken ct) =>
            Results.Ok(await service.ListTripsAsync(ct)));

        api.MapPost("/items", async (SaveItemRequest request, ItemCatalogService service, CancellationToken ct) =>
        {
            var (result, item) = await service.CreateAsync(request, ct);
            return result == CatalogResult.Ok ? Results.Created($"/api/v1/items/{item!.Id}", item) : Problem(result);
        });

        api.MapPut("/items/{itemId:guid}", async (Guid itemId, SaveItemRequest request, ItemCatalogService service, CancellationToken ct) =>
        {
            var (result, item) = await service.UpdateAsync(itemId, request, ct);
            return result == CatalogResult.Ok ? Results.Ok(item) : Problem(result);
        });

        api.MapDelete("/items/{itemId:guid}", async (Guid itemId, ItemCatalogService service, CancellationToken ct) =>
            await service.DeleteAsync(itemId, ct) ? Results.NoContent() : Problem(CatalogResult.ItemNotFound));

        api.MapGet("/items/{itemId:guid}/lines", async (Guid itemId, ItemCatalogService service, CancellationToken ct) =>
            await service.GetLinesAsync(itemId, ct) is { } lines ? Results.Ok(lines) : Problem(CatalogResult.ItemNotFound));

        api.MapPost("/items/{itemId:guid}/lines", async (Guid itemId, SaveItemLineRequest request, ItemCatalogService service, CancellationToken ct) =>
        {
            var (result, line) = await service.AddLineAsync(itemId, request, ct);
            return result == CatalogResult.Ok ? Results.Created($"/api/v1/items/{itemId}/lines/{line!.Id}", line) : Problem(result);
        });

        api.MapPut("/items/{itemId:guid}/lines/{lineId:guid}", async (
            Guid itemId, Guid lineId, SaveItemLineRequest request, ItemCatalogService service, CancellationToken ct) =>
        {
            var (result, line) = await service.UpdateLineAsync(itemId, lineId, request, ct);
            return result == CatalogResult.Ok ? Results.Ok(line) : Problem(result);
        });

        api.MapDelete("/items/{itemId:guid}/lines/{lineId:guid}", async (Guid itemId, Guid lineId, ItemCatalogService service, CancellationToken ct) =>
            await service.DeleteLineAsync(itemId, lineId, ct) ? Results.NoContent() : Problem(CatalogResult.LineNotFound));

        api.MapPost("/items/{itemId:guid}/merge", async (Guid itemId, MergeItemRequest request, ItemCatalogService service, CancellationToken ct) =>
        {
            var (result, merge) = await service.MergeAsync(itemId, request, ct);
            return result == CatalogResult.Ok ? Results.Ok(merge) : Problem(result);
        });
    }

    private static IResult Problem(CatalogResult result) => result switch
    {
        CatalogResult.ItemNotFound => Results.Problem(type: ProblemTypes.ItemNotFound, title: "Item not found.", statusCode: StatusCodes.Status404NotFound),
        CatalogResult.TripNotFound => Results.Problem(type: ProblemTypes.TripNotFound, title: "Trip not found.", statusCode: StatusCodes.Status404NotFound),
        CatalogResult.LineNotFound => Results.Problem(type: ProblemTypes.TripItemNotFound, title: "Purchase record not found.", statusCode: StatusCodes.Status404NotFound),
        CatalogResult.NameConflict => Results.Problem(type: ProblemTypes.ItemNameConflict,
            title: "Another item already has that name — merge the two instead.", statusCode: StatusCodes.Status409Conflict),
        CatalogResult.PriceLocked => Results.Problem(type: ProblemTypes.PriceLocked,
            title: "This price is locked. Confirm to correct it anyway.", statusCode: StatusCodes.Status409Conflict),
        _ => Results.Problem(type: ProblemTypes.Validation, title: "That request wasn't valid.", statusCode: StatusCodes.Status400BadRequest),
    };
}
