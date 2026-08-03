using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class ListEndpoints
{
    public static void MapListEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/profiles/{profileId:guid}/lists").WithTags("Lists");

        group.MapGet("/", async (Guid profileId, ListService service, CancellationToken ct) =>
            Results.Ok(await service.ListAsync(profileId, ct)));

        group.MapGet("/{listId:guid}", async (Guid profileId, Guid listId, ListService service, CancellationToken ct) =>
        {
            var list = await service.GetAsync(profileId, listId, ct);
            return list is null ? Results.NotFound() : Results.Ok(list);
        });

        group.MapPost("/", async (Guid profileId, GroceryListInput input, ListService service, CancellationToken ct) =>
        {
            var list = await service.CreateAsync(profileId, input, ct);
            return Results.Created($"/api/v1/profiles/{profileId}/lists/{list.Id}", list);
        });

        group.MapPut("/{listId:guid}", async (Guid profileId, Guid listId, GroceryListInput input, ListService service, CancellationToken ct) =>
        {
            var list = await service.UpdateAsync(profileId, listId, input, ct);
            return list is null ? Results.NotFound() : Results.Ok(list);
        });

        group.MapDelete("/{listId:guid}", async (Guid profileId, Guid listId, ListService service, CancellationToken ct) =>
            await service.DeleteAsync(profileId, listId, ct) ? Results.NoContent() : Results.NotFound());

        group.MapPost("/{listId:guid}/items/{listItemId:guid}/toggle", async (
            Guid profileId, Guid listId, Guid listItemId, ListService service, CancellationToken ct) =>
            await service.ToggleItemAsync(profileId, listId, listItemId, ct) ? Results.NoContent() : Results.NotFound());
    }
}
