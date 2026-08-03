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
            return trip is null ? Results.NotFound() : Results.Ok(trip);
        });

        group.MapPost("/", async (Guid profileId, TripInput input, TripService service, CancellationToken ct) =>
        {
            var trip = await service.CreateAsync(profileId, input, ct);
            return Results.Created($"/api/v1/profiles/{profileId}/trips/{trip.Id}", trip);
        });

        group.MapPut("/{tripId:guid}", async (Guid profileId, Guid tripId, TripInput input, TripService service, CancellationToken ct) =>
        {
            var trip = await service.UpdateAsync(profileId, tripId, input, ct);
            return trip is null ? Results.NotFound() : Results.Ok(trip);
        });

        group.MapDelete("/{tripId:guid}", async (Guid profileId, Guid tripId, TripService service, CancellationToken ct) =>
            await service.DeleteAsync(profileId, tripId, ct) ? Results.NoContent() : Results.NotFound());
    }
}
