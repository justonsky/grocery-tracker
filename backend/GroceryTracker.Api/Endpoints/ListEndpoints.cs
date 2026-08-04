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
            return list is null ? ListNotFound() : Results.Ok(list);
        });

        group.MapPost("/", async (Guid profileId, GroceryListInput input, ListService service, CancellationToken ct) =>
        {
            var list = await service.CreateAsync(profileId, input, ct);
            return Results.Created($"/api/v1/profiles/{profileId}/lists/{list.Id}", list);
        });

        // Idempotent upsert, not update-only — see TripEndpoints' PUT for why.
        group.MapPut("/{listId:guid}", async (Guid profileId, Guid listId, GroceryListInput input, ListService service, CancellationToken ct) =>
        {
            if (listId == Guid.Empty)
            {
                return Results.Problem(type: ProblemTypes.Validation, title: "Id must not be empty.", statusCode: StatusCodes.Status400BadRequest);
            }

            var (result, list) = await service.UpsertAsync(profileId, listId, input, ct);
            return result switch
            {
                ListUpsertResult.Created => Results.Created($"/api/v1/profiles/{profileId}/lists/{list!.Id}", list),
                ListUpsertResult.Updated => Results.Ok(list),
                ListUpsertResult.CrossProfile => Results.Problem(
                    type: ProblemTypes.CrossProfile, title: "This list belongs to a different profile.", statusCode: StatusCodes.Status409Conflict),
                _ => Results.Problem(
                    type: ProblemTypes.ProfileNotFound, title: "Profile not found.", statusCode: StatusCodes.Status404NotFound),
            };
        });

        group.MapDelete("/{listId:guid}", async (Guid profileId, Guid listId, ListService service, CancellationToken ct) =>
            await service.DeleteAsync(profileId, listId, ct) ? Results.NoContent() : ListNotFound());
    }

    private static IResult ListNotFound() =>
        Results.Problem(type: ProblemTypes.ListNotFound, title: "List not found.", statusCode: StatusCodes.Status404NotFound);
}
