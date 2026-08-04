using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class TripEndpoints
{
    public static void MapTripEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/profiles/{profileId:guid}/trips").WithTags("Trips");

        group.MapGet("/", async (Guid profileId, string? from, string? to, TripService service, CancellationToken ct) =>
            Results.Ok(await service.ListAsync(profileId, from, to, ct)));

        group.MapGet("/{tripId:guid}", async (Guid profileId, Guid tripId, TripService service, CancellationToken ct) =>
        {
            var trip = await service.GetAsync(profileId, tripId, ct);
            return trip is null ? TripNotFound() : Results.Ok(trip);
        });

        group.MapPost("/", async (Guid profileId, TripInput input, TripService service, CancellationToken ct) =>
        {
            var trip = await service.CreateAsync(profileId, input, ct);
            return Results.Created($"/api/v1/profiles/{profileId}/trips/{trip.Id}", trip);
        });

        // Idempotent upsert, not update-only: creates the trip with this exact
        // id if it doesn't exist yet. This is what the offline outbox targets —
        // a client-generated GUID replayed here is always safe to re-send.
        group.MapPut("/{tripId:guid}", async (Guid profileId, Guid tripId, TripInput input, TripService service, CancellationToken ct) =>
        {
            if (tripId == Guid.Empty)
            {
                return Results.Problem(type: ProblemTypes.Validation, title: "Id must not be empty.", statusCode: StatusCodes.Status400BadRequest);
            }

            var (result, trip) = await service.UpsertAsync(profileId, tripId, input, ct);
            return result switch
            {
                TripUpsertResult.Created => Results.Created($"/api/v1/profiles/{profileId}/trips/{trip!.Id}", trip),
                TripUpsertResult.Updated => Results.Ok(trip),
                TripUpsertResult.CrossProfile => Results.Problem(
                    type: ProblemTypes.CrossProfile, title: "This trip belongs to a different profile.", statusCode: StatusCodes.Status409Conflict),
                _ => Results.Problem(
                    type: ProblemTypes.ProfileNotFound, title: "Profile not found.", statusCode: StatusCodes.Status404NotFound),
            };
        });

        group.MapDelete("/{tripId:guid}", async (Guid profileId, Guid tripId, TripService service, CancellationToken ct) =>
            await service.DeleteAsync(profileId, tripId, ct) ? Results.NoContent() : TripNotFound());
    }

    private static IResult TripNotFound() =>
        Results.Problem(type: ProblemTypes.TripNotFound, title: "Trip not found.", statusCode: StatusCodes.Status404NotFound);
}
