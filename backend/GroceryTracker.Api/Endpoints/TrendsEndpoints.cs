using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class TrendsEndpoints
{
    public static void MapTrendsEndpoints(this IEndpointRouteBuilder app)
    {
        // range: 30d | 90d (default) | 180d | 365d | all
        app.MapGet("/api/v1/profiles/{profileId:guid}/trends", async (Guid profileId, string? range, string? today, TrendsService service, CancellationToken ct) =>
        {
            range ??= "90d";
            if (!TrendsService.Ranges.Contains(range))
            {
                return Results.Problem(type: ProblemTypes.Validation,
                    title: $"Range must be one of: {string.Join(", ", TrendsService.Ranges)}.",
                    statusCode: StatusCodes.Status400BadRequest);
            }
            var trends = await service.GetAsync(profileId, range, today, ct);
            return trends is null
                ? Results.Problem(type: ProblemTypes.ProfileNotFound, title: "Profile not found.", statusCode: StatusCodes.Status404NotFound)
                : Results.Ok(trends);
        }).WithTags("Trends");
    }
}
