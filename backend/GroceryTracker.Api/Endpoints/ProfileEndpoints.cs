using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/profiles").WithTags("Profiles");

        group.MapGet("/", async (ProfileService service, CancellationToken ct) =>
            Results.Ok(await service.ListAsync(ct)));

        group.MapPost("/", async (CreateProfileRequest request, ProfileService service, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.Problem(type: ProblemTypes.Validation, title: "Name is required.", statusCode: StatusCodes.Status400BadRequest);
            }
            var profile = await service.CreateAsync(request, ct);
            return Results.Created($"/api/v1/profiles/{profile.Id}", profile);
        });

        // Idempotent upsert (new route — POST above is unaffected). This is
        // what the offline outbox targets, and also what lets a profile that
        // was deleted server-side while a device was offline be recreated
        // with the id it always had, in a single request.
        group.MapPut("/{id:guid}", async (Guid id, CreateProfileRequest request, ProfileService service, CancellationToken ct) =>
        {
            if (id == Guid.Empty)
            {
                return Results.Problem(type: ProblemTypes.Validation, title: "Id must not be empty.", statusCode: StatusCodes.Status400BadRequest);
            }
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.Problem(type: ProblemTypes.Validation, title: "Name is required.", statusCode: StatusCodes.Status400BadRequest);
            }

            var (result, profile) = await service.UpsertAsync(id, request, ct);
            return result == ProfileUpsertResult.Created
                ? Results.Created($"/api/v1/profiles/{profile.Id}", profile)
                : Results.Ok(profile);
        });

        group.MapDelete("/{id:guid}", async (Guid id, ProfileService service, CancellationToken ct) =>
            await service.DeleteAsync(id, ct)
                ? Results.NoContent()
                : Results.Problem(type: ProblemTypes.ProfileNotFound, title: "Profile not found.", statusCode: StatusCodes.Status404NotFound));
    }
}
