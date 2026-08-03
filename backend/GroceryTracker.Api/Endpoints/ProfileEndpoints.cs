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
            if (string.IsNullOrWhiteSpace(request.Name)) return Results.BadRequest("Name is required.");
            var profile = await service.CreateAsync(request, ct);
            return Results.Created($"/api/v1/profiles/{profile.Id}", profile);
        });

        group.MapDelete("/{id:guid}", async (Guid id, ProfileService service, CancellationToken ct) =>
            await service.DeleteAsync(id, ct) ? Results.NoContent() : Results.NotFound());
    }
}
